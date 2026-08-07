import { basename } from "node:path";
import { loadConfig, writeConfig } from "../config.ts";
import { GakuchoError } from "../errors.ts";
import { gitRepoIdentity, requireCleanFile } from "../git.ts";
import { deleteRuntime, serviceLoaded, startService, stopService, writeRuntime } from "../launchd.ts";
import { projectRecord } from "../paths.ts";
import { resolveProject } from "../project-ref.ts";
import { run } from "../process.ts";
import { validateWorkflow, verifyPinnedSymphony } from "../symphony.ts";
import type { GakuchoConfig, ProjectRecord } from "../types.ts";

async function legacyServiceLoaded(project: ProjectRecord): Promise<boolean> {
  if (process.getuid === undefined) return false;
  const legacy = `com.matt.symphony.${basename(project.config.path)}`;
  const result = await run("launchctl", ["print", `gui/${process.getuid()}/${legacy}`], {
    allowFailure: true,
  });
  return result.code === 0;
}

async function validateRegistered(config: GakuchoConfig, project: ProjectRecord): Promise<void> {
  await verifyPinnedSymphony(config);
  const actualRepo = await gitRepoIdentity(project.config.path);
  if (actualRepo !== project.repo) throw new GakuchoError("Registered path origin no longer matches the registry.");
  await requireCleanFile(project.config.path, project.config.workflow);
  await validateWorkflow(project.workflowPath, project.repo);
}

export async function startProject(reference: string): Promise<ProjectRecord> {
  const config = await loadConfig();
  const project = resolveProject(config, reference);
  await validateRegistered(config, project);
  if (await legacyServiceLoaded(project)) {
    throw new GakuchoError(`Legacy Symphony watcher is loaded for ${project.repo}; boot it out before starting Gakucho.`);
  }
  project.config.enabled = true;
  await writeConfig(config);
  await writeRuntime(config, project);
  await startService(project);
  return project;
}

export async function stopProject(reference: string): Promise<ProjectRecord> {
  const config = await loadConfig();
  const project = resolveProject(config, reference);
  await stopService(project);
  project.config.enabled = false;
  await writeConfig(config);
  return project;
}

export async function restartProject(reference: string): Promise<ProjectRecord> {
  const config = await loadConfig();
  const project = resolveProject(config, reference);
  await stopService(project);
  await validateRegistered(config, project);
  if (await legacyServiceLoaded(project)) {
    throw new GakuchoError(`Legacy Symphony watcher is loaded for ${project.repo}; boot it out before restarting Gakucho.`);
  }
  project.config.enabled = true;
  await writeConfig(config);
  await writeRuntime(config, project);
  await startService(project);
  return project;
}

export async function removeProject(reference: string): Promise<ProjectRecord> {
  const config = await loadConfig();
  const project = resolveProject(config, reference);
  await stopService(project);
  await deleteRuntime(project);
  delete config.projects[project.repo];
  await writeConfig(config);
  return project;
}

export async function isProjectLoaded(reference: string): Promise<boolean> {
  const config = await loadConfig();
  return await serviceLoaded(resolveProject(config, reference).serviceLabel);
}
