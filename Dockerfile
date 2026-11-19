# ============ Builder: 编译 TypeScript ============
FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY ./ /app

RUN --mount=type=cache,target=/root/.npm npm run bootstrap

# ============ 生产依赖层 ============
# 单独一层装 omit=dev 依赖：curl-cffi 的 native libcurl 需要 install.cjs 手动落盘，
# 放在 builder 里会因为 devDependencies 一起装而体积翻倍。
FROM node:24-bookworm-slim AS prod-deps

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./

RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --omit=dev \
 # curl-cffi 跳过 --ignore-scripts 后需手动跑 install，才能装上 native libcurl；
 # 不补这一步运行时报 "Global libs directory not found"，被迫降级到 native fetch。
 && node node_modules/curl-cffi/scripts/install.cjs

# ============ 最终镜像：SearXNG + agent-search 单容器 ============
# 基础镜像直接用 SearXNG 官方镜像，省掉自己维护 Python 3.14 + 全套依赖。
# node 二进制来自 Debian bookworm（glibc 2.4x），与 Void 的 glibc 2.41 兼容，
# 已实测 `node -v` 可直接运行，无需包管理器。
FROM searxng/searxng:latest

COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=prod-deps /app/node_modules /app/node_modules

ENV NODE_ENV=production
# 同容器内走回环，不再依赖外部 SearXNG 地址
ENV SEARXNG_URL=http://127.0.0.1:8080
ENV MCP_HTTP_PORT=1234

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080 1234

ENTRYPOINT ["/entrypoint.sh"]
