import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { GakuchoError } from "./errors.ts";
import type { Profile } from "./types.ts";
import { agentsFile, commonNewFiles, issueForms, profileContract, workflowFile } from "./templates.ts";
import { gitRepoIdentity, readPackageScripts } from "./git.ts";
import { run } from "./process.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: "wx", mode: 0o644 });
  }
}

export async function validateNewTarget(path: string): Promise<void> {
  const target = resolve(path);
  if (await exists(target)) {
    const info = await stat(target);
    if (!info.isDirectory()) throw new GakuchoError(`Target exists and is not a directory: ${target}`);
    if ((await readdir(target)).length > 0) throw new GakuchoError(`Target directory is not empty: ${target}`);
    await access(target, constants.W_OK).catch(() => {
      throw new GakuchoError(`Target directory is not writable: ${target}`);
    });
  } else {
    const parent = dirname(target);
    await access(parent, constants.W_OK).catch(() => {
      throw new GakuchoError(`Target parent is not writable: ${parent}`);
    });
  }
}

export async function scaffoldNew(
  path: string,
  repo: string,
  profile: Profile,
): Promise<void> {
  const target = resolve(path);
  const name = basename(target);
  await mkdir(target, { recursive: true });
  const files = {
    ...commonNewFiles(name, repo, profile, "main"),
    ...profileContract(profile, name).sourceFiles,
  };
  await writeFiles(target, files);

  if (profile === "bun") {
    await run("bun", ["install"], { cwd: target });
    await run("bun", ["run", "check"], { cwd: target });
  } else if (profile === "python-uv") {
    await run("uv", ["lock"], { cwd: target });
    await run("uv", ["sync", "--frozen"], { cwd: target });
    await run("uv", ["run", "ruff", "check", "."], { cwd: target });
    await run("uv", ["run", "pytest"], { cwd: target });
  }
}

export async function validateExistingProfile(path: string, profile: Profile): Promise<void> {
  const root = resolve(path);
  if (profile === "bun") {
    for (const file of ["package.json", "bun.lock"]) {
      if (!(await exists(join(root, file)))) throw new GakuchoError(`Bun profile requires ${file}.`);
    }
    const scripts = await readPackageScripts(root);
    if (!scripts.check) throw new GakuchoError("Bun profile requires a package.json check script.");
  } else if (profile === "python-uv") {
    for (const file of ["pyproject.toml", "uv.lock"]) {
      if (!(await exists(join(root, file)))) throw new GakuchoError(`Python/uv profile requires ${file}.`);
    }
  }
}

export interface ExistingInitPlan {
  root: string;
  repo: string;
  defaultBranch: string;
  files: Record<string, string>;
}

export async function planExistingInit(path: string, profile: Profile): Promise<ExistingInitPlan> {
  const root = resolve(path);
  const info = await stat(root).catch(() => undefined);
  if (!info?.isDirectory()) throw new GakuchoError(`Existing project directory not found: ${root}`);
  await validateExistingProfile(root, profile);
  const repo = await gitRepoIdentity(root);
  const branchResult = await run(
    "git",
    ["-C", root, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { allowFailure: true },
  );
  const defaultBranch = branchResult.code === 0
    ? branchResult.stdout.trim().replace(/^origin\//, "")
    : "main";
  const managed = {
    "WORKFLOW.md": workflowFile(repo, profile, defaultBranch),
    ...issueForms(),
  };
  const files: Record<string, string> = {};
  const conflicts: string[] = [];
  for (const [relative, content] of Object.entries(managed)) {
    const target = join(root, relative);
    if (!(await exists(target))) {
      files[relative] = content;
      continue;
    }
    if (await readFile(target, "utf8") !== content) conflicts.push(relative);
  }
  if (conflicts.length > 0) {
    throw new GakuchoError(`Refusing to overwrite existing factory files:\n- ${conflicts.join("\n- ")}`);
  }
  if (!(await exists(join(root, "AGENTS.md")))) files["AGENTS.md"] = agentsFile(profile);
  return { root, repo, defaultBranch, files };
}

export async function initExisting(path: string, profile: Profile): Promise<string[]> {
  const { root, files } = await planExistingInit(path, profile);
  await writeFiles(root, files);
  return Object.keys(files);
}
