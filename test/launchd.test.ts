import { describe, expect, test } from "bun:test";
import type { GakuchoConfig } from "../src/types.ts";
import { projectRecord } from "../src/paths.ts";
import { plistTemplate, runnerTemplate } from "../src/launchd.ts";
import { run } from "../src/process.ts";

function config(): GakuchoConfig {
  return {
    schema_version: 1,
    symphony: {
      checkout: "/tmp/symphony & checkout",
      version: "v0.0.2",
      executable: "/tmp/symphony & checkout/elixir/bin/symphony",
    },
    defaults: {
      workspace_base: "/tmp/work spaces",
      logs_base: "/tmp/logs & state",
      dashboard_port_start: 4000,
    },
    projects: {
      "owner/repo": {
        path: "/tmp/source repo",
        workflow: "WORKFLOW.md",
        enabled: false,
        dashboard_port: 4000,
      },
    },
  };
}

describe("runtime templates", () => {
  test("runner obtains but never persists a token value", () => {
    const cfg = config();
    const source = runnerTemplate(cfg, projectRecord(cfg, "owner/repo"));
    expect(source).toContain("$gh_bin auth token --hostname github.com");
    expect(source).toContain("export GITHUB_TOKEN=\"$github_token\"");
    expect(source).toContain("unset github_token");
    expect(source).toContain("mise_bin");
    expect(source).toContain("--i-understand-that-this-will-be-running-without-the-usual-guardrails");
  });

  test("plist escapes path data and targets exactly one runner", () => {
    const cfg = config();
    const project = projectRecord(cfg, "owner/repo");
    const source = plistTemplate(cfg, project);
    expect(source).toContain("&amp;");
    expect(source).toContain(project.serviceLabel);
    expect(source).toContain("<key>KeepAlive</key>");
  });

  test("generated runtime files pass the native macOS syntax validators", async () => {
    const cfg = config();
    const project = projectRecord(cfg, "owner/repo");
    await run("/bin/zsh", ["-n"], { input: runnerTemplate(cfg, project) });
    await run("/usr/bin/plutil", ["-lint", "-"], { input: plistTemplate(cfg, project) });
  });
});
