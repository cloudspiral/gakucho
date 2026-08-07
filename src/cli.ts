import { Command, Option } from "commander";
import { ActionPlan } from "./action-plan.ts";
import { GakuchoError, errorMessage } from "./errors.ts";
import { loadConfig } from "./config.ts";
import { handoffCommit, handoffPush } from "./handoff.ts";
import { addProject, initProject, newProject, taskProject } from "./commands/project.ts";
import { removeProject, restartProject, startProject, stopProject } from "./commands/lifecycle.ts";
import { logsCommand, statusCommand } from "./commands/status.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { PROFILES, type Profile, type ProjectRecord } from "./types.ts";

function profile(value: string): Profile {
  if (!PROFILES.includes(value as Profile)) {
    throw new GakuchoError(`Profile must be one of: ${PROFILES.join(", ")}.`);
  }
  return value as Profile;
}

function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new GakuchoError(`Invalid port: ${value}`);
  }
  return parsed;
}

function printResult(result: ProjectRecord | ActionPlan): void {
  if (result instanceof ActionPlan) {
    console.log(result.format());
    return;
  }
  console.log(`${result.repo}\nDashboard: http://127.0.0.1:${result.config.dashboard_port}/`);
}

const program = new Command()
  .name("gakucho")
  .description("Operate one local OpenAI Symphony instance per registered GitHub repository.")
  .version("0.1.0")
  .showHelpAfterError();

program
  .command("new")
  .description("Create, publish, register, and optionally start a new project")
  .argument("<path>")
  .requiredOption("--profile <profile>", "bun, python-uv, or blank", profile)
  .option("--owner <owner>")
  .option("--repo-name <name>")
  .option("--public", "create a public repository instead of private")
  .option("--start", "start the watcher after registration")
  .option("--dry-run", "validate and print planned actions without mutation")
  .action(async (path: string, options: {
    profile: Profile;
    owner?: string;
    repoName?: string;
    public?: boolean;
    start?: boolean;
    dryRun?: boolean;
  }) => {
    printResult(await newProject(path, options));
  });

program
  .command("init")
  .description("Add missing factory assets to an existing GitHub repository")
  .argument("<path>")
  .requiredOption("--profile <profile>", "bun, python-uv, or blank", profile)
  .option("--dry-run", "validate and print planned actions without mutation")
  .action(async (path: string, options: { profile: Profile; dryRun?: boolean }) => {
    const result = await initProject(path, options.profile, options.dryRun);
    if (result instanceof ActionPlan) console.log(result.format());
    else console.log(result.map((file) => `created ${file}`).join("\n"));
  });

program
  .command("add")
  .description("Enroll an existing local GitHub repository")
  .argument("<path>")
  .option("--start", "start the watcher after registration")
  .option("--dry-run", "validate and print planned actions without mutation")
  .addOption(new Option("--workspace-root <path>", "preserve an existing workspace root"))
  .addOption(new Option("--port <port>", "adopt a specific dashboard port").argParser(port))
  .action(async (path: string, options: {
    start?: boolean;
    dryRun?: boolean;
    workspaceRoot?: string;
    port?: number;
  }) => {
    printResult(await addProject(path, options));
  });

program
  .command("task")
  .description("Create a ready-labeled GitHub issue")
  .argument("<project>")
  .argument("<title>")
  .option("--body <text>")
  .option("--body-file <path>")
  .option("--editor")
  .action(async (project: string, title: string, options: {
    body?: string;
    bodyFile?: string;
    editor?: boolean;
  }) => console.log(await taskProject(project, title, options)));

for (const [name, description, operation] of [
  ["start", "Validate and start one registered watcher", startProject],
  ["stop", "Stop one registered watcher", stopProject],
  ["restart", "Restart one registered watcher", restartProject],
] as const) {
  program.command(name).description(description).argument("<project>").action(async (reference: string) => {
    printResult(await operation(reference));
  });
}

program
  .command("status")
  .description("Show desired, launchd, and Symphony state")
  .argument("[project]")
  .action(async (reference?: string) => console.log(await statusCommand(reference)));

program
  .command("logs")
  .description("Locate or follow one project's logs")
  .argument("<project>")
  .option("--follow")
  .action(async (reference: string, options: { follow?: boolean }) => {
    const output = await logsCommand(reference, options.follow);
    if (output) console.log(output);
  });

program
  .command("doctor")
  .description("Run secret-free host and project diagnostics")
  .argument("[project]")
  .action(async (reference?: string) => console.log(await doctorCommand(reference)));

program
  .command("remove")
  .description("Remove Gakucho ownership while preserving source, logs, and workspaces")
  .argument("<project>")
  .action(async (reference: string) => {
    const project = await removeProject(reference);
    console.log(`Removed ${project.repo}; source, remote, logs, and workspaces were preserved.`);
  });

const handoff = program
  .command("git-handoff")
  .description("Guarded commit and push entrypoint for Symphony workspaces");

handoff
  .command("commit")
  .argument("<message>")
  .action(async (message: string) => handoffCommit(await loadConfig(), message, process.cwd()));

handoff
  .command("push")
  .action(async () => handoffPush(await loadConfig(), process.cwd()));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(`gakucho: ${errorMessage(error)}`);
  process.exitCode = error instanceof GakuchoError ? error.exitCode : 1;
}
