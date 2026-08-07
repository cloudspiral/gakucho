import { spawn } from "node:child_process";
import type { CommandResult } from "./types.ts";
import { GakuchoError, errorMessage } from "./errors.ts";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  inherit?: boolean;
  allowFailure?: boolean;
}

const secretName = /(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API_KEY|PRIVATE_KEY)/i;

export function redactSecrets(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = value;
  const secrets = Object.entries(env)
    .filter(([name, secret]) => secretName.test(name) && typeof secret === "string" && secret.length >= 4)
    .map(([, secret]) => secret as string)
    .sort((left, right) => right.length - left.length);
  for (const secret of new Set(secrets)) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted;
}

export async function run(
  command: string,
  args: readonly string[] = [],
  options: RunOptions = {},
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.inherit ? "inherit" : "pipe",
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    if (!options.inherit) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => (stdout += chunk));
      child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    }
    child.on("error", (error) => {
      reject(new GakuchoError(`${command} failed to start: ${redactSecrets(errorMessage(error), options.env)}`));
    });
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        const detail = redactSecrets(output || `exit ${result.code}`, options.env);
        reject(new GakuchoError(`${command} failed: ${detail}`));
      } else {
        resolve(result);
      }
    });
    if (!options.inherit && options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await run("/usr/bin/which", [command], { allowFailure: true });
  return result.code === 0 && result.stdout.trim().length > 0;
}
