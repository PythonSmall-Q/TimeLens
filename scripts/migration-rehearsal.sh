#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Running 1.x -> 2.0 migration rehearsal tests..."
cd src-tauri
cargo test --lib migrations::tests::test_rehearsal_on_fresh_unmigrated_db -- --nocapture
