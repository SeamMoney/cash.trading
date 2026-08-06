# Worker box for cash.trading (fly.io): depth capture + legacy vault crank loop.
#
# Deliberately lean. This image used to carry the pinned Aptos CLI, a second npm
# tree with tsx + the Aptos SDK, and the whole of lib/ — all of it for a
# sealed-vault attestor process and a "phase-2 compile-service sidecar" that
# were never wired up. Both are closed (docs/MASTER-PLAN.md WS5.2):
#
#   - the attestor runs on Vercel Cron, which loops every vault in one
#     invocation instead of one Fly machine per vault;
#   - the sealed rail never compiles Move at runtime — the transpiler emits Move
#     source only to hash it into the program commitment, and the modules are
#     published once by us rather than per vault.
#
# So the CLI came out. The two workers below are plain .mjs with one dependency
# between them (`pg`); keep it that way.
FROM node:20-slim

WORKDIR /app
COPY infra/fly/package.json ./package.json
RUN npm install --omit=dev

COPY scripts/depth-capture-worker.mjs scripts/crank-loop.mjs ./scripts/

# Process selected per fly.toml [processes]; default to the crank loop.
CMD ["node", "scripts/crank-loop.mjs"]
