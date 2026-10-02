// Detecta a abertura de cada temporada comparando o áudio inicial de 2–3 episódios (Chromaprint)
// e grava intros/{tmdb}_series_s{S}.json no R2. Mesma lógica do processIntroJob do DioneyFlix.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aws, env, exec, findCommonSegment, introFromMatch, scrub } from './lib.mjs';

const bucket = env('R2_BUCKET');
const destPrefix = env('DEST_PREFIX', 'intros-test/');
const shard = Number(env('SHARD', '0'));
const shards = Number(env('SHARDS', '1'));
const parallel = Number(env('PARALLEL', '3'));
const CAPTURE_SECS = 360;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) SpriteBot';

const all = JSON.parse(readFileSync('todo.json', 'utf8'));
const mine = all.filter((_, index) => index % shards === shard);
const results = { found: 0, none: 0, failed: 0 };

async function fingerprint(key, dir, tag) {
  const url = (await aws(['s3', 'presign', `s3://${bucket}/${key}`, '--expires-in', '3600'])).trim();
  console.log(`::add-mask::${url}`);
  const wav = join(dir, `${tag}.wav`);
  await exec(
    'ffmpeg',
    ['-y', '-nostdin', '-loglevel', 'error', '-rw_timeout', '30000000', '-user_agent', UA, '-threads', '1',
      '-i', url, '-t', String(CAPTURE_SECS), '-vn', '-sn', '-ar', '11025', '-ac', '1', wav],
    { timeoutMs: 600_000 },
  );
  const out = await exec('fpcalc', ['-raw', '-length', String(CAPTURE_SECS), wav], { timeoutMs: 120_000 });
  let duration = 0;
  let fp = [];
  for (const line of out.trim().split('\n')) {
    if (line.startsWith('DURATION=')) duration = Number.parseFloat(line.slice(9));
    if (line.startsWith('FINGERPRINT=')) fp = line.slice(12).split(',').map(Number);
  }
  if (!fp.length) throw new Error('impressão de áudio vazia');
  return { duration, fp };
}

async function processOne({ name, eps }) {
  const dir = mkdtempSync(join(tmpdir(), 'intro-'));
  try {
    const cache = new Map();
    const get = async (index) => {
      if (!cache.has(index)) cache.set(index, await fingerprint(eps[index], dir, `ep${index}`));
      return cache.get(index);
    };

    // E1 costuma ter abertura diferente (cold open): se o par 0×1 não achar, tenta 0×2 e 1×2.
    const pairs = [[0, 1], [0, 2], [1, 2]].filter(([, b]) => b < eps.length);
    let best = null;
    for (const [a, b] of pairs) {
      const first = await get(a);
      const second = await get(b);
      const intro = introFromMatch(findCommonSegment(first.fp, second.fp), first.duration / first.fp.length);
      if (!best || intro.matchDuration > best.matchDuration) best = intro;
      if (intro.matchDuration >= 10) break;
    }

    const marker = best.found
      ? { intro_start: best.introStart, intro_end: best.introEnd, confidence: best.confidence,
          detection_method: 'chromaprint', source: 'auto' }
      : { detection_method: 'no_intro_found', confidence: 0, source: 'auto' };
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(marker), 'utf8');
    await aws(['s3', 'cp', file, `s3://${bucket}/${destPrefix}${name}.json`, '--content-type', 'application/json', '--only-show-errors']);
    if (best.found) {
      results.found += 1;
      console.log(`ok   ${name} intro=${marker.intro_start}s–${marker.intro_end}s (${best.matchDuration.toFixed(1)}s)`);
    } else {
      results.none += 1;
      console.log(`none ${name} (melhor trecho comum: ${best.matchDuration.toFixed(1)}s)`);
    }
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
console.log(`shard ${shard}/${shards}: com intro=${results.found} sem intro=${results.none} falhas=${results.failed}`);
