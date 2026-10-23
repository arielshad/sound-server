FROM node:22-alpine AS build
WORKDIR /app
# .npmrc skips onnxruntime-node's CUDA download (dev-only CLAP dependency).
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY integrations ./integrations
COPY web ./web
# Server (tsc) first: the website build reads the provider list from dist/.
ENV ASTRO_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Optional image with CLAP embeddings (SOUND_SERVER_EMBEDDINGS=1):
#   docker build --target ml -t ghcr.io/arielshad/sound-server:ml .
# onnxruntime-node ships glibc binaries only (it does not load on Alpine/musl,
# not even with gcompat), so this variant runs on Debian 13 slim (trixie: its ffmpeg 7 supports
# the ebur128 options analysis uses; bookworm's 5.1 does not). It adds
# @huggingface/transformers + onnxruntime-node (CPU, this arch only); the model
# itself (~160 MB) is downloaded at first use into SOUND_SERVER_DATA_DIR/models.
FROM node:22-trixie-slim AS deps-ml
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# transformers is a devDependency (an optional peer for npm users); promote it
# to a dependency here so the production install keeps it, at the locked version.
RUN npm pkg set "dependencies.@huggingface/transformers=4.3.1" \
  && npm pkg delete "devDependencies.@huggingface/transformers" \
  && npm install --omit=dev --no-audit --no-fund \
  && arch="$(node -p process.arch)" \
  && find node_modules/onnxruntime-node/bin/napi-v6 -mindepth 2 -maxdepth 2 -type d ! -path "*/linux/${arch}" -exec rm -rf {} + \
  && rm -rf node_modules/onnxruntime-web/dist \
  && npm cache clean --force

FROM node:22-trixie-slim AS ml
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8787
COPY --from=deps-ml /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/cli.js", "serve"]

# ---------------------------------------------------------------------------
# Default image (last stage, what `docker build .` produces): Alpine, no CLAP.
# The persistent store (SOUND_SERVER_DATA_DIR) uses Node's built-in
# node:sqlite, so it needs no native module here.
FROM node:22-alpine
WORKDIR /app
# ffmpeg/ffprobe for audio analysis (duration, loudness, BPM/key) and waveforms.
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/cli.js", "serve"]
