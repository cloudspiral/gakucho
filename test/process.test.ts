import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { redactSecrets, run } from "../src/process.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("subprocess boundary", () => {
  test("redacts credential values from diagnostics", () => {
    expect(redactSecrets("failed with secret-value", { GITHUB_TOKEN: "secret-value" }))
      .toBe("failed with [REDACTED]");
  });

  test("reports uniform fake failures without leaking secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "gakucho-process-"));
    temporary.push(root);
    const token = "not-a-real-credential-value";
    for (const command of ["git", "gh", "launchctl", "bun", "uv", "mise", "codex", "symphony"]) {
      const executable = join(root, command);
      await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$GITHUB_TOKEN" >&2\nexit 17\n`);
      await chmod(executable, 0o700);
      await expect(run(command, [], {
        env: { PATH: root, GITHUB_TOKEN: token },
      })).rejects.toThrow(`${command} failed: [REDACTED]`);
    }
  });
});
