# Gateway + provider agents (no web console). Runs on linux/arm64 and linux/amd64.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
COPY . .
# Install including devDependencies: tsx (root devDependency) runs the TypeScript entrypoints.
RUN pnpm install --frozen-lockfile
ENV START_WEB=false
# All durable state (SQLite, Parquet, payment journals, CRE artifacts) lives under /app/data -> mount a volume.
VOLUME ["/app/data"]
CMD ["node", "--import", "tsx", "scripts/dev.ts"]
