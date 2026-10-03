# Sprite

Gera sprites de hover da barra de progresso (mosaico `.jpg` + `.vtt`, 160×90 px, 1 quadro a cada 10 s)
a partir dos vídeos do R2 e envia de volta ao R2. Mesmo formato do `detection.service.js` do DioneyFlix.

- Vídeos: `movies/{tmdb}/source.mp4` e `tv/{tmdb}/season-SS/episode-EE/source.mp4`
- Sprites: `{prefixo}{tmdb}_movie.jpg|vtt` e `{prefixo}{tmdb}_series_s{S}_e{E}.jpg|vtt`

## Configuração (Settings → Secrets and variables → Actions)

| Tipo | Nome |
|---|---|
| Secret | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| Variable | `R2_ACCOUNT_ID`, `R2_BUCKET` |

## Uso

Actions → **sprites** → *Run workflow*. O padrão gera 20 sprites em `sprites-test/`.
Para produção use `dest_prefix = sprites/`. O que já tem `.jpg` no prefixo é pulado.

O repositório é público: os scripts nunca imprimem chaves nem URLs assinadas.

## Rodar sozinho (encadeado)

Com `rounds` maior que 1, no fim de cada rodada o workflow dispara a próxima com o próprio `GITHUB_TOKEN`
(`scripts/next.mjs`), sem ninguém clicar:

- continua enquanto a rodada tiver ao menos um sucesso; quem falhou é pulado na próxima (`offset` acumula);
- **para** se uma rodada só tiver falhas, se acabarem as `rounds`, ou se não houver mais nada pendente;
- `then` (ex.: `credits,intro`) encadeia o próximo modo quando o atual termina, usando `markers/` e `intros/`.
  Só encadeia com prefixo de produção (prefixos `*-test/` nunca encadeiam).

Exemplo (um clique): `mode=sprites`, `dest_prefix=sprites/`, `limit=10000`, `chunks=20`, `rounds=30`.
