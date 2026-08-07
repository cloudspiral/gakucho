import { describe, expect, test } from "bun:test";
import { formatStatuses } from "../src/status.ts";
import type { ProjectStatus } from "../src/status.ts";

describe("status output", () => {
  test("shows desired, service, health, port, and Symphony counts", () => {
    const status = {
      project: {
        repo: "owner/repo",
        config: { path: "/tmp/repo", workflow: "WORKFLOW.md", enabled: true, dashboard_port: 4000 },
        safeId: "owner--repo--12345678",
        workflowPath: "/tmp/repo/WORKFLOW.md",
        workspaceRoot: "/tmp/workspaces/repo",
        logsRoot: "/tmp/logs/repo",
        runnerPath: "/tmp/run.sh",
        plistPath: "/tmp/run.plist",
        serviceLabel: "dev.gakucho.owner--repo--12345678",
      },
      loaded: true,
      healthy: true,
      counts: { running: 1, retrying: 2, blocked: 3 },
    } satisfies ProjectStatus;
    const output = formatStatuses([status]);
    expect(output).toContain("owner/repo");
    expect(output).toContain("enabled");
    expect(output).toContain("healthy");
    expect(output).toContain("1/2/3");
  });
});
