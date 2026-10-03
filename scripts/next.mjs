// Fim de cada rodada: decide se o workflow se dispara de novo (sozinho, com o GITHUB_TOKEN) ou para.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const PROD_PREFIX = { sprites: 'sprites/', credits: 'markers/', intro: 'intros/' };
const ROUNDS_PER_MODE = 50; // trava de segurança por modo ao encadear para o próximo

/** Soma os result-*.json dos shards. */
export function sumResults(dir) {
  const total = { ok: 0, failed: 0 };
  if (!existsSync(dir)) return total;
  for (const file of readdirSync(dir).filter((f) => /^result-.*\.json$/.test(f))) {
    const { ok = 0, failed = 0 } = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
    total.ok += ok;
    total.failed += failed;
  }
  return total;
}

/**
 * @returns {{ action: 'stop', reason: string } | { action: 'dispatch', inputs: Record<string, string>, reason: string }}
 */
export function decide({ mode, destPrefix, limit, offset, kind, chunks, rounds, then, planCount, results }) {
  const isTest = destPrefix.endsWith('-test/');
  const same = (extra) => ({
    mode, dest_prefix: destPrefix, limit: String(limit), kind, chunks: String(chunks), then, ...extra,
  });

  if (planCount === 0) {
    // Nada mais pendente neste modo.
    const [nextMode, ...rest] = then.split(',').map((m) => m.trim()).filter(Boolean);
    if (!nextMode || isTest) return { action: 'stop', reason: 'nada pendente e sem próximo modo' };
    if (!PROD_PREFIX[nextMode]) return { action: 'stop', reason: `modo desconhecido em "then": ${nextMode}` };
    return {
      action: 'dispatch', reason: `${mode} concluído; segue para ${nextMode}`,
      inputs: { ...same({}), mode: nextMode, dest_prefix: PROD_PREFIX[nextMode], offset: '0', rounds: String(ROUNDS_PER_MODE), then: rest.join(',') },
    };
  }
  if (results.ok === 0) return { action: 'stop', reason: `rodada sem nenhum sucesso (${results.failed} falhas); parando para não repetir em laço` };
  const left = Number(rounds) - 1;
  if (left < 1) return { action: 'stop', reason: 'limite de rodadas atingido' };
  // Quem falhou continua pendente e fica na frente da lista: pula essas posições na próxima rodada.
  return {
    action: 'dispatch', reason: `ok=${results.ok} falhas=${results.failed}; restam ${left} rodadas`,
    inputs: same({ offset: String(Number(offset) + results.failed), rounds: String(left) }),
  };
}

if (process.argv[1]?.endsWith('next.mjs')) {
  const e = process.env;
  const decision = decide({
    mode: e.MODE ?? 'sprites', destPrefix: e.DEST_PREFIX ?? 'sprites-test/', limit: e.LIMIT ?? '20', offset: e.OFFSET ?? '0',
    kind: e.KIND ?? 'all', chunks: e.CHUNKS ?? '4', rounds: e.ROUNDS ?? '1', then: e.THEN ?? '',
    planCount: Number(e.PLAN_COUNT ?? '0'), results: sumResults(e.RESULT_DIR ?? 'results'),
  });
  console.log(`próximo: ${decision.action} — ${decision.reason}`);
  if (decision.action === 'dispatch') {
    const flags = Object.entries(decision.inputs).flatMap(([k, v]) => ['-f', `${k}=${v}`]);
    execFileSync('gh', ['workflow', 'run', 'sprites.yml', '--ref', e.GITHUB_REF_NAME ?? 'main', ...flags], { stdio: 'inherit' });
  }
}
