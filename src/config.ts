import { constants } from "node:fs";
import { access, chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
import { z } from "zod";
import { GakuchoError, errorMessage } from "./errors.ts";
import { configPath, requireAbsolutePath, resolveWorkflowPath, safeId } from "./paths.ts";
import { normalizeRepoIdentity } from "./project-ref.ts";
import type { GakuchoConfig } from "./types.ts";

const projectSchema = z
  .object({
    path: z.string().min(1),
    workflow: z.string().min(1),
    enabled: z.boolean(),
    dashboard_port: z.number().int().min(1).max(65_535),
    workspace_root: z.string().min(1).optional(),
  })
  .strict();

const configSchema = z
  .object({
    schema_version: z.literal(1),
    symphony: z
      .object({
        checkout: z.string().min(1),
        version: z.string().min(1),
        executable: z.string().min(1),
      })
      .strict(),
    defaults: z
      .object({
        workspace_base: z.string().min(1),
        logs_base: z.string().min(1),
        dashboard_port_start: z.number().int().min(1).max(65_535),
      })
      .strict(),
    projects: z.record(z.string(), projectSchema),
  })
  .strict();

export function defaultConfig(): GakuchoConfig {
  const home = homedir();
  const checkout = join(home, "Developer", "personal", "openai-symphony");
  return {
    schema_version: 1,
    symphony: {
      checkout,
      version: "v0.0.2",
      executable: join(checkout, "elixir", "bin", "symphony"),
    },
    defaults: {
      workspace_base: join(home, "Developer", "symphony-workspaces"),
      logs_base: join(home, "Library", "Logs", "Gakucho"),
      dashboard_port_start: 4000,
    },
    projects: {},
  };
}

function validateIntegrity(config: GakuchoConfig): GakuchoConfig {
  config.symphony.checkout = requireAbsolutePath(config.symphony.checkout, "Symphony checkout");
  config.symphony.executable = requireAbsolutePath(config.symphony.executable, "Symphony executable");
  config.defaults.workspace_base = requireAbsolutePath(config.defaults.workspace_base, "Workspace base");
  config.defaults.logs_base = requireAbsolutePath(config.defaults.logs_base, "Logs base");

  const paths = new Map<string, string>();
  const ports = new Map<number, string>();
  const workspaces = new Map<string, string>();
  const safeIds = new Map<string, string>();
  for (const [key, project] of Object.entries(config.projects)) {
    const normalized = normalizeRepoIdentity(key);
    if (normalized !== key) {
      throw new GakuchoError(`Registry project key must be canonical lowercase owner/repo: ${key}`);
    }
    project.path = requireAbsolutePath(project.path, `Project path for ${key}`);
    resolveWorkflowPath(project.path, project.workflow);
    if (project.workspace_root) {
      project.workspace_root = requireAbsolutePath(project.workspace_root, `Workspace root for ${key}`);
    }
    const workspace = project.workspace_root ?? join(config.defaults.workspace_base, safeId(key));
    const duplicateWorkspace = workspaces.get(workspace);
    if (duplicateWorkspace) {
      throw new GakuchoError(`Projects ${duplicateWorkspace} and ${key} share workspace root ${workspace}.`);
    }
    workspaces.set(workspace, key);
    const id = safeId(key);
    const duplicateSafeId = safeIds.get(id);
    if (duplicateSafeId) {
      throw new GakuchoError(`Projects ${duplicateSafeId} and ${key} share generated safe ID ${id}.`);
    }
    safeIds.set(id, key);
    const duplicatePath = paths.get(project.path);
    if (duplicatePath) throw new GakuchoError(`Projects ${duplicatePath} and ${key} share path ${project.path}.`);
    paths.set(project.path, key);
    const duplicatePort = ports.get(project.dashboard_port);
    if (duplicatePort) {
      throw new GakuchoError(
        `Projects ${duplicatePort} and ${key} share dashboard port ${project.dashboard_port}.`,
      );
    }
    ports.set(project.dashboard_port, key);
  }
  return config;
}

export function parseConfig(source: string): GakuchoConfig {
  try {
    const raw: unknown = YAML.parse(source);
    return validateIntegrity(configSchema.parse(raw) as GakuchoConfig);
  } catch (error) {
    if (error instanceof GakuchoError) throw error;
    throw new GakuchoError(`Invalid Gakucho registry: ${errorMessage(error)}`);
  }
}

export async function loadConfig(path = configPath()): Promise<GakuchoConfig> {
  try {
    return parseConfig(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
    throw error;
  }
}

export async function writeConfig(config: GakuchoConfig, path = configPath()): Promise<void> {
  const validated = validateIntegrity(configSchema.parse(config) as GakuchoConfig);
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const temporary = join(parent, `.config.yaml.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(YAML.stringify(validated, { lineWidth: 0 }), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function configPermissions(path = configPath()): Promise<string> {
  try {
    const info = await stat(path);
    return (info.mode & 0o777).toString(8).padStart(3, "0");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export async function pathWritable(path: string): Promise<boolean> {
  try {
    await access(resolve(path), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
