# Gakuchō

Gakuchō (`gakucho`) is an unofficial macOS companion CLI for the
[OpenAI Symphony](https://github.com/openai/symphony) engineering preview. It
bootstraps GitHub repositories for Symphony and operates one local Symphony
LaunchAgent per enrolled repository.

Gakuchō deliberately does not poll issues, schedule agents, supervise Codex,
or replace Symphony. Symphony owns those responsibilities; macOS `launchd`
owns process restarts.

> This is an independent project. It is not an official OpenAI product and is
> not supported by OpenAI.

## Requirements

- macOS
- [Bun](https://bun.sh/)
- Git and an authenticated [GitHub CLI](https://cli.github.com/)
- Codex (the ChatGPT app bundle is supported)
- `mise`, Erlang/OTP 28, and Elixir 1.19
- A clean, pinned local checkout of OpenAI Symphony

## Install

```sh
bun install --frozen-lockfile
bun run check
ln -s "$PWD/bin/gakucho" "$HOME/bin/gakucho"
```

Make sure `~/bin` is on `PATH`. For unattended commits and pushes, add exact
Codex rules for `gakucho git-handoff commit` and
`gakucho git-handoff push`; `gakucho doctor` prints a specific failure when
they are missing.

The intended rules are deliberately narrow:

```starlark
prefix_rule(
    pattern = ["gakucho", "git-handoff", "commit"],
    decision = "allow",
    justification = "Allow commits only through Gakucho's registry-backed validator",
)
prefix_rule(
    pattern = ["gakucho", "git-handoff", "push"],
    decision = "allow",
    justification = "Allow issue-branch pushes only through Gakucho's registry-backed validator",
)
```

Do not allow raw `git commit`, raw `git push`, a shell, or arbitrary Gakucho
commands for unattended work.

## Use

Create a new private Bun project and start its watcher:

```sh
gakucho new ~/Developer/personal/my-app --profile bun --start
```

Adopt an existing repository without rewriting application files:

```sh
gakucho init ~/Developer/personal/existing-api --profile python-uv
gakucho add ~/Developer/personal/existing-api --start
```

Queue work:

```sh
gakucho task my-app "Build the first vertical slice" --body-file task.md
```

Inspect the fleet:

```sh
gakucho status
gakucho doctor
gakucho logs my-app --follow
```

Other lifecycle commands are `start`, `stop`, `restart`, and `remove`.
`gakucho init <path> --profile <profile>` adds only missing factory assets to
an existing GitHub repository; it never commits, pushes, registers, or starts
anything. `gakucho add <path>` enrolls the repository, disabled by default.
All mutating creation/adoption commands that support `--dry-run` perform their
checks and print an ordered plan without changing local or GitHub state.

Only open issues carrying `symphony-ready` are dispatched. A successful agent
handoff adds `human-review` and removes `symphony-ready`; Gakuchō never merges
the pull request.

## Runtime ownership

- Registry: `~/.config/gakucho/config.yaml`
- Runners: `~/Library/Application Support/Gakucho/instances/`
- LaunchAgents: `~/Library/LaunchAgents/dev.gakucho.*.plist`
- Logs: `~/Library/Logs/Gakucho/`
- Workspaces: `~/Developer/symphony-workspaces/`

`gakucho remove` removes only its registry/runtime ownership. Source checkouts,
GitHub repositories, logs, workspaces, issues, and pull requests are preserved.

The guarded handoff accepts only a registered `GH-<number>` workspace on a
matching `symphony/gh-<number>` branch (or a numbered `-attempt-<n>` branch),
with the repository's canonical HTTPS origin. It rejects detached/default
branches, mismatched remotes, force pushes, unstaged commits, and extra
arguments.

## Migration and rollback

When replacing an older repository-specific Symphony LaunchAgent, preserve its
plist, runner, helper, logs, and workspace before enabling Gakucho. Start the
Gakucho service only after the old label is unloaded and no ready-labeled issue
is waiting. To roll back:

1. `gakucho stop owner/repo`.
2. If the repository workflow still calls `gakucho git-handoff`, keep the
   disabled registry entry; restore the archived LaunchAgent plist and bootstrap
   it only after confirming the Gakucho service is unloaded.
3. For a full Gakucho removal, first restore and publish the pre-migration
   workflow/helper contract. Then restore the archived helper and only its exact
   Codex rules, run `gakucho remove owner/repo`, and bootstrap the old LaunchAgent.
4. Verify the legacy dashboard and an inert ready queue before routing work.

Do not remove a registry entry while its active workflow still depends on the
central Gakucho handoff: the guard intentionally rejects unregistered
workspaces.

Gakucho never deletes legacy logs or workspaces, so those remain available for
forensics and rollback.

## License

Apache-2.0. See [LICENSE](LICENSE).
