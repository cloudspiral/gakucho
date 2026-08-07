import { readFile } from "node:fs/promises";
import type { GakuchoConfig, ProjectRecord } from "./types.ts";
import { projectRecord } from "./paths.ts";
import { serviceLoaded } from "./launchd.ts";
import { fetchHealth } from "./symphony.ts";

export interface ProjectStatus {
  project: ProjectRecord;
  loaded: boolean;
  healthy: boolean;
  counts?: { running: number; retrying: number; blocked: number };
  error?: string;
}

export async function inspectProject(project: ProjectRecord): Promise<ProjectStatus> {
  const loaded = await serviceLoaded(project.serviceLabel);
  const health = loaded
    ? await fetchHealth(project.config.dashboard_port)
    : { healthy: false, error: "service is unloaded" };
  return {
    project,
    loaded,
    healthy: health.healthy,
    ...(health.counts ? { counts: health.counts } : {}),
    ...(health.error ? { error: health.error } : {}),
  };
}

export async function allStatuses(config: GakuchoConfig): Promise<ProjectStatus[]> {
  return await Promise.all(
    Object.keys(config.projects).sort().map((repo) => inspectProject(projectRecord(config, repo))),
  );
}

export function formatStatuses(statuses: ProjectStatus[]): string {
  if (statuses.length === 0) return "No registered projects.";
  const header = ["PROJECT", "DESIRED", "SERVICE", "SYMPHONY", "PORT", "RUN/RETRY/BLOCK"];
  const rows = statuses.map((status) => [
    status.project.repo,
    status.project.config.enabled ? "enabled" : "disabled",
    status.loaded ? "loaded" : "unloaded",
    status.healthy ? "healthy" : "unavailable",
    String(status.project.config.dashboard_port),
    status.counts
      ? `${status.counts.running}/${status.counts.retrying}/${status.counts.blocked}`
      : "-",
  ]);
  const widths = header.map((value, index) =>
    Math.max(value.length, ...rows.map((row) => row[index]?.length ?? 0))
  );
  return [header, ...rows]
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index]!)).join("  ").trimEnd())
    .join("\n");
}

export async function recentLog(path: string, lines = 80): Promise<string> {
  try {
    const source = await readFile(path, "utf8");
    return source.split("\n").slice(-lines).join("\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
