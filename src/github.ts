import { readFile } from "node:fs/promises";
import { GakuchoError } from "./errors.ts";
import { normalizeRepoIdentity } from "./project-ref.ts";
import { run } from "./process.ts";

const labels = [
  {
    name: "symphony-ready",
    color: "0E8A16",
    description: "Authorized for autonomous Symphony processing",
  },
  {
    name: "human-review",
    color: "FBCA04",
    description: "Agent work is ready for human review",
  },
  {
    name: "symphony-blocked",
    color: "D93F0B",
    description: "Agent run requires human input or external access",
  },
] as const;

export async function authenticatedOwner(): Promise<string> {
  const result = await run("gh", ["api", "user", "--jq", ".login"]);
  const login = result.stdout.trim();
  if (!login) throw new GakuchoError("GitHub authentication did not return an account login.");
  return login.toLowerCase();
}

export async function verifyGitHubAuth(): Promise<void> {
  await run("gh", ["auth", "status", "--hostname", "github.com"]);
}

export async function repositoryExists(repo: string): Promise<boolean> {
  const normalized = normalizeRepoIdentity(repo);
  const result = await run("gh", ["repo", "view", normalized, "--json", "nameWithOwner"], {
    allowFailure: true,
  });
  return result.code === 0;
}

export async function createRepository(
  repo: string,
  source: string,
  visibility: "private" | "public",
): Promise<void> {
  await run("gh", [
    "repo",
    "create",
    normalizeRepoIdentity(repo),
    visibility === "public" ? "--public" : "--private",
    "--source",
    source,
    "--remote",
    "origin",
    "--push",
  ]);
}

export async function ensureLabels(repo: string): Promise<string[]> {
  const normalized = normalizeRepoIdentity(repo);
  const current = await run("gh", [
    "label",
    "list",
    "--repo",
    normalized,
    "--limit",
    "1000",
    "--json",
    "name",
  ]);
  const existing = new Set(
    (JSON.parse(current.stdout) as Array<{ name: string }>).map((label) => label.name.toLowerCase()),
  );
  const created: string[] = [];
  for (const label of labels) {
    if (existing.has(label.name)) continue;
    await run("gh", [
      "label",
      "create",
      label.name,
      "--repo",
      normalized,
      "--color",
      label.color,
      "--description",
      label.description,
    ]);
    created.push(label.name);
  }
  return created;
}

export async function verifyIssuesEnabled(repo: string): Promise<void> {
  const result = await run("gh", ["repo", "view", normalizeRepoIdentity(repo), "--json", "hasIssuesEnabled"]);
  const payload = JSON.parse(result.stdout) as { hasIssuesEnabled?: boolean };
  if (!payload.hasIssuesEnabled) throw new GakuchoError(`GitHub Issues are disabled for ${repo}.`);
}

export async function readyIssueCount(repo: string): Promise<number> {
  const result = await run("gh", [
    "issue",
    "list",
    "--repo",
    normalizeRepoIdentity(repo),
    "--state",
    "open",
    "--label",
    "symphony-ready",
    "--limit",
    "100",
    "--json",
    "number",
  ]);
  return (JSON.parse(result.stdout) as unknown[]).length;
}

export async function createTask(
  repo: string,
  title: string,
  body: string,
): Promise<string> {
  const result = await run("gh", [
    "issue",
    "create",
    "--repo",
    normalizeRepoIdentity(repo),
    "--title",
    title,
    "--body",
    body,
    "--label",
    "symphony-ready",
  ]);
  const url = result.stdout.trim();
  if (!url.startsWith("https://github.com/")) throw new GakuchoError("GitHub did not return an issue URL.");
  return url;
}

export async function readTaskBody(options: {
  body?: string;
  bodyFile?: string;
}): Promise<string> {
  if (options.body !== undefined) return options.body;
  if (options.bodyFile !== undefined) return await readFile(options.bodyFile, "utf8");
  return "";
}
