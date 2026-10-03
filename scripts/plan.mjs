// Lista os vídeos do R2 que ainda não têm sprite e grava todo.json.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { aws, env, spriteName } from './lib.mjs';

const bucket = env('R2_BUCKET');
const kind = env('KIND', 'all'); // all | movies | tv
const mode = env('MODE', 'sprites'); // sprites | credits | intro
const doneExt = mode === 'sprites' ? '.jpg' : '.json';
const destPrefix = env('DEST_PREFIX', 'sprites-test/');
const limit = Number(env('LIMIT', '20'));
const offset = Number(env('OFFSET', '0'));
const chunks = Math.max(1, Math.min(20, Number(env('CHUNKS', '4'))));
const MIN_BYTES = 50 * 1024 * 1024;

async function list(prefix) {
  // `aws s3 ls` sai com código 1 e sem mensagem quando o prefixo não tem nenhum objeto.
  const out = await aws(['s3', 'ls', `s3://${bucket}/${prefix}`, '--recursive']).catch((error) => {
    if (error.exitCode === 1 && error.silent) return '';
    throw error;
  });
  return out.split('\n').flatMap((line) => {
    const match = /^\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line.trim());
    return match ? [{ size: Number(match[1]), key: match[2] }] : [];
  });
}

// Lista pronta vinda do orquestrador da VPS (gravada no R2): pula a listagem do bucket inteiro (~3 min).
if (process.env.TODO_KEY) {
  await aws(['s3', 'cp', `s3://${bucket}/${process.env.TODO_KEY}`, 'todo.json', '--only-show-errors']);
  const fromVps = JSON.parse(readFileSync('todo.json', 'utf8'));
  const vpsShards = Array.from({ length: Math.min(chunks, fromVps.length) }, (_, i) => i);
  console.log(`modo=${mode} lista da VPS: ${fromVps.length} itens, shards=${vpsShards.length}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${fromVps.length}
shards=${JSON.stringify(vpsShards)}
`);
  process.exit(0);
}

const prefixes = mode === 'intro' ? ['tv/'] : kind === 'all' ? ['movies/', 'tv/'] : [`${kind}/`];
const videos = (await Promise.all(prefixes.map(list)))
  .flat()
  .filter((o) => o.key.endsWith('/source.mp4') && o.size >= MIN_BYTES);

const done = new Set(
  (await list(destPrefix)).filter((o) => o.key.endsWith(doneExt)).map((o) => o.key.slice(destPrefix.length, -doneExt.length)),
);

// Intro: um item por temporada (>= 2 episódios), com os 3 primeiros episódios, como no DioneyFlix.
function seasonItems() {
  const seasons = new Map();
  for (const { key } of videos) {
    const m = /^tv\/(\d+)\/season-(\d+)\/episode-(\d+)\/source\.mp4$/.exec(key);
    if (!m || Number(m[2]) === 0) continue;
    const name = `${m[1]}_series_s${Number(m[2])}`;
    if (!seasons.has(name)) seasons.set(name, []);
    seasons.get(name).push({ episode: Number(m[3]), key });
  }
  return [...seasons]
    .filter(([, eps]) => eps.length >= 2)
    .map(([name, eps]) => ({
      key: eps[0].key.replace(/\/episode-\d+\/source\.mp4$/, ''),
      name,
      eps: eps.sort((a, b) => a.episode - b.episode).slice(0, 3).map((e) => e.key),
    }));
}

const candidates = mode === 'intro'
  ? seasonItems()
  : videos.map((o) => ({ key: o.key, name: spriteName(o.key), size: o.size }));
const todo = candidates
  .filter((o) => o.name && !done.has(o.name))
  .sort((a, b) => a.key.localeCompare(b.key))
  .slice(offset, offset + limit);

writeFileSync('todo.json', JSON.stringify(todo));
const shards = Array.from({ length: Math.min(chunks, todo.length) }, (_, i) => i);
console.log(`modo=${mode} vídeos=${videos.length} com sprite=${done.size} a gerar=${todo.length} shards=${shards.length}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `count=${todo.length}\nshards=${JSON.stringify(shards)}\n`);
}
