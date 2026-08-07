import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
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

export function parseGitHubJson<T>(source: string, context: string): T {
  if (!source.trim()) throw new GakuchoError(`GitHub returned an empty JSON response while ${context}.`);
  try {
    return JSON.parse(source) as T;
  } catch (error) {
    throw new GakuchoError(`GitHub returned invalid JSON while ${context}: ${String(error)}`);
  }
}

async function ghJson<T>(args: readonly string[], context: string): Promise<T> {
  let latest: GakuchoError | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await run("gh", args);
    try {
      return parseGitHubJson<T>(result.stdout, context);
    } catch (error) {
      latest = error as GakuchoError;
      if (attempt < 3) await delay(attempt * 250);
    }
  }
  throw new GakuchoError(`${latest?.message ?? `GitHub JSON failed while ${context}.`} Retried 3 times.`);
}

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
  const current = await ghJson<Array<{ name: string }>>([
    "label",
    "list",
    "--repo",
    normalized,
    "--limit",
    "1000",
    "--json",
    "name",
  ], `listing labels for ${normalized}`);
  const existing = new Set(
    current.map((label) => label.name.toLowerCase()),
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
  const normalized = normalizeRepoIdentity(repo);
  const payload = await ghJson<{ hasIssuesEnabled?: boolean }>(
    ["repo", "view", normalized, "--json", "hasIssuesEnabled"],
    `checking issue settings for ${normalized}`,
  );
  if (!payload.hasIssuesEnabled) throw new GakuchoError(`GitHub Issues are disabled for ${repo}.`);
}

export async function readyIssueCount(repo: string): Promise<number> {
  const normalized = normalizeRepoIdentity(repo);
  const result = await ghJson<unknown[]>([
    "issue",
    "list",
    "--repo",
    normalized,
    "--state",
    "open",
    "--label",
    "symphony-ready",
    "--limit",
    "100",
    "--json",
    "number",
  ], `listing ready issues for ${normalized}`);
  return result.length;
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
