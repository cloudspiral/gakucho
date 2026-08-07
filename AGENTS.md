# Repository instructions

## Scope

- Gakucho is a thin, Symphony-specific macOS CLI. Do not add a daemon, database,
  scheduler, web UI, generic engine abstraction, or cross-platform layer.
- The official OpenAI Symphony checkout is an external pinned runtime and must
  never be modified by this repository.
- Preserve the labeled-only queue: only `symphony-ready` issues are routable.

## Development

- Use Bun for dependencies, scripts, tests, and local execution.
- Run `bun run check` before every commit.
- Add focused tests for path, registry, subprocess, template, and lifecycle
  behavior. Never make live GitHub or launchd calls from ordinary unit tests.
- Keep credentials out of files, subprocess arguments, diagnostics, fixtures,
  snapshots, and logs.

## Git

- Make comprehensive commits that describe every material change, rationale,
  and validation result. Longer commit bodies are preferred to incomplete ones.
- Never force-push, auto-merge, release, deploy, or delete remote repositories.
- Stage only files belonging to the active change.
