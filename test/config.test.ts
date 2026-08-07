import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { defaultConfig, loadConfig, parseConfig, writeConfig } from "../src/config.ts";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("registry", () => {
  test("writes atomically with restrictive permissions and reads back", async () => {
    const root = await mkdtemp(join(tmpdir(), "gakucho-config-"));
    temporary.push(root);
    const path = join(root, "nested", "config.yaml");
    const config = defaultConfig();
    config.projects["owner/repo"] = {
      path: "/tmp/repo",
      workflow: "WORKFLOW.md",
      enabled: false,
      dashboard_port: 4100,
    };
    await writeConfig(config, path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "nested"))).mode & 0o777).toBe(0o700);
    expect((await loadConfig(path)).projects["owner/repo"]?.dashboard_port).toBe(4100);
    expect((await readFile(path, "utf8"))).not.toContain("token");
  });

  test("rejects unknown fields", () => {
    const raw = defaultConfig() as unknown as Record<string, unknown>;
    raw.extra = true;
    expect(() => parseConfig(YAML.stringify(raw))).toThrow("Unrecognized key");
  });

  test("rejects duplicate ports and paths", () => {
    const config = defaultConfig();
    config.projects["owner/one"] = {
      path: "/tmp/shared",
      workflow: "WORKFLOW.md",
      enabled: false,
      dashboard_port: 4000,
    };
    config.projects["owner/two"] = {
      path: "/tmp/shared",
      workflow: "WORKFLOW.md",
      enabled: false,
      dashboard_port: 4001,
    };
    expect(() => parseConfig(YAML.stringify(config))).toThrow("share path");
    config.projects["owner/two"]!.path = "/tmp/two";
    config.projects["owner/two"]!.dashboard_port = 4000;
    expect(() => parseConfig(YAML.stringify(config))).toThrow("share dashboard port");
  });

  test("rejects workspace collisions even when source paths and ports differ", () => {
    const config = defaultConfig();
    config.projects["owner/one"] = {
      path: "/tmp/one",
      workflow: "WORKFLOW.md",
      enabled: false,
      dashboard_port: 4000,
      workspace_root: "/tmp/shared-workspace",
    };
    config.projects["owner/two"] = {
      path: "/tmp/two",
      workflow: "WORKFLOW.md",
      enabled: false,
      dashboard_port: 4001,
      workspace_root: "/tmp/shared-workspace",
    };
    expect(() => parseConfig(YAML.stringify(config))).toThrow("share workspace root");
  });

  test("returns defaults when the registry is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "gakucho-missing-"));
    temporary.push(root);
    const config = await loadConfig(join(root, "config.yaml"));
    expect(config.schema_version).toBe(1);
    expect(config.symphony.version).toBe("v0.0.2");
  });
});
