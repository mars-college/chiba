FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    yt-dlp \
    unzip \
    zip \
    awscli \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY config ./config
COPY docs ./docs
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

CMD ["pnpm", "-C", "apps/control-api", "dev"]
