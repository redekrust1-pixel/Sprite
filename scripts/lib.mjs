import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Variável ${name} ausente.`);
  return value;
};

export const endpoint = () => `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;

export const awsEnv = () => ({
  ...process.env,
  AWS_ACCESS_KEY_ID: env('R2_ACCESS_KEY_ID'),
  AWS_SECRET_ACCESS_KEY: env('R2_SECRET_ACCESS_KEY'),
  AWS_DEFAULT_REGION: 'auto',
  AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
  AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
});

/** Roda um binário sem nunca repassar a linha de comando (pode conter URL assinada) a quem captura o erro. */
export async function exec(file, args, { timeoutMs = 600_000, maxBuffer = 512 * 1024 * 1024, stderr: wantStderr = false } = {}) {
  try {
    const { stdout, stderr } = await run(file, args, { env: awsEnv(), timeout: timeoutMs, maxBuffer });
    return wantStderr ? stderr : stdout;
  } catch (error) {
    const stderr = String(error.stderr ?? '').split('\n').filter(Boolean).slice(-3).join(' | ');
    throw Object.assign(
      new Error(`${file} falhou (${error.killed ? 'timeout' : `código ${error.code}`}): ${scrub(stderr)}`),
      { exitCode: error.code, silent: stderr === '' },
    );
  }
}

/** Remove URLs (inclusive as assinadas) de qualquer texto que vá para o log. */
export const scrub = (text) => String(text).replace(/https?:\/\/\S+/g, '<url>');

export const aws = (args, options) => exec('aws', [...args, '--endpoint-url', endpoint()], options);

/** movies/123/source.mp4 -> 123_movie ; tv/45/season-02/episode-07/source.mp4 -> 45_series_s2_e7 */
export function spriteName(videoKey) {
  let match = /^movies\/(\d+)\/source\.mp4$/.exec(videoKey);
  if (match) return `${match[1]}_movie`;
  match = /^tv\/(\d+)\/season-(\d+)\/episode-(\d+)\/source\.mp4$/.exec(videoKey);
  if (match) return `${match[1]}_series_s${Number(match[2])}_e${Number(match[3])}`;
  return null;
}

/** Mesma regra do detection.service.js do DioneyFlix: 1 quadro/10 s, no máximo 720, grade quase quadrada. */
export function layout(duration) {
  let interval = 10;
  let frames = Math.floor(duration / interval);
  if (frames > 720) {
    interval = Math.ceil(duration / 720);
    frames = Math.floor(duration / interval);
  }
  if (frames < 4) return null;
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  return { interval, frames, cols, rows, tileW: 160, tileH: 90 };
}

const pad = (n, size = 2) => String(n).padStart(size, '0');

export function vttTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const ms = Math.floor((totalSec - Math.floor(totalSec)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export function buildVtt({ interval, frames, cols, tileW, tileH }, duration, jpgName) {
  const lines = ['WEBVTT', ''];
  for (let i = 0; i < frames; i += 1) {
    const x = (i % cols) * tileW;
    const y = Math.floor(i / cols) * tileH;
    lines.push(`${vttTime(i * interval)} --> ${vttTime(Math.min((i + 1) * interval, duration))}`);
    lines.push(`${jpgName}#xywh=${x},${y},${tileW},${tileH}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Retorna o início dos créditos em segundos absolutos e se veio de preto+silêncio (true) ou do palpite (false). */
export function pickCredits(stderr, duration, tailStart) {
  const black = [...stderr.matchAll(/black_start:([\d.]+).*?black_end:([\d.]+)/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
  }));
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const silences = starts.map((start, i) => ({ start, end: ends[i] ?? start + 1 }));

  let relative = null;
  outer: for (const b of black) {
    for (const s of silences) {
      if (Math.min(b.end, s.end) - Math.max(b.start, s.start) >= 1) {
        relative = Math.min(b.start, s.start);
        break outer;
      }
    }
  }

  let creditsStart = relative !== null ? Math.round(tailStart + relative) : Math.round(duration - 90);
  creditsStart = Math.max(creditsStart, Math.round(tailStart));
  creditsStart = Math.min(creditsStart, Math.round(duration - 30));
  return { creditsStart, detected: relative !== null };
}

