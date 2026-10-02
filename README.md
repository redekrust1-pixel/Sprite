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
