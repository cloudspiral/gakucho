import { realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { GakuchoConfig, ProjectRecord } from "./types.ts";
import { GakuchoError } from "./errors.ts";
import { canonicalRemote } from "./project-ref.ts";
import { currentBranch, gitOrigin, gitRoot, stagedDiffExists } from "./git.ts";
import { projectRecord } from "./paths.ts";
import { run } from "./process.ts";

export async function resolveHandoffProject(
  config: GakuchoConfig,
  cwd: string,
): Promise<{ project: ProjectRecord; root: string; branch: string }> {
  const root = await realpath(await gitRoot(cwd));
  const workspaceParent = await realpath(dirname(root));
  const issueDirectory = basename(root);
  const match = /^GH-([1-9][0-9]*)$/i.exec(issueDirectory);
  if (!match) throw new GakuchoError("Git handoff requires a Symphony GH-<number> workspace.");
  const issue = match[1]!;

  const matches: ProjectRecord[] = [];
  for (const repo of Object.keys(config.projects)) {
    const project = projectRecord(config, repo);
    const expected = await realpath(project.workspaceRoot).catch(() => project.workspaceRoot);
    if (expected === workspaceParent) matches.push(project);
  }
  if (matches.length !== 1) {
    throw new GakuchoError("Workspace does not belong to exactly one registered Gakucho project.");
  }
  const project = matches[0]!;
  const branch = await currentBranch(root);
  const allowed = new RegExp(`^symphony/gh-${issue}(?:-attempt-([2-9][0-9]*))?$`);
  if (!allowed.test(branch)) {
    throw new GakuchoError(`Branch ${branch} does not match the Symphony issue workspace.`);
  }
  const origin = await gitOrigin(root);
  if (origin !== canonicalRemote(project.repo)) {
    throw new GakuchoError("Origin does not match the registered canonical GitHub repository.");
  }
  return { project, root, branch };
}

export async function handoffCommit(config: GakuchoConfig, message: string, cwd: string): Promise<void> {
  if (message.length < 10 || message.length > 10_000) {
    throw new GakuchoError("Commit message must contain 10 to 10000 characters.");
  }
  const { root } = await resolveHandoffProject(config, cwd);
  if (!(await stagedDiffExists(root))) throw new GakuchoError("There are no staged changes to commit.");
  await run("git", [
    "-C",
    root,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "-m",
    message,
  ]);
}

export async function handoffPush(config: GakuchoConfig, cwd: string): Promise<void> {
  const { root, branch } = await resolveHandoffProject(config, cwd);
  await run("git", [
    "-C",
    root,
    "-c",
    "core.hooksPath=/dev/null",
    "push",
    "-u",
    "origin",
    `refs/heads/${branch}:refs/heads/${branch}`,
  ]);
}
