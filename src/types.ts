export const PROFILES = ["bun", "python-uv", "blank"] as const;
export type Profile = (typeof PROFILES)[number];

export interface SymphonyConfig {
  checkout: string;
  version: string;
  executable: string;
}

export interface DefaultsConfig {
  workspace_base: string;
  logs_base: string;
  dashboard_port_start: number;
}

export interface ProjectConfig {
  path: string;
  workflow: string;
  enabled: boolean;
  dashboard_port: number;
  workspace_root?: string;
}

export interface GakuchoConfig {
  schema_version: 1;
  symphony: SymphonyConfig;
  defaults: DefaultsConfig;
  projects: Record<string, ProjectConfig>;
}

export interface ProjectRecord {
  repo: string;
  config: ProjectConfig;
  safeId: string;
  workflowPath: string;
  workspaceRoot: string;
  logsRoot: string;
  runnerPath: string;
  plistPath: string;
  serviceLabel: string;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ActionStep {
  stage: string;
  description: string;
}
