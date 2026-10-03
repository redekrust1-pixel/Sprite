// Detecta o início dos créditos (preto + silêncio na cauda do vídeo) e grava markers/{nome}.json no R2.
// Mesma lógica do processCreditsJob do DioneyFlix, só que lendo o arquivo do R2 (link que não expira no meio do job).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aws, env, exec, pickCredits, scrub } from './lib.mjs';

const bucket = env('R2_BUCKET');
const destPrefix = env('DEST_PREFIX', 'markers-test/');
const shard = Number(env('SHARD', '0'));
const shards = Number(env('SHARDS', '1'));
const parallel = Number(env('PARALLEL', '3'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) SpriteBot';

const all = JSON.parse(readFileSync('todo.json', 'utf8'));
const mine = all.filter((_, index) => index % shards === shard);
const results = { ok: 0, failed: 0, fallback: 0 };

async function processOne({ key, name }) {
  const dir = mkdtempSync(join(tmpdir(), 'credits-'));
  try {
    const url = (await aws(['s3', 'presign', `s3://${bucket}/${key}`, '--expires-in', '3600'])).trim();
    console.log(`::add-mask::${url}`);

    const probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url], {
      timeoutMs: 120_000,
    });
    const duration = Number.parseFloat(probe);
    if (!duration || duration < 300) throw new Error(`duração inválida (${duration})`);

    const tailWindow = Math.min(Math.max(600, duration * 0.12), 900);
    const tailStart = Math.max(0, duration - tailWindow);

    // O ffmpeg precisa do nível "info" para o blackdetect/silencedetect escreverem no stderr; ele é só lido, nunca impresso.
    const stderr = await exec(
      'ffmpeg',
      ['-nostdin', '-nostats', '-rw_timeout', '30000000', '-user_agent', UA, '-ss', String(tailStart), '-threads', '1',
        '-i', url, '-sn', '-vf', 'fps=2,scale=160:90,blackdetect=d=0.5:pix_th=0.10',
        '-af', 'silencedetect=n=-30dB:d=0.5', '-f', 'null', '-'],
      { timeoutMs: 600_000, stderr: true },
    );

    const { creditsStart, detected } = pickCredits(stderr, duration, tailStart);
    const marker = {
      credits_start: creditsStart,
      duration: Math.round(duration),
      confidence: detected ? 0.8 : 0.4,
      detection_method: 'ffmpeg_black',
      source: 'auto',
    };
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(marker), 'utf8');
    await aws(['s3', 'cp', file, `s3://${bucket}/${destPrefix}${name}.json`, '--content-type', 'application/json', '--only-show-errors']);
    results.ok += 1;
    if (!detected) results.fallback += 1;
    console.log(`ok   ${name} créditos=${creditsStart}s/${Math.round(duration)}s ${detected ? 'detectado' : 'palpite'}`);
  } catch (error) {
    results.failed += 1;
    console.log(`FAIL ${name}: ${scrub(error.message)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const queue = [...mine];
await Promise.all(
  Array.from({ length: parallel }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await processOne(item);
  }),
);
console.log(`shard ${shard}/${shards}: ok=${results.ok} (palpite=${results.fallback}) falhas=${results.failed}`);
writeFileSync(`result-${shard}.json`, JSON.stringify({ ok: results.ok, failed: results.failed }));
