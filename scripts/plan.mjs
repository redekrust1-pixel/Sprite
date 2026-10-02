// Lista os vídeos do R2 que ainda não têm sprite e grava todo.json.
import { appendFileSync, writeFileSync } from 'node:fs';
import { aws, env, spriteName } from './lib.mjs';

const bucket = env('R2_BUCKET');
const kind = env('KIND', 'all'); // all | movies | tv
const destPrefix = env('DEST_PREFIX', 'sprites-test/');
const limit = Number(env('LIMIT', '20'));
const offset = Number(env('OFFSET', '0'));
const chunks = Math.max(1, Math.min(20, Number(env('CHUNKS', '4'))));
const MIN_BYTES = 50 * 1024 * 1024;

async function list(prefix) {
  const out = await aws(['s3', 'ls', `s3://${bucket}/${prefix}`, '--recursive']);
  return out.split('\n').flatMap((line) => {
    const match = /^\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line.trim());
    return match ? [{ size: Number(match[1]), key: match[2] }] : [];
  });
}

const prefixes = kind === 'all' ? ['movies/', 'tv/'] : [`${kind}/`];
const videos = (await Promise.all(prefixes.map(list)))
  .flat()
  .filter((o) => o.key.endsWith('/source.mp4') && o.size >= MIN_BYTES);

const done = new Set(
  (await list(destPrefix)).filter((o) => o.key.endsWith('.jpg')).map((o) => o.key.slice(destPrefix.length, -4)),
);

const todo = videos
  .map((o) => ({ key: o.key, name: spriteName(o.key), size: o.size }))
  .filter((o) => o.name && !done.has(o.name))
  .sort((a, b) => a.key.localeCompare(b.key))
  .slice(offset, offset + limit);

writeFileSync('todo.json', JSON.stringify(todo));
const shards = Array.from({ length: Math.min(chunks, todo.length) }, (_, i) => i);
console.log(`vídeos=${videos.length} com sprite=${done.size} a gerar=${todo.length} shards=${shards.length}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `count=${todo.length}\nshards=${JSON.stringify(shards)}\n`);
}
