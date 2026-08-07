import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { projectRecord, safeId, shellQuote, xmlEscape } from "../src/paths.ts";
import type { GakuchoConfig } from "../src/types.ts";

function config(): GakuchoConfig {
  return {
    schema_version: 1,
    symphony: { checkout: "/tmp/symphony", version: "v0.0.2", executable: "/tmp/symphony/bin" },
    defaults: { workspace_base: "/tmp/workspaces", logs_base: "/tmp/logs", dashboard_port_start: 4000 },
    projects: {
      "owner/repo.name": {
        path: "/tmp/repo",
        workflow: "WORKFLOW.md",
        enabled: false,
        dashboard_port: 4000,
      },
    },
  };
}

describe("path helpers", () => {
  test("safe IDs are stable, readable, and collision resistant", () => {
    expect(safeId("Owner/Repo.Name")).toMatch(/^owner--repo\.name--[a-f0-9]{8}$/);
    expect(safeId("owner/repo.name")).toBe(safeId("Owner/Repo.Name"));
    expect(safeId("owner--repo/name")).not.toBe(safeId("owner/repo--name"));
  });

  test("project records derive isolated runtime paths", () => {
    const project = projectRecord(config(), "owner/repo.name");
    expect(project.workspaceRoot).toContain(safeId("owner/repo.name"));
    expect(project.logsRoot).toContain(safeId("owner/repo.name"));
    expect(project.serviceLabel).toBe(`dev.gakucho.${safeId("owner/repo.name")}`);
    expect(project.workflowPath).toBe(resolve("/tmp/repo/WORKFLOW.md"));
  });

  test("escapes shell and XML data", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    expect(xmlEscape("<&\"'>")).toBe("&lt;&amp;&quot;&apos;&gt;");
  });
});
