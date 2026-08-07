import { createServer } from "node:net";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { GakuchoConfig, ProjectRecord } from "./types.ts";
import { shellQuote, xmlEscape } from "./paths.ts";
import { run } from "./process.ts";
import { GakuchoError } from "./errors.ts";
import { symphonyWorkingDirectory, waitForHealth } from "./symphony.ts";

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    await chmod(path, mode);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function runnerTemplate(config: GakuchoConfig, project: ProjectRecord): string {
  const home = homedir();
  const path = [
    join(home, "bin"),
    join(home, ".local", "share", "mise", "shims"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/Applications/ChatGPT.app/Contents/Resources",
  ].join(":");
  return `#!/bin/zsh
set -euo pipefail

export PATH=${shellQuote(path)}

readonly workflow_path=${shellQuote(project.workflowPath)}
readonly workspace_root=${shellQuote(project.workspaceRoot)}
readonly logs_root=${shellQuote(project.logsRoot)}
readonly symphony_checkout=${shellQuote(config.symphony.checkout)}
readonly symphony_executable=${shellQuote(config.symphony.executable)}
readonly gh_bin="/opt/homebrew/bin/gh"
readonly mise_bin="/opt/homebrew/bin/mise"

/bin/mkdir -p "$workspace_root" "$logs_root"

github_token="$($gh_bin auth token --hostname github.com)"
if [[ -z "$github_token" ]]; then
  print -u2 "GitHub authentication is unavailable; run gh auth login before starting Gakucho."
  exit 1
fi

export GITHUB_TOKEN="$github_token"
export SYMPHONY_WORKSPACE_ROOT="$workspace_root"
unset github_token

cd "$symphony_checkout/elixir"
exec "$mise_bin" exec -- "$symphony_executable" \\
  --i-understand-that-this-will-be-running-without-the-usual-guardrails \\
  --logs-root "$logs_root" \\
  --port ${project.config.dashboard_port} \\
  "$workflow_path"
`;
}

export function plistTemplate(config: GakuchoConfig, project: ProjectRecord): string {
  const stdout = join(project.logsRoot, "launchd.stdout.log");
  const stderr = join(project.logsRoot, "launchd.stderr.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(project.serviceLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(project.runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(symphonyWorkingDirectory(config))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderr)}</string>
</dict>
</plist>
`;
}

export async function writeRuntime(config: GakuchoConfig, project: ProjectRecord): Promise<void> {
  await mkdir(project.logsRoot, { recursive: true, mode: 0o700 });
  await mkdir(project.workspaceRoot, { recursive: true, mode: 0o700 });
  await atomicWrite(project.runnerPath, runnerTemplate(config, project), 0o700);
  await atomicWrite(project.plistPath, plistTemplate(config, project), 0o600);
  await run("plutil", ["-lint", project.plistPath]);
}

function domain(): string {
  if (process.getuid === undefined) throw new GakuchoError("Unable to determine the current macOS user ID.");
  return `gui/${process.getuid()}`;
}

export async function serviceLoaded(label: string): Promise<boolean> {
  const result = await run("launchctl", ["print", `${domain()}/${label}`], { allowFailure: true });
  return result.code === 0;
}

export async function startService(project: ProjectRecord): Promise<void> {
  if (await serviceLoaded(project.serviceLabel)) {
    const current = await waitForHealth(project, 2_000);
    if (current.healthy) return;
    await run("launchctl", ["kickstart", "-k", `${domain()}/${project.serviceLabel}`]);
  } else {
    await run("launchctl", ["bootstrap", domain(), project.plistPath]);
  }
  const health = await waitForHealth(project);
  if (!health.healthy) {
    throw new GakuchoError(`Symphony did not become healthy: ${health.error ?? "unknown error"}`);
  }
}

export async function stopService(project: ProjectRecord): Promise<void> {
  if (!(await serviceLoaded(project.serviceLabel))) return;
  await run("launchctl", ["bootout", `${domain()}/${project.serviceLabel}`]);
}

export async function deleteRuntime(project: ProjectRecord): Promise<void> {
  await unlink(project.runnerPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await unlink(project.plistPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function portAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export async function allocatePort(config: GakuchoConfig, requested?: number): Promise<number> {
  const reserved = new Set(Object.values(config.projects).map((project) => project.dashboard_port));
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested < 1 || requested > 65_535) {
      throw new GakuchoError(`Invalid dashboard port: ${requested}`);
    }
    if (reserved.has(requested)) throw new GakuchoError(`Dashboard port is already registered: ${requested}`);
    if (!(await portAvailable(requested))) throw new GakuchoError(`Dashboard port is already in use: ${requested}`);
    return requested;
  }
  for (let port = config.defaults.dashboard_port_start; port <= 65_535; port += 1) {
    if (!reserved.has(port) && await portAvailable(port)) return port;
  }
  throw new GakuchoError("No free dashboard port is available.");
}
