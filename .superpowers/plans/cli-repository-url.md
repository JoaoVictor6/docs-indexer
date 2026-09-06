## Problem Statement

The `mcp` servers `get_document` tool requires the `projects.repository_url` column to be set so it can fetch full document content from the Git source of truth. Today, the Rust CLI always upserts projects with `repository_url = NULL` — operators must run a manual `UPDATE` SQL statement after every new project:

```sql
UPDATE projects SET repository_url = https://github.com/acme/payments-docs.git WHERE name = payments;
```

This is fragile, error-prone, and undocumented in the quick-start flow. The CLI should accept `--repository-url` and `--provider` flags so the URL is persisted at index/rebuild time.

## Solution

Add `--repository-url` and `--provider` as optional flags to the `index` and `rebuild` subcommands. When `--repository-url` is not provided, attempt to resolve it from the repository directory via `git remote get-url origin`. If both the flag and the git remote are unavailable, the field remains `NULL` (preserving any previously-set value thanks to the `COALESCE` in the upsert query).

## Commits

### Commit 1: Add `resolve_git_remote_url` helper function

Add a new function that takes a `&Path` (repository root) and returns `Option<String>` by running `git -C <path> remote get-url origin`. The function trims trailing whitespace/newlines from the output. If the command fails (no git repo, no origin remote, or git not installed), it returns `None`. Place this function in `cli/src/main.rs` (near the bottom, before `main`) or in a new `cli/src/git.rs` module exposed via `lib.rs`.

**Verification:** `cargo test --lib` passes. No existing code calls this function yet.

### Commit 2: Update `index::run` signature and add git remote fallback

- Add `repository_url: Option<&str>` and `provider: Option<&str>` parameters to `commands::index::run`.
- Inside the function, resolve the effective URL: `let effective_url = repository_url.or_else(|| resolve_git_remote_url(repository));`.
- Pass `effective_url.as_deref()` and `provider` to `db::upsert_project` instead of the current `None` literals.
- Update the integration test call in `cli/tests/integration_test.rs` to pass `None` for both new parameters (the test uses temp dirs that are not git repos, so the fallback naturally returns `None`).

**Verification:** `cargo test --lib` passes. The integration test compiles (requires live DB to run).

### Commit 3: Update `rebuild::run` signature and add git remote fallback

Same pattern as commit 2, applied to `commands::rebuild::run`.

**Verification:** `cargo test --lib` passes.

### Commit 4: Add `--repository-url` and `--provider` flags to the CLI

- Add `#[arg(long)] repository_url: Option<String>` and `#[arg(long)] provider: Option<String>` to both `Command::Index` and `Command::Rebuild` variants in `main.rs`.
- Update the match arms to extract and pass `repository_url.as_deref()` and `provider.as_deref()` to the `run` calls.

**Verification:** `cargo build` passes. `docs-indexer index --help` shows the new flags.

### Commit 5: Final verification

- `cargo test --lib` passes.
- `cargo build` passes.
- Manual smoke test: `cargo run -- index --project test-project --repository /path/to/git-repo` (without `--repository-url`) should upsert the project with the URL from `git remote get-url origin`.

## Decision Document

- **Module:** `cli/src/commands/index.rs` and `cli/src/commands/rebuild.rs` — function signatures gain two new optional parameters.
- **Module:** `cli/src/main.rs` — CLI subcommands gain two new optional flags; match arms updated; new `resolve_git_remote_url` helper added.
- **Module:** `cli/src/db.rs` — no changes. `upsert_project` already accepts `git_url` and `provider`, and the `COALESCE` in the `ON CONFLICT` clause preserves existing values when `NULL` is passed.
- **Module:** `cli/tests/integration_test.rs` — calls to `index::run` updated to pass `None` for new params.
- **Interface:** `index::run` and `rebuild::run` signatures change. This is a breaking change for any external callers (the integration test is the only caller besides `main.rs`).
- **Git remote fallback:** Only `origin` is tried. If the repo has no `origin` remote, the field stays `NULL` (no error, no warning). The `COALESCE` in the DB query preserves any previously-set value.
- **Provider:** No auto-inference from the URL. When not passed, stays `None`. The MCP server treats `None` and explicit values the same (both GitHub and Bitbucket use HTTP Basic auth).
- **Default branch:** Remains hardcoded as `"main"`. Not exposed as a flag in this change.
- **URL validation:** None. The MCP server validates at runtime. Any string is accepted.
- **URL format:** Full URL (e.g. `https://github.com/acme/payments-docs.git`). The user passes exactly what `git remote get-url origin` returns.

## Testing Decisions

- **Unit tests** (`cargo test --lib`): No new unit tests for `resolve_git_remote_url` since it shells out to `git` and is hard to test in isolation. The existing unit tests for `upsert_project` (in `db.rs`) already cover the COALESCE behavior indirectly via the integration test.
- **Integration test** (`cli/tests/integration_test.rs`): The existing integration test is updated to pass `None` for the new params. It already exercises the full `index::run` pipeline. A new test case for the git remote fallback is not practical because it requires a real git repo in the temp dir.
- **Manual verification:** Smoke test with a real git repo to confirm the `git remote get-url origin` fallback works end-to-end.

## Out of Scope

- Exposing `--default-branch` as a CLI flag (remains hardcoded `"main"`).
- Adding a separate `set-repository-url` subcommand (the `index`/`rebuild` commands are the natural point to set this).
- URL validation (the MCP server is the validation boundary).
- Provider auto-inference from the URL.
- Updating the `README.md` quick-start or `mcp/README.md` to remove the manual SQL workaround (follow-up PR).
- Updating the `prd/` directory (if it exists) or any design docs.
