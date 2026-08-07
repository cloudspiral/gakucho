import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { configPath } from "../paths.ts";
import { configPermissions, loadConfig } from "../config.ts";
import { commandExists, run } from "../process.ts";
import { verifyGitHubAuth } from "../github.ts";
import { verifyPinnedSymphony, validateWorkflow } from "../symphony.ts";
import { resolveProject } from "../project-ref.ts";
import { gitRepoIdentity, requireCleanFile } from "../git.ts";
import { GakuchoError, errorMessage } from "../errors.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function check(name: string, operation: () => Promise<string | void>): Promise<Check> {
  try {
    return { name, ok: true, detail: (await operation()) || "ok" };
  } catch (error) {
    return { name, ok: false, detail: errorMessage(error) };
  }
}

export async function doctorCommand(reference?: string): Promise<string> {
  const config = await loadConfig();
  const checks: Check[] = [];
  checks.push({ name: "platform", ok: process.platform === "darwin", detail: process.platform });
  for (const command of ["bun", "git", "gh", "mise", "launchctl", "codex", "plutil"]) {
    checks.push(await check(command, async () => {
      if (!(await commandExists(command))) throw new GakuchoError(`${command} is not on PATH.`);
    }));
  }
  checks.push(await check("GitHub auth", verifyGitHubAuth));
  checks.push(await check("Symphony pin", async () => {
    await verifyPinnedSymphony(config);
    return config.symphony.version;
  }));
  checks.push(await check("Elixir runtime", async () => {
    const result = await run("mise", ["exec", "--", "elixir", "--version"], {
      cwd: join(config.symphony.checkout, "elixir"),
    });
    return result.stdout.split("\n").find((line) => line.startsWith("Elixir ")) ?? "available";
  }));
  checks.push(await check("registry permissions", async () => {
    const permissions = await configPermissions();
    if (permissions !== "missing" && permissions !== "600") {
      throw new GakuchoError(`expected 600, found ${permissions}`);
    }
    return permissions;
  }));
  checks.push(await check("Codex handoff rules", async () => {
    const rulesPath = join(homedir(), ".codex", "rules", "default.rules");
    const source = await readFile(rulesPath, "utf8");
    for (const action of ["commit", "push"]) {
      if (!source.includes(`pattern=["gakucho", "git-handoff", "${action}"]`) &&
          !source.includes(`pattern = ["gakucho", "git-handoff", "${action}"]`)) {
        throw new GakuchoError(`missing exact allow rule for gakucho git-handoff ${action}`);
      }
    }
  }));
  checks.push(await check("config path", async () => {
    await access(configPath()).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return configPath();
  }));

  if (reference) {
    const project = resolveProject(config, reference);
    checks.push(await check("project path", async () => {
      const info = await stat(project.config.path);
      if (!info.isDirectory()) throw new GakuchoError("not a directory");
      return project.config.path;
    }));
    checks.push(await check("project origin", async () => {
      const identity = await gitRepoIdentity(project.config.path);
      if (identity !== project.repo) throw new GakuchoError(`${identity} does not match ${project.repo}`);
      return identity;
    }));
    checks.push(await check("project workflow", async () => {
      await requireCleanFile(project.config.path, project.config.workflow);
      await validateWorkflow(project.workflowPath, project.repo);
    }));
  }

  const output = checks.map((item) => `${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`).join("\n");
  if (checks.some((item) => !item.ok)) throw new GakuchoError(output);
  return output;
}
