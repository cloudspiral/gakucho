import { describe, expect, test } from "bun:test";
import { canonicalRemote, normalizeRepoIdentity, repoFromRemote, resolveProject } from "../src/project-ref.ts";
import type { GakuchoConfig } from "../src/types.ts";

function config(): GakuchoConfig {
  return {
    schema_version: 1,
    symphony: { checkout: "/tmp/symphony", version: "v0.0.2", executable: "/tmp/symphony/bin" },
    defaults: { workspace_base: "/tmp/workspaces", logs_base: "/tmp/logs", dashboard_port_start: 4000 },
    projects: {
      "cloudspiral/one": { path: "/tmp/alpha/one", workflow: "WORKFLOW.md", enabled: false, dashboard_port: 4000 },
      "other/two": { path: "/tmp/beta/two", workflow: "WORKFLOW.md", enabled: false, dashboard_port: 4001 },
    },
  };
}

describe("GitHub identity", () => {
  test("normalizes supported GitHub remotes", () => {
    expect(repoFromRemote("https://github.com/CloudSpiral/Repo.git")).toBe("cloudspiral/repo");
    expect(repoFromRemote("git@github.com:CloudSpiral/Repo.git")).toBe("cloudspiral/repo");
    expect(repoFromRemote("ssh://git@github.com/CloudSpiral/Repo.git")).toBe("cloudspiral/repo");
    expect(canonicalRemote("CloudSpiral/Repo")).toBe("https://github.com/cloudspiral/repo.git");
  });

  test("rejects non-GitHub and malformed identities", () => {
    expect(() => repoFromRemote("https://gitlab.com/owner/repo.git")).toThrow("not a supported GitHub remote");
    expect(() => normalizeRepoIdentity("owner" )).toThrow("owner/repo");
  });

  test("resolves exact identity, path, and unique basename", () => {
    expect(resolveProject(config(), "cloudspiral/one").repo).toBe("cloudspiral/one");
    expect(resolveProject(config(), "/tmp/beta/two").repo).toBe("other/two");
    expect(resolveProject(config(), "one").repo).toBe("cloudspiral/one");
  });
});
