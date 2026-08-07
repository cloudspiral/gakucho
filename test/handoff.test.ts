import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handoffCommit, resolveHandoffProject } from "../src/handoff.ts";
import type { GakuchoConfig } from "../src/types.ts";
import { run } from "../src/process.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(branch = "symphony/gh-7"): Promise<{ root: string; config: GakuchoConfig }> {
  const base = await mkdtemp(join(tmpdir(), "gakucho-handoff-"));
  temporary.push(base);
  const workspace = join(base, "workspaces", "owner-repo");
  const root = join(workspace, "GH-7");
  await mkdir(root, { recursive: true });
  await run("git", ["init", "-b", branch], { cwd: root });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "Test"], { cwd: root });
  await run("git", ["remote", "add", "origin", "https://github.com/owner/repo.git"], { cwd: root });
  const config: GakuchoConfig = {
    schema_version: 1,
    symphony: { checkout: "/tmp/symphony", version: "v0.0.2", executable: "/tmp/symphony/bin" },
    defaults: { workspace_base: join(base, "workspaces"), logs_base: join(base, "logs"), dashboard_port_start: 4000 },
    projects: {
      "owner/repo": {
        path: join(base, "source"),
        workflow: "WORKFLOW.md",
        enabled: true,
        dashboard_port: 4000,
        workspace_root: workspace,
      },
    },
  };
  return { root, config };
}

describe("guarded Git handoff", () => {
  test("accepts the exact registered issue branch and attempt branch", async () => {
    const first = await fixture();
    expect((await resolveHandoffProject(first.config, first.root)).branch).toBe("symphony/gh-7");
    await run("git", ["switch", "-c", "symphony/gh-7-attempt-2"], { cwd: first.root });
    expect((await resolveHandoffProject(first.config, first.root)).branch).toBe("symphony/gh-7-attempt-2");
  });

  test("rejects mismatched branches and remotes", async () => {
    const badBranch = await fixture("main");
    await expect(resolveHandoffProject(badBranch.config, badBranch.root)).rejects.toThrow("does not match");
    const badRemote = await fixture();
    await run("git", ["remote", "set-url", "origin", "https://github.com/owner/other.git"], { cwd: badRemote.root });
    await expect(resolveHandoffProject(badRemote.config, badRemote.root)).rejects.toThrow("Origin does not match");
  });

  test("commits only staged changes with a comprehensive message", async () => {
    const item = await fixture();
    await writeFile(join(item.root, "file.txt"), "hello\n");
    await run("git", ["add", "file.txt"], { cwd: item.root });
    await handoffCommit(item.config, "Add the validated fixture file", item.root);
    const subject = await run("git", ["log", "-1", "--pretty=%s"], { cwd: item.root });
    expect(subject.stdout.trim()).toBe("Add the validated fixture file");
    await expect(handoffCommit(item.config, "too short", item.root)).rejects.toThrow("10 to 10000");
  });
});
