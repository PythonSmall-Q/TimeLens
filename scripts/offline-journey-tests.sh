#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Running offline critical journey tests..."
cd src-tauri
cargo test --lib data_reliability_cmd::tests -- --nocapture
