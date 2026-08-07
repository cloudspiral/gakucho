import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import YAML from "yaml";
import { GakuchoError, errorMessage } from "./errors.ts";
import { normalizeRepoIdentity } from "./project-ref.ts";
import { run } from "./process.ts";
import type { GakuchoConfig, ProjectRecord } from "./types.ts";

interface WorkflowFrontMatter {
  tracker?: {
    kind?: unknown;
    provider?: { repo?: unknown; token?: unknown };
    required_labels?: unknown;
    active_states?: unknown;
    terminal_states?: unknown;
  };
  workspace?: { root?: unknown };
  agent?: { max_concurrent_agents?: unknown };
  server?: { port?: unknown };
}

export async function parseWorkflow(path: string): Promise<WorkflowFrontMatter> {
  const source = await readFile(path, "utf8").catch((error) => {
    throw new GakuchoError(`Unable to read workflow ${path}: ${errorMessage(error)}`);
  });
  if (!source.startsWith("---\n")) throw new GakuchoError("WORKFLOW.md must begin with YAML front matter.");
  const end = source.indexOf("\n---", 4);
  if (end < 0) throw new GakuchoError("WORKFLOW.md front matter is not terminated.");
  try {
    const parsed: unknown = YAML.parse(source.slice(4, end));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("front matter must decode to an object");
    }
    return parsed as WorkflowFrontMatter;
  } catch (error) {
    throw new GakuchoError(`Invalid WORKFLOW.md front matter: ${errorMessage(error)}`);
  }
}

export async function validateWorkflow(path: string, expectedRepo: string): Promise<number | undefined> {
  const workflow = await parseWorkflow(path);
  if (workflow.tracker?.kind !== "github") throw new GakuchoError("WORKFLOW.md tracker.kind must be github.");
  if (typeof workflow.tracker.provider?.repo !== "string") {
    throw new GakuchoError("WORKFLOW.md tracker.provider.repo is required.");
  }
  if (normalizeRepoIdentity(workflow.tracker.provider.repo) !== normalizeRepoIdentity(expectedRepo)) {
    throw new GakuchoError("WORKFLOW.md repository does not match Git origin.");
  }
  if (workflow.tracker.provider.token !== "$GITHUB_TOKEN") {
    throw new GakuchoError("WORKFLOW.md must reference $GITHUB_TOKEN instead of a literal credential.");
  }
  const required = workflow.tracker.required_labels;
  if (!Array.isArray(required) || !required.some((label) =>
    typeof label === "string" && label.trim().toLowerCase() === "symphony-ready"
  )) {
    throw new GakuchoError("WORKFLOW.md must require the symphony-ready label.");
  }
  if (!Array.isArray(workflow.tracker.active_states) || !workflow.tracker.active_states.includes("open")) {
    throw new GakuchoError("WORKFLOW.md active_states must include open.");
  }
  if (!Array.isArray(workflow.tracker.terminal_states) || !workflow.tracker.terminal_states.includes("closed")) {
    throw new GakuchoError("WORKFLOW.md terminal_states must include closed.");
  }
  if (workflow.workspace?.root !== "$SYMPHONY_WORKSPACE_ROOT") {
    throw new GakuchoError("WORKFLOW.md workspace.root must use $SYMPHONY_WORKSPACE_ROOT.");
  }
  if (workflow.agent?.max_concurrent_agents !== 1) {
    throw new GakuchoError("WORKFLOW.md max_concurrent_agents must be 1 in Gakucho v0.1.");
  }
  return typeof workflow.server?.port === "number" ? workflow.server.port : undefined;
}

export async function verifyPinnedSymphony(config: GakuchoConfig): Promise<void> {
  const checkout = resolve(config.symphony.checkout);
  const status = await run("git", ["-C", checkout, "status", "--short"]);
  if (status.stdout.trim()) throw new GakuchoError("Pinned Symphony checkout has local changes.");
  const tag = await run("git", ["-C", checkout, "describe", "--tags", "--exact-match"], {
    allowFailure: true,
  });
  if (tag.code !== 0 || tag.stdout.trim() !== config.symphony.version) {
    throw new GakuchoError(
      `Symphony checkout must be pinned at ${config.symphony.version}; found ${tag.stdout.trim() || "untagged HEAD"}.`,
    );
  }
  const executable = resolve(config.symphony.executable);
  if (!executable.startsWith(`${checkout}/`)) {
    throw new GakuchoError("Symphony executable must remain inside the pinned checkout.");
  }
  await readFile(executable).catch(() => {
    throw new GakuchoError(`Symphony executable not found: ${executable}`);
  });
}

export interface HealthState {
  healthy: boolean;
  counts?: { running: number; retrying: number; blocked: number };
  error?: string;
}

export async function fetchHealth(port: number, timeoutMs = 2_000): Promise<HealthState> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/state`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { healthy: false, error: `HTTP ${response.status}` };
    const payload = await response.json() as {
      counts?: { running?: unknown; retrying?: unknown; blocked?: unknown };
      error?: { message?: unknown };
    };
    if (payload.error) {
      return { healthy: false, error: String(payload.error.message ?? "Symphony reported an error") };
    }
    const counts = payload.counts;
    if (!counts || ![counts.running, counts.retrying, counts.blocked].every(Number.isInteger)) {
      return { healthy: false, error: "Unexpected Symphony state payload" };
    }
    return {
      healthy: true,
      counts: {
        running: counts.running as number,
        retrying: counts.retrying as number,
        blocked: counts.blocked as number,
      },
    };
  } catch (error) {
    return { healthy: false, error: errorMessage(error) };
  }
}

export async function waitForHealth(project: ProjectRecord, timeoutMs = 30_000): Promise<HealthState> {
  const deadline = Date.now() + timeoutMs;
  let latest: HealthState = { healthy: false, error: "not yet probed" };
  while (Date.now() < deadline) {
    latest = await fetchHealth(project.config.dashboard_port);
    if (latest.healthy) return latest;
    await delay(500);
  }
  return latest;
}

export function symphonyWorkingDirectory(config: GakuchoConfig): string {
  return join(config.symphony.checkout, "elixir");
}
