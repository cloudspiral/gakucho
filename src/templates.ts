import { basename } from "node:path";
import type { Profile } from "./types.ts";
import { canonicalRemote, normalizeRepoIdentity } from "./project-ref.ts";

export interface ProfileContract {
  installCommand?: string;
  checkCommand?: string;
  sourceFiles: Record<string, string>;
}

function normalizedPackage(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return value && /^[a-z_]/.test(value) ? value : `project_${value || "app"}`;
}

export function profileContract(profile: Profile, projectName: string): ProfileContract {
  if (profile === "bun") {
    return {
      installCommand: "bun install --frozen-lockfile",
      checkCommand: "bun run check",
      sourceFiles: {
        "package.json": `${JSON.stringify(
          {
            name: projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"),
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              typecheck: "tsc --noEmit",
              test: "bun test",
              check: "bun run typecheck && bun test",
            },
            devDependencies: {
              "@types/bun": "^1.2.21",
              typescript: "^5.9.2",
            },
          },
          null,
          2,
        )}\n`,
        "tsconfig.json": `${JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "Bundler",
              allowImportingTsExtensions: true,
              types: ["bun"],
              strict: true,
              noEmit: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: true,
            },
            include: ["src"],
          },
          null,
          2,
        )}\n`,
        "src/index.ts": `export function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`,
        "src/index.test.ts": `import { describe, expect, test } from "bun:test";\nimport { greet } from "./index.ts";\n\ndescribe("greet", () => {\n  test("returns a deterministic greeting", () => {\n    expect(greet("world")).toBe("Hello, world!");\n  });\n});\n`,
        ".github/workflows/ci.yml": bunCi(),
      },
    };
  }

  if (profile === "python-uv") {
    const packageName = normalizedPackage(projectName);
    return {
      installCommand: "uv sync --frozen",
      checkCommand: "uv run ruff check . && uv run pytest",
      sourceFiles: {
        "pyproject.toml": `[project]\nname = "${projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}"\nversion = "0.1.0"\ndescription = ""\nrequires-python = ">=3.12"\ndependencies = []\n\n[dependency-groups]\ndev = [\n  "pytest>=8.4.0",\n  "ruff>=0.12.0",\n]\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n\n[tool.hatch.build.targets.wheel]\npackages = ["src/${packageName}"]\n\n[tool.pytest.ini_options]\npythonpath = ["src"]\n`,
        [`src/${packageName}/__init__.py`]: `def greet(name: str) -> str:\n    return f"Hello, {name}!"\n`,
        "tests/test_smoke.py": `from ${packageName} import greet\n\n\ndef test_greet() -> None:\n    assert greet("world") == "Hello, world!"\n`,
        ".github/workflows/ci.yml": pythonCi(),
      },
    };
  }

  return { sourceFiles: {} };
}

export function projectReadme(projectName: string, profile: Profile): string {
  const contract = profileContract(profile, projectName);
  const commands = contract.installCommand
    ? `\n\`\`\`sh\n${contract.installCommand}\n${contract.checkCommand}\n\`\`\`\n`
    : "\nThis blank profile intentionally makes no language or package-manager assumptions.\n";
  return `# ${projectName}\n\nDescribe the project here.\n\n## Development\n${commands}\n## Agent tasks\n\nUse the GitHub **Agent task** issue form or:\n\n\`\`\`sh\ngakucho task ${basename(projectName)} "Task title" --body-file task.md\n\`\`\`\n\nOnly issues labeled \`symphony-ready\` are processed. Agent pull requests remain for human review.\n`;
}

export function agentsFile(profile: Profile): string {
  const contract = profileContract(profile, "project");
  const toolchain = profile === "bun"
    ? "Use Bun for installs, scripts, execution, and tests."
    : profile === "python-uv"
    ? "Use uv for environments and execution; do not use raw pip or manually activate a virtualenv."
    : "Follow the repository's existing toolchain and documented verification commands.";
  return `# Repository agent instructions\n\n- Work only in the provided repository workspace.\n- Treat the GitHub issue as the scope boundary and preserve unrelated changes.\n- ${toolchain}\n- Inspect existing code and documentation before editing.\n- Add or update focused tests for behavior changes.\n- Run ${contract.checkCommand ? `\`${contract.checkCommand}\`` : "the complete documented check"} before handoff.\n- Never force-push, push the default branch, merge, release, deploy, or expose credentials.\n- Commit and push only through \`gakucho git-handoff\`.\n- Leave a reviewable pull request and the issue in \`human-review\`.\n`;
}

export function workflowFile(
  repoInput: string,
  profile: Profile,
  defaultBranch: string,
): string {
  const repo = normalizeRepoIdentity(repoInput);
  const contract = profileContract(profile, repo.split("/")[1]!);
  const bootstrap = contract.installCommand ? `\n    ${contract.installCommand}` : "";
  const check = contract.checkCommand ?? "the repository's documented complete verification command";
  return `---
tracker:
  kind: github
  provider:
    repo: ${repo}
    token: $GITHUB_TOKEN
  required_labels:
    - symphony-ready
  active_states:
    - open
  terminal_states:
    - closed
polling:
  interval_ms: 30000
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  after_create: |
    git clone --origin origin ${canonicalRemote(repo)} .
    issue_key="$(basename "$PWD" | tr '[:upper:]' '[:lower:]')"
    git switch -c "symphony/${"${issue_key}"}" "origin/${defaultBranch}"${bootstrap}
  timeout_ms: 600000
agent:
  max_concurrent_agents: 1
  max_turns: 12
  max_retry_backoff_ms: 300000
codex:
  command: codex --config shell_environment_policy.inherit=all app-server
  approval_policy: on-request
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
    networkAccess: true
---

You are the unattended implementation agent for GitHub issue \`{{ issue.identifier }}\` in \`${repo}\`.

{% if attempt %}
This is follow-up attempt #{{ attempt }}. Resume from the existing workspace and workpad.
{% endif %}

Issue number: {{ issue.native_ref.number }}
Title: {{ issue.title }}
State: {{ issue.state }}
Labels: {{ issue.labels }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description was provided.
{% endif %}

## Operating contract

1. Work only in the repository copy Symphony prepared.
2. Read \`AGENTS.md\`, \`README.md\`, and relevant tests before editing.
3. Treat the issue as the complete scope boundary; avoid unrelated cleanup.
4. Continue autonomously unless a credential, permission, or product decision genuinely blocks completion.
5. Never force-push, push \`${defaultBranch}\`, merge, release, deploy, alter repository settings, or expose credentials.
6. Use the injected \`github_api\` tool for issue comments, labels, pull requests, and check inspection.

## Persistent workpad

Maintain exactly one issue comment whose first line is \`## Symphony Workpad\`.

- List comments with \`GET /repos/${repo}/issues/{{ issue.native_ref.number }}/comments\`.
- Reuse the existing workpad or create it with \`POST /repos/${repo}/issues/{{ issue.native_ref.number }}/comments\`.
- Update the same comment with \`PATCH /repos/${repo}/issues/comments/<comment-id>\`.
- Record acceptance criteria, progress, exact validation, pull request, and blockers.

## Branch and pull-request recovery

Before editing, inspect the current branch and query pull requests for this issue's existing Symphony branches.

- If an open pull request exists, reuse its branch, workspace, workpad, and PR.
- If the prior PR was merged or closed, fetch \`origin/${defaultBranch}\`, create a fresh branch named
  \`symphony/gh-{{ issue.native_ref.number }}-attempt-<n>\` where \`<n>\` is the next integer at least 2,
  and open a new PR. Never push another commit to a merged or closed branch.
- If the acceptance criteria are already satisfied, record evidence, add \`human-review\`, and remove
  \`symphony-ready\` without manufacturing an unnecessary change.

## Implementation loop

1. Establish the current behavior or a focused failing test when practical.
2. Implement the smallest complete change with focused regression coverage.
3. Run focused checks while iterating, then run \`${check}\`.
4. Review \`git diff\`, \`git diff --check\`, and \`git status\`; stage only in-scope files.
5. Commit with \`gakucho git-handoff commit "<comprehensive message>"\`. Do not invoke \`git commit\` directly.
6. Push with \`gakucho git-handoff push\`. Do not invoke \`git push\` directly.
7. Open or update a PR against \`${defaultBranch}\` with a summary, exact validation, limitations, and
   \`Closes #{{ issue.native_ref.number }}\`.
8. Inspect GitHub Actions. Fix in-scope failures and recheck within the turn budget.
9. Put the PR URL and final check state in the workpad.

## Handoff

When the PR is reviewable and checks pass, add \`human-review\`, remove \`symphony-blocked\` if present,
then remove \`symphony-ready\` as the final tracker mutation. Do not merge or close the issue.

For a true external blocker, record it, add \`symphony-blocked\`, and remove \`symphony-ready\` last.

Your final response must contain only the completed outcome, validation, PR URL, and any true blocker.
`;
}

export function issueForms(): Record<string, string> {
  return {
    ".github/ISSUE_TEMPLATE/agent-task.yml": `name: Agent task\ndescription: Authorize Symphony to implement a ready, bounded task\ntitle: ""\nlabels: ["symphony-ready"]\nbody:\n  - type: textarea\n    id: goal\n    attributes:\n      label: Goal\n      description: What outcome should the agent produce?\n    validations:\n      required: true\n  - type: textarea\n    id: acceptance\n    attributes:\n      label: Acceptance criteria\n      description: List the observable conditions that define completion.\n    validations:\n      required: true\n  - type: textarea\n    id: verification\n    attributes:\n      label: Required verification\n      description: Which tests or checks must pass?\n    validations:\n      required: true\n  - type: textarea\n    id: context\n    attributes:\n      label: Context\n      description: Optional constraints, references, or non-goals.\n`,
    ".github/ISSUE_TEMPLATE/backlog.yml": `name: Backlog\ndescription: Record an idea without authorizing an autonomous run\ntitle: ""\nlabels: []\nbody:\n  - type: textarea\n    id: idea\n    attributes:\n      label: Idea or problem\n      description: What should be explored or considered?\n    validations:\n      required: true\n  - type: textarea\n    id: notes\n    attributes:\n      label: Notes\n      description: Optional context, links, or open questions.\n`,
    ".github/ISSUE_TEMPLATE/config.yml": `blank_issues_enabled: false\ncontact_links: []\n`,
  };
}

export function commonNewFiles(
  projectName: string,
  repo: string,
  profile: Profile,
  defaultBranch: string,
): Record<string, string> {
  return {
    "README.md": projectReadme(projectName, profile),
    "AGENTS.md": agentsFile(profile),
    "WORKFLOW.md": workflowFile(repo, profile, defaultBranch),
    ".gitignore": commonGitignore(profile),
    ...issueForms(),
  };
}

function commonGitignore(profile: Profile): string {
  const shared = [".DS_Store", "*.log"];
  if (profile === "bun") shared.push("node_modules/", "coverage/", "dist/");
  if (profile === "python-uv") shared.push(".venv/", "__pycache__/", ".pytest_cache/", ".ruff_cache/", "*.pyc");
  return `${shared.join("\n")}\n`;
}

function bunCi(): string {
  return `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: "1.3.14"\n      - run: bun install --frozen-lockfile\n      - run: bun run check\n`;
}

function pythonCi(): string {
  return `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: astral-sh/setup-uv@v6\n      - run: uv python install 3.12\n      - run: uv sync --frozen\n      - run: uv run ruff check .\n      - run: uv run pytest\n`;
}
