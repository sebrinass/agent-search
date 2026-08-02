# ============ Builder ============
FROM node:lts-slim AS builder

WORKDIR /app

COPY ./ /app

RUN --mount=type=cache,target=/root/.npm npm run bootstrap

# ============ Release ============
FROM node:lts-slim AS release

# curl-cffi 的 glibc 变体（@tocha688/libcurl-linux-x64-gnu）运行时需要 libcurl4；
# ca-certificates 供 HTTPS 校验。
RUN apt-get update && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends libcurl4 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

ENV NODE_ENV=production

RUN npm ci --ignore-scripts --omit-dev \
 # curl-cffi 需要跳过 --ignore-scripts 后手动跑 install 脚本，才能装上 native libcurl。
 # 不补上这一步运行时报 "Global libs directory not found"，被迫降级到 native fetch。
 && node node_modules/curl-cffi/scripts/install.cjs

ENTRYPOINT ["node", "dist/index.js"]
