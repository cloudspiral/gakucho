import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ActionPlan } from "../action-plan.ts";
import { loadConfig, writeConfig } from "../config.ts";
import { GakuchoError, errorMessage } from "../errors.ts";
import { createInitialCommit, gitRepoIdentity, gitRoot, initializeRepository, requireCleanFile } from "../git.ts";
import {
  authenticatedOwner,
  createRepository,
  createTask,
  ensureLabels,
  repositoryExists,
  verifyGitHubAuth,
  verifyIssuesEnabled,
} from "../github.ts";
import { allocatePort, writeRuntime } from "../launchd.ts";
import { projectRecord, requireAbsolutePath } from "../paths.ts";
import { normalizeRepoIdentity, resolveProject } from "../project-ref.ts";
import { commandExists, run } from "../process.ts";
import { initExisting, planExistingInit, scaffoldNew, validateNewTarget } from "../scaffold.ts";
import { validateWorkflow } from "../symphony.ts";
import type { Profile, ProjectRecord } from "../types.ts";
import { startProject } from "./lifecycle.ts";

export interface AddOptions {
  start?: boolean;
  dryRun?: boolean;
  workspaceRoot?: string;
  port?: number;
}

export async function addProject(path: string, options: AddOptions = {}): Promise<ProjectRecord | ActionPlan> {
  const root = await gitRoot(resolve(path));
  const repo = await gitRepoIdentity(root);
  const config = await loadConfig();
  if (config.projects[repo]) throw new GakuchoError(`Project is already registered: ${repo}`);
  if (Object.values(config.projects).some((project) => resolve(project.path) === root)) {
    throw new GakuchoError(`Local path is already registered: ${root}`);
  }
  await requireCleanFile(root, "WORKFLOW.md");
  const workflowPort = await validateWorkflow(join(root, "WORKFLOW.md"), repo);
  await verifyGitHubAuth();
  await verifyIssuesEnabled(repo);
  const port = await allocatePort(config, options.port ?? workflowPort);
  const workspaceRoot = options.workspaceRoot
    ? requireAbsolutePath(options.workspaceRoot, "Workspace root")
    : undefined;
  const plan = new ActionPlan()
    .add("github", `create any missing standard labels in ${repo}`)
    .add("registry", `register ${root} on dashboard port ${port}`)
    .add("runtime", "generate the project runner and LaunchAgent")
    .add("service", options.start ? "start and probe Symphony" : "leave the watcher stopped");
  if (options.dryRun) return plan;

  await ensureLabels(repo);
  config.projects[repo] = {
    path: root,
    workflow: "WORKFLOW.md",
    enabled: false,
    dashboard_port: port,
    ...(workspaceRoot ? { workspace_root: workspaceRoot } : {}),
  };
  await writeConfig(config);
  const project = projectRecord(config, repo);
  await writeRuntime(config, project);
  if (options.start) return await startProject(repo);
  return project;
}

export interface NewOptions {
  profile: Profile;
  owner?: string;
  repoName?: string;
  public?: boolean;
  start?: boolean;
  dryRun?: boolean;
}

export async function newProject(path: string, options: NewOptions): Promise<ProjectRecord | ActionPlan> {
  const target = resolve(path);
  await validateNewTarget(target);
  await verifyGitHubAuth();
  const owner = (options.owner ?? await authenticatedOwner()).toLowerCase();
  const repoName = (options.repoName ?? basename(target)).toLowerCase();
  const repo = normalizeRepoIdentity(`${owner}/${repoName}`);
  if (await repositoryExists(repo)) throw new GakuchoError(`GitHub repository already exists: ${repo}`);
  if (options.profile === "bun" && !(await commandExists("bun"))) throw new GakuchoError("Bun is required.");
  if (options.profile === "python-uv" && !(await commandExists("uv"))) throw new GakuchoError("uv is required.");
  const config = await loadConfig();
  if (Object.values(config.projects).some((project) => resolve(project.path) === target)) {
    throw new GakuchoError(`Target path is already registered: ${target}`);
  }
  const port = await allocatePort(config);
  const visibility = options.public ? "public" : "private";
  const plan = new ActionPlan()
    .add("local", `scaffold and validate a ${options.profile} project at ${target}`)
    .add("git", "initialize main and create a comprehensive initial commit")
    .add("github", `create ${visibility} repository ${repo}, push, and create standard labels`)
    .add("registry", `register dashboard port ${port} and generate runtime files`)
    .add("service", options.start ? "start and probe Symphony" : "leave the watcher stopped");
  if (options.dryRun) return plan;

  const completed: string[] = [];
  let stage = "scaffolding and baseline validation";
  let initialCommitCreated = false;
  let remoteCreated = false;
  try {
    await scaffoldNew(target, repo, options.profile);
    completed.push("local scaffold and baseline checks");
    stage = "initializing Git and creating the initial commit";
    await initializeRepository(target);
    await createInitialCommit(target, repoName, options.profile);
    initialCommitCreated = true;
    completed.push("local main branch and initial commit");
    stage = `creating and pushing ${repo}`;
    await createRepository(repo, target, visibility);
    remoteCreated = true;
    completed.push(`GitHub repository ${repo} and pushed main branch`);
    stage = "creating standard GitHub labels";
    await ensureLabels(repo);
    completed.push("standard GitHub labels");
    stage = "registering the project and generating runtime files";
    return await addProject(target, { ...(options.start ? { start: true } : {}), port });
  } catch (error) {
    const current = await loadConfig().catch(() => config);
    const registered = current.projects[repo] !== undefined;
    const recovery: string[] = [];
    if (registered) {
      recovery.push(`gakucho doctor ${repo}`);
      if (options.start) recovery.push(`gakucho start ${repo}`);
    } else if (remoteCreated) {
      recovery.push(`gakucho add ${target}${options.start ? " --start" : ""}`);
    } else if (initialCommitCreated) {
      recovery.push(`gh repo view ${repo}`);
      recovery.push(`If absent: gh repo create ${repo} --${visibility} --source ${target} --remote origin --push`);
      recovery.push(`If present: git -C ${target} push -u origin main`);
      recovery.push(`gakucho add ${target}${options.start ? " --start" : ""}`);
    } else {
      const contract = options.profile === "bun"
        ? "bun install && bun run check"
        : options.profile === "python-uv"
        ? "uv lock && uv sync --frozen && uv run ruff check . && uv run pytest"
        : "verify the generated factory files";
      recovery.push(`Resolve the reported failure, then run in ${target}: ${contract}`);
      recovery.push(`Rerun creation from a new empty path, or finish Git/GitHub setup manually and run gakucho add ${target}.`);
    }
    throw new GakuchoError([
      `Failed while ${stage}: ${errorMessage(error)}`,
      `Completed: ${completed.length > 0 ? completed.join("; ") : "no full stage"}.`,
      `Preserved local state: ${target}. Gakucho never deletes a partially created remote repository.`,
      "Recovery:",
      ...recovery.map((command) => `- ${command}`),
    ].join("\n"));
  }
}

export async function initProject(path: string, profile: Profile, dryRun = false): Promise<string[] | ActionPlan> {
  const plan = await planExistingInit(path, profile);
  await verifyGitHubAuth();
  if (!(await repositoryExists(plan.repo))) {
    throw new GakuchoError(`GitHub repository does not exist or is inaccessible: ${plan.repo}`);
  }
  await verifyIssuesEnabled(plan.repo);
  const actions = new ActionPlan();
  for (const file of Object.keys(plan.files)) actions.add("scaffold", `create ${file}`);
  if (dryRun) return actions;
  return await initExisting(path, profile);
}

export interface TaskOptions {
  body?: string;
  bodyFile?: string;
  editor?: boolean;
}

async function editorBody(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gakucho-task-"));
  const path = join(directory, "issue.md");
  try {
    const editor = process.env.VISUAL || process.env.EDITOR || "/usr/bin/vi";
    const result = await run(editor, [path], { inherit: true, allowFailure: true });
    if (result.code !== 0) throw new GakuchoError(`Editor exited with status ${result.code}.`);
    return await readFile(path, "utf8").catch(() => "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function taskProject(reference: string, title: string, options: TaskOptions): Promise<string> {
  const selected = [options.body !== undefined, options.bodyFile !== undefined, options.editor === true]
    .filter(Boolean).length;
  if (selected > 1) throw new GakuchoError("Choose only one of --body, --body-file, or --editor.");
  const config = await loadConfig();
  const project = resolveProject(config, reference);
  let body = options.body ?? "";
  if (options.bodyFile) body = await readFile(options.bodyFile, "utf8");
  if (options.editor) body = await editorBody();
  if (!project.config.enabled) {
    console.warn(`Warning: ${project.repo} is stopped; the issue will wait until its watcher starts.`);
  }
  return await createTask(project.repo, title, body);
}
