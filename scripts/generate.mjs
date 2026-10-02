// Gera sprite (jpg + vtt) de cada vídeo da sua fatia do todo.json e envia ao R2.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aws, buildVtt, env, exec, layout, scrub } from './lib.mjs';

const bucket = env('R2_BUCKET');
const destPrefix = env('DEST_PREFIX', 'sprites-test/');
const shard = Number(env('SHARD', '0'));
const shards = Number(env('SHARDS', '1'));
const parallel = Number(env('PARALLEL', '3'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) SpriteBot';

const all = JSON.parse(readFileSync('todo.json', 'utf8'));
const mine = all.filter((_, index) => index % shards === shard);
const results = { ok: 0, failed: 0 };

async function processOne({ key, name }) {
  const dir = mkdtempSync(join(tmpdir(), 'sprite-'));
  try {
    const url = (await aws(['s3', 'presign', `s3://${bucket}/${key}`, '--expires-in', '3600'])).trim();
    console.log(`::add-mask::${url}`);

    const probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url], {
      timeoutMs: 120_000,
    });
    const duration = Number.parseFloat(probe);
    if (!duration || duration < 60) throw new Error(`duração inválida (${duration})`);
    const grid = layout(duration);
    if (!grid) throw new Error('quadros insuficientes');

    const filter = `fps=${1 / grid.interval},scale=${grid.tileW}:${grid.tileH}:force_original_aspect_ratio=decrease,pad=${grid.tileW}:${grid.tileH}:(ow-iw)/2:(oh-ih)/2:color=black,tile=${grid.cols}x${grid.rows}`;
    const jpg = join(dir, `${name}.jpg`);
    await exec(
      'ffmpeg',
      ['-y', '-nostdin', '-loglevel', 'error', '-rw_timeout', '30000000', '-user_agent', UA, '-threads', '1',
        '-skip_frame', 'nokey', '-i', url, '-an', '-sn', '-frames:v', '1', '-vf', filter, '-q:v', '5', jpg],
      { timeoutMs: 900_000 },
    );
    if (statSync(jpg).size < 1000) throw new Error('jpg pequeno demais');

    const vtt = join(dir, `${name}.vtt`);
    writeFileSync(vtt, buildVtt(grid, duration, `${name}.jpg`), 'utf8');

    const cache = 'public, max-age=31536000, immutable';
    await aws(['s3', 'cp', jpg, `s3://${bucket}/${destPrefix}${name}.jpg`, '--content-type', 'image/jpeg', '--cache-control', cache, '--only-show-errors']);
    // O .vtt vai por último: ele é o marcador de "sprite completo".
    await aws(['s3', 'cp', vtt, `s3://${bucket}/${destPrefix}${name}.vtt`, '--content-type', 'text/vtt; charset=utf-8', '--cache-control', cache, '--only-show-errors']);
    results.ok += 1;
    console.log(`ok   ${name} (${grid.frames} quadros, ${Math.round(statSync(jpg).size / 1024)} KB)`);
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
console.log(`shard ${shard}/${shards}: ok=${results.ok} falhas=${results.failed}`);
