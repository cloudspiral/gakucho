import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { resolveProject } from "../project-ref.ts";
import { run } from "../process.ts";
import { allStatuses, formatStatuses, inspectProject, recentLog } from "../status.ts";

export async function statusCommand(reference?: string): Promise<string> {
  const config = await loadConfig();
  const statuses = reference
    ? [await inspectProject(resolveProject(config, reference))]
    : await allStatuses(config);
  return formatStatuses(statuses);
}

export async function logsCommand(reference: string, follow = false): Promise<string> {
  const config = await loadConfig();
  const project = resolveProject(config, reference);
  const stdout = join(project.logsRoot, "launchd.stdout.log");
  const stderr = join(project.logsRoot, "launchd.stderr.log");
  if (follow) {
    await run("/usr/bin/tail", ["-F", stdout, stderr], { inherit: true });
    return "";
  }
  const [out, err] = await Promise.all([recentLog(stdout), recentLog(stderr)]);
  return [
    `Dashboard: http://127.0.0.1:${project.config.dashboard_port}/`,
    `Symphony logs: ${project.logsRoot}`,
    `stdout: ${stdout}`,
    out,
    `stderr: ${stderr}`,
    err,
  ].join("\n");
}
