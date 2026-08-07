import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { GakuchoConfig, ProjectRecord } from "./types.ts";
import { GakuchoError } from "./errors.ts";

export function configPath(): string {
  return join(homedir(), ".config", "gakucho", "config.yaml");
}

export function applicationSupportRoot(): string {
  return join(homedir(), "Library", "Application Support", "Gakucho");
}

export function launchAgentsRoot(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

export function safeId(repo: string): string {
  const slug = repo
    .toLowerCase()
    .replaceAll("/", "--")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "repository";
  const digest = createHash("sha256").update(repo.toLowerCase()).digest("hex").slice(0, 8);
  return `${slug}--${digest}`;
}

export function resolveWorkflowPath(projectPath: string, workflow: string): string {
  if (isAbsolute(workflow)) {
    throw new GakuchoError("Project workflow must be repository-relative.");
  }
  const root = resolve(projectPath);
  const candidate = resolve(root, workflow);
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    throw new GakuchoError("Project workflow escapes the repository root.");
  }
  return candidate;
}

export function projectRecord(
  config: GakuchoConfig,
  repo: string,
): ProjectRecord {
  const project = config.projects[repo];
  if (!project) throw new GakuchoError(`Project is not registered: ${repo}`);
  const id = safeId(repo);
  const workspaceRoot = project.workspace_root ?? join(config.defaults.workspace_base, id);
  const logsRoot = join(config.defaults.logs_base, id);
  return {
    repo,
    config: project,
    safeId: id,
    workflowPath: resolveWorkflowPath(project.path, project.workflow),
    workspaceRoot,
    logsRoot,
    runnerPath: join(applicationSupportRoot(), "instances", id, "run.sh"),
    plistPath: join(launchAgentsRoot(), `dev.gakucho.${id}.plist`),
    serviceLabel: `dev.gakucho.${id}`,
  };
}

export function requireAbsolutePath(value: string, label: string): string {
  if (!isAbsolute(value)) throw new GakuchoError(`${label} must be an absolute path.`);
  return resolve(value);
}

export function directoryBasename(value: string): string {
  return basename(resolve(value));
}

export function parentDirectory(value: string): string {
  return dirname(resolve(value));
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
