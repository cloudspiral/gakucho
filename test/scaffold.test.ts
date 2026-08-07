import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/process.ts";
import { initExisting, planExistingInit } from "../src/scaffold.ts";
import { issueForms, workflowFile } from "../src/templates.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gakucho-init-"));
  temporary.push(root);
  await run("git", ["init", "-b", "main"], { cwd: root });
  await run("git", ["remote", "add", "origin", "https://github.com/owner/repo.git"], { cwd: root });
  return root;
}

describe("existing repository initialization", () => {
  test("creates only missing factory files and becomes idempotent", async () => {
    const root = await repository();
    await writeFile(join(root, "README.md"), "preserve me\n");
    const first = await initExisting(root, "blank");
    expect(first).toContain("WORKFLOW.md");
    expect(first).toContain("AGENTS.md");
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("preserve me\n");
    expect(Object.keys((await planExistingInit(root, "blank")).files)).toEqual([]);
  });

  test("refuses all writes when one managed target conflicts", async () => {
    const root = await repository();
    await writeFile(join(root, "WORKFLOW.md"), "not a Gakucho workflow\n");
    await expect(initExisting(root, "blank")).rejects.toThrow("Refusing to overwrite");
    expect(await readFile(join(root, "WORKFLOW.md"), "utf8")).toBe("not a Gakucho workflow\n");
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).rejects.toThrow();
  });

  test("accepts exact managed files while adding an absent AGENTS file", async () => {
    const root = await repository();
    await writeFile(join(root, "WORKFLOW.md"), workflowFile("owner/repo", "blank", "main"));
    for (const [relative, content] of Object.entries(issueForms())) {
      const target = join(root, relative);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content);
    }
    const plan = await planExistingInit(root, "blank");
    expect(Object.keys(plan.files)).toEqual(["AGENTS.md"]);
  });
});
