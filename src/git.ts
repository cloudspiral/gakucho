import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GakuchoError } from "./errors.ts";
import { repoFromRemote } from "./project-ref.ts";
import { run } from "./process.ts";

export async function gitRoot(path: string): Promise<string> {
  const result = await run("git", ["-C", path, "rev-parse", "--show-toplevel"]);
  return resolve(result.stdout.trim());
}

export async function gitOrigin(path: string): Promise<string> {
  const result = await run("git", ["-C", path, "remote", "get-url", "origin"]);
  return result.stdout.trim();
}

export async function gitRepoIdentity(path: string): Promise<string> {
  return repoFromRemote(await gitOrigin(path));
}

export async function currentBranch(path: string): Promise<string> {
  const result = await run("git", ["-C", path, "symbolic-ref", "--quiet", "--short", "HEAD"], {
    allowFailure: true,
  });
  if (result.code !== 0 || !result.stdout.trim()) throw new GakuchoError("Detached HEAD is not allowed.");
  return result.stdout.trim();
}

export async function defaultBranch(path: string): Promise<string> {
  const remote = await run(
    "git",
    ["-C", path, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { allowFailure: true },
  );
  if (remote.code === 0 && remote.stdout.trim().startsWith("origin/")) {
    return remote.stdout.trim().slice("origin/".length);
  }
  const branch = await currentBranch(path);
  return branch;
}

export async function gitStatus(path: string): Promise<string> {
  return (await run("git", ["-C", path, "status", "--short"])).stdout;
}

export async function requireCleanFile(path: string, file: string): Promise<void> {
  const tracked = await run("git", ["-C", path, "ls-files", "--error-unmatch", "--", file], {
    allowFailure: true,
  });
  if (tracked.code !== 0) throw new GakuchoError(`${file} must be tracked by Git before enrollment.`);
  const dirty = await run("git", ["-C", path, "status", "--short", "--", file]);
  if (dirty.stdout.trim()) throw new GakuchoError(`${file} must be committed and clean before enrollment.`);
}

export async function initializeRepository(path: string): Promise<void> {
  await run("git", ["init", "-b", "main"], { cwd: path });
}

export async function createInitialCommit(path: string, name: string, profile: string): Promise<void> {
  await run("git", ["-C", path, "add", "--all"]);
  const message = [
    `chore: initialize ${name} with the ${profile} factory harness`,
    "",
    "Summary:",
    `- scaffold the ${profile} project and its deterministic validation commands`,
    "- add Symphony workflow policy, GitHub issue routing, and CI configuration",
    "- document agent safety boundaries and human-review handoff behavior",
    "",
    "Validation:",
    "- baseline project checks passed before publication",
  ].join("\n");
  await run("git", ["-C", path, "-c", "commit.gpgSign=false", "commit", "-m", message]);
}

export async function stagedDiffExists(path: string): Promise<boolean> {
  const result = await run("git", ["-C", path, "diff", "--cached", "--quiet"], { allowFailure: true });
  if (result.code === 0) return false;
  if (result.code === 1) return true;
  throw new GakuchoError("Unable to inspect staged changes.");
}

export async function readPackageScripts(path: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(resolve(path, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return Object.fromEntries(
      Object.entries(parsed.scripts ?? {}).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"
      ),
    );
  } catch (error) {
    throw new GakuchoError(`Unable to read package.json: ${String(error)}`);
  }
}
