#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run check
npm --prefix frontend run build
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --release --locked
