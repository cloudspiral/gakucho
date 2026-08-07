import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agentsFile, commonNewFiles, issueForms, profileContract, workflowFile } from "../src/templates.ts";
import { validateWorkflow } from "../src/symphony.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("factory templates", () => {
  test("generates a labeled-only Symphony workflow with central handoff", async () => {
    const source = workflowFile("CloudSpiral/Example", "bun", "main");
    expect(source).toContain("required_labels:\n    - symphony-ready");
    expect(source).toContain("max_concurrent_agents: 1");
    expect(source).toContain("gakucho git-handoff commit");
    expect(source).toContain("-attempt-<n>");
    expect(source).not.toContain("required_labels: []");
    expect(source).not.toContain("server:\n");
    const root = await mkdtemp(join(tmpdir(), "gakucho-workflow-"));
    temporary.push(root);
    const path = join(root, "WORKFLOW.md");
    await writeFile(path, source);
    expect(await validateWorkflow(path, "cloudspiral/example")).toBeUndefined();
  });

  test("generates required and backlog issue forms with distinct routing", () => {
    const forms = issueForms();
    expect(forms[".github/ISSUE_TEMPLATE/agent-task.yml"]).toContain('labels: ["symphony-ready"]');
    expect(forms[".github/ISSUE_TEMPLATE/agent-task.yml"]).toContain("id: acceptance");
    expect(forms[".github/ISSUE_TEMPLATE/agent-task.yml"]).toContain("id: verification");
    expect(forms[".github/ISSUE_TEMPLATE/backlog.yml"]).toContain("labels: []");
  });

  test("keeps profiles framework free", () => {
    const bun = profileContract("bun", "demo");
    expect(bun.sourceFiles["package.json"]).not.toContain("react");
    expect(bun.sourceFiles["tsconfig.json"]).toContain('"allowImportingTsExtensions": true');
    expect(bun.checkCommand).toBe("bun run check");
    const python = profileContract("python-uv", "demo-project");
    expect(python.sourceFiles["pyproject.toml"]).toContain('packages = ["src/demo_project"]');
    expect(python.sourceFiles["pyproject.toml"]).not.toContain("fastapi");
    expect(profileContract("blank", "demo").sourceFiles).toEqual({});
  });

  test("new projects receive common factory files", () => {
    const files = commonNewFiles("demo", "owner/demo", "blank", "main");
    expect(files["README.md"]).toBeDefined();
    expect(files["AGENTS.md"]).toBeDefined();
    expect(files["WORKFLOW.md"]).toBeDefined();
    expect(files[".github/ISSUE_TEMPLATE/config.yml"]).toBeDefined();
    expect(agentsFile("blank")).toContain("gakucho git-handoff");
  });
});
