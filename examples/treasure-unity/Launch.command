#!/bin/zsh
set -e
cd "$(dirname "$0")/../.."
if [[ ! -d node_modules ]]; then npm ci; fi
npm run build
exec node examples/treasure-unity/serve.mjs --open
