# ============ Builder ============
FROM node:lts-slim AS builder

WORKDIR /app

COPY ./ /app

RUN --mount=type=cache,target=/root/.npm npm run bootstrap

# ============ Release ============
FROM node:lts-slim AS release

# Lightpanda 版本（升级时改这里）
ARG LIGHTPANDA_VERSION=0.3.6

RUN apt-get update && apt-get upgrade -y \
 # curl-cffi 的 glibc 变体（@tocha688/libcurl-linux-x64-gnu）运行时需要 libcurl4；
 # ca-certificates 供 HTTPS 校验（curl-cffi 请求 + 下载 Lightpanda）
 && apt-get install -y --no-install-recommends libcurl4 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 下载 Lightpanda x86_64 (glibc) 二进制，作为 Read 第 2 层动态渲染引擎。
# 说明：官方无 musl 版，这也是本镜像从 alpine 换成 debian-slim 的原因。
ADD https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_VERSION}/lightpanda-x86_64-linux /usr/local/bin/lightpanda
RUN chmod +x /usr/local/bin/lightpanda

# 让 lightpanda.ts 的懒探测能找到二进制（与 config.ts 默认路径一致）
ENV LIGHTPANDA_EXECUTABLE_PATH=/usr/local/bin/lightpanda
# 关闭 Lightpanda 默认开启的遥测上报；关闭崩溃时的 core dump（容器内无需保留）
ENV LIGHTPANDA_DISABLE_TELEMETRY=true \
    LIGHTPANDA_DISABLE_CORE_DUMP=true

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

ENV NODE_ENV=production

RUN npm ci --ignore-scripts --omit-dev

ENTRYPOINT ["node", "dist/index.js"]
