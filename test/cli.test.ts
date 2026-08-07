import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const launcher = join(root, "bin", "gakucho");

describe("CLI", () => {
  test("advertises the complete v0.1 command surface", async () => {
    const result = Bun.spawnSync([launcher, "--help"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    for (const command of ["new", "init", "add", "task", "start", "stop", "restart", "status", "logs", "doctor", "remove", "git-handoff"]) {
      expect(output).toContain(command);
    }
  });

  test("rejects extra guarded-handoff arguments before any Git mutation", async () => {
    const result = Bun.spawnSync([launcher, "git-handoff", "push", "extra"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("too many arguments");
  });
});
