# Worker box for cash.trading (fly.io): depth capture + vault crank loop.
# The aptos CLI is baked in for the phase-2 compile-service sidecar
# (Vercel serverless can't run the Move compiler).
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# aptos CLI (pinned)
ARG APTOS_CLI_VERSION=8.0.0
RUN curl -fsSL -o /tmp/aptos.zip \
  "https://github.com/aptos-labs/aptos-core/releases/download/aptos-cli-v${APTOS_CLI_VERSION}/aptos-cli-${APTOS_CLI_VERSION}-Linux-x86_64.zip" \
  && unzip /tmp/aptos.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/aptos \
  && rm /tmp/aptos.zip \
  && aptos --version

WORKDIR /app
COPY infra/fly/package.json ./package.json
RUN npm install --omit=dev

COPY scripts/depth-capture-worker.mjs scripts/crank-loop.mjs ./scripts/

# Process selected per fly.toml [processes]; default to the crank loop.
CMD ["node", "scripts/crank-loop.mjs"]
