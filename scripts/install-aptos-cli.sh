#!/usr/bin/env bash
# Install the aptos CLI (pinned) into ./.aptos-cli/ — works behind the CCR
# proxy, where the npm wrapper's own downloader fails (Node fetch ignores
# HTTPS_PROXY) but curl succeeds. Verified working in the CCR sandbox.
set -euo pipefail
VERSION="${APTOS_CLI_VERSION:-8.1.0}"
PLATFORM="${APTOS_CLI_PLATFORM:-Ubuntu-22.04-x86_64}"
DEST="${1:-.aptos-cli}"
mkdir -p "$DEST"
URL="https://github.com/aptos-labs/aptos-core/releases/download/aptos-cli-v${VERSION}/aptos-cli-${VERSION}-${PLATFORM}.zip"
echo "downloading aptos CLI v${VERSION} (${PLATFORM})…"
curl -sSL --max-time 300 -o "$DEST/aptos-cli.zip" "$URL"
python3 -c "import zipfile,sys; zipfile.ZipFile('$DEST/aptos-cli.zip').extractall('$DEST')"
chmod +x "$DEST/aptos"
rm "$DEST/aptos-cli.zip"
"$DEST/aptos" --version
echo "installed. export APTOS_BIN=$(cd "$DEST" && pwd)/aptos"
