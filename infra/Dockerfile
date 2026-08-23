FROM rust:1.95-slim-bookworm AS builder

WORKDIR /app

COPY cli/Cargo.toml cli/Cargo.lock ./

RUN mkdir -p src/commands && \
    echo 'pub mod chunker; pub mod commands; pub mod config; pub mod db; pub mod embedding; pub mod models; pub mod openrouter; pub mod scanner;' > src/lib.rs && \
    echo 'fn main() {}' > src/main.rs && \
    echo 'pub mod index; pub mod delete; pub mod rebuild;' > src/commands/mod.rs && \
    touch src/commands/index.rs src/commands/delete.rs src/commands/rebuild.rs && \
    touch src/chunker.rs src/config.rs src/db.rs src/embedding.rs src/models.rs src/openrouter.rs src/scanner.rs

RUN cargo build --release && rm -rf src

COPY cli/src ./src
COPY cli/Cargo.toml cli/Cargo.lock ./
COPY infra/migrations /infra/migrations

RUN touch src/main.rs src/lib.rs && \
    find src -name '*.rs' -exec touch {} + && \
    cargo build --release && \
    cp target/release/docs-indexer /usr/local/bin/docs-indexer

FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/docs-indexer /usr/local/bin/docs-indexer

ENTRYPOINT ["/usr/local/bin/docs-indexer"]