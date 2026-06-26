#!/usr/bin/env bash

set -euo pipefail

VERSION="18.0.8"
BASE_URL="https://unpkg.com/stockfish@${VERSION}/bin"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${ROOT_DIR}/stockfish"

mkdir -p "${TARGET_DIR}"

curl --fail --location --retry 3 \
    "${BASE_URL}/stockfish-18-lite-single.js" \
    --output "${TARGET_DIR}/stockfish-18-lite-single.js"

curl --fail --location --retry 3 \
    "${BASE_URL}/stockfish-18-lite-single.wasm" \
    --output "${TARGET_DIR}/stockfish-18-lite-single.wasm"

echo "Stockfish 18 files downloaded to: ${TARGET_DIR}"
