import { basename, resolve } from "node:path";
import type { GakuchoConfig, ProjectRecord } from "./types.ts";
import { GakuchoError } from "./errors.ts";
import { projectRecord } from "./paths.ts";

const ownerPart = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
const repoPart = "[A-Za-z0-9._-]+";
const identityPattern = new RegExp(`^(${ownerPart})/(${repoPart})$`);

export function normalizeRepoIdentity(value: string): string {
  const trimmed = value.trim().replace(/\.git$/i, "");
  const match = identityPattern.exec(trimmed);
  if (!match) throw new GakuchoError(`Expected GitHub repository in owner/repo form: ${value}`);
  return `${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}`;
}

export function repoFromRemote(remote: string): string {
  const value = remote.trim();
  const patterns = [
    /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i,
    /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return normalizeRepoIdentity(match[1]);
  }
  throw new GakuchoError(`Origin is not a supported GitHub remote: ${remote}`);
}

export function canonicalRemote(repo: string): string {
  return `https://github.com/${normalizeRepoIdentity(repo)}.git`;
}

export function resolveProject(config: GakuchoConfig, reference: string): ProjectRecord {
  const trimmed = reference.trim();
  const normalizedCandidate = trimmed.includes("/") && !trimmed.startsWith("/")
    ? tryNormalizeRepo(trimmed)
    : undefined;
  if (normalizedCandidate && config.projects[normalizedCandidate]) {
    return projectRecord(config, normalizedCandidate);
  }

  const absoluteCandidate = resolve(trimmed);
  const pathMatches = Object.entries(config.projects).filter(([, project]) =>
    resolve(project.path) === absoluteCandidate
  );
  if (pathMatches.length === 1) return projectRecord(config, pathMatches[0]![0]);

  const basenameMatches = Object.entries(config.projects).filter(([, project]) =>
    basename(project.path) === trimmed
  );
  if (basenameMatches.length === 1) return projectRecord(config, basenameMatches[0]![0]);
  if (basenameMatches.length > 1) {
    throw new GakuchoError(`Project reference is ambiguous; use owner/repo: ${reference}`);
  }
  throw new GakuchoError(`Project is not registered: ${reference}`);
}

function tryNormalizeRepo(value: string): string | undefined {
  try {
    return normalizeRepoIdentity(value);
  } catch {
    return undefined;
  }
}
