import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import toml from "@iarna/toml";
import {
  NodeRegistrySchema,
  type NodeInventoryEntry,
  type NodeRegistry,
} from "@chiba-cable2/contracts";

export type RegistryPaths = {
  repoRoot: string;
  canonicalPath: string;
  localPath: string | null;
};

export type ApiKeySource =
  | "env.CHIBA_NODE_API_KEY"
  | "env.CHIBA_API_KEY"
  | "registry.defaults.api_key"
  | "none";

export type LoadInventoryOptions = {
  repoRoot?: string;
  canonicalPath?: string;
  localPath?: string | null;
  env?: NodeJS.ProcessEnv;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function findRepoRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(current, "scripts", "pis", "registry.toml");
    if (isNonEmptyString(candidate) && fsSync.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // If this package lives in <repo>/cable2/packages/core/dist, prefer <repo>/cable2.
  const fallbackCable2 = path.resolve(startDir, "..", "..");
  const fallbackRegistry = path.join(fallbackCable2, "scripts", "pis", "registry.toml");
  if (fsSync.existsSync(fallbackRegistry)) return fallbackCable2;
  return path.resolve(startDir);
}

export function resolveRegistryPaths(options: LoadInventoryOptions = {}): RegistryPaths {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? findRepoRoot();

  const defaultCanonical = fsSync.existsSync(path.join(repoRoot, "../scripts/pis/registry.toml"))
    ? "../scripts/pis/registry.toml"
    : "scripts/pis/registry.toml";

  const canonicalPath = path.resolve(
    repoRoot,
    options.canonicalPath ?? env.CHIBA_REGISTRY_PATH ?? defaultCanonical
  );

  const defaultLocal = fsSync.existsSync(path.join(repoRoot, "../scripts/pis/registry.local.toml"))
    ? "../scripts/pis/registry.local.toml"
    : "scripts/pis/registry.local.toml";

  const requestedLocal =
    options.localPath === undefined
      ? env.CHIBA_REGISTRY_LOCAL_PATH ?? defaultLocal
      : options.localPath;

  const localPath = requestedLocal ? path.resolve(repoRoot, requestedLocal) : null;

  return { repoRoot, canonicalPath, localPath };
}

async function loadTomlFile(filePath: string): Promise<NodeRegistry> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = toml.parse(raw) as unknown;
  return NodeRegistrySchema.parse(parsed);
}

function mergeRegistry(publicRegistry: NodeRegistry, localRegistry: NodeRegistry | null): NodeRegistry {
  if (!localRegistry) return publicRegistry;
  const mergedDefaults = {
    ...(publicRegistry.defaults ?? {}),
    ...(localRegistry.defaults ?? {}),
  };

  const mergedPis: Record<string, Record<string, unknown>> = {
    ...(publicRegistry.pis ?? {}),
  };

  for (const [id, localPi] of Object.entries(localRegistry.pis ?? {})) {
    mergedPis[id] = {
      ...(mergedPis[id] ?? {}),
      ...localPi,
    };
  }

  return {
    ...publicRegistry,
    ...localRegistry,
    defaults: mergedDefaults,
    pis: mergedPis,
  };
}

function resolveSharedApiKey(defaults: NodeRegistry["defaults"], env: NodeJS.ProcessEnv): {
  apiKey: string | null;
  source: ApiKeySource;
} {
  const fromNodeEnv = (env.CHIBA_NODE_API_KEY ?? "").trim();
  if (fromNodeEnv) return { apiKey: fromNodeEnv, source: "env.CHIBA_NODE_API_KEY" };

  const fromLegacyEnv = (env.CHIBA_API_KEY ?? "").trim();
  if (fromLegacyEnv) return { apiKey: fromLegacyEnv, source: "env.CHIBA_API_KEY" };

  const fromRegistryDefaults = (defaults?.api_key ?? "").trim();
  if (fromRegistryDefaults) {
    return { apiKey: fromRegistryDefaults, source: "registry.defaults.api_key" };
  }

  return { apiKey: null, source: "none" };
}

function countPerNodeApiKeys(pis: NodeRegistry["pis"]): number {
  let total = 0;
  for (const pi of Object.values(pis ?? {})) {
    if (isNonEmptyString(pi.api_key)) total += 1;
  }
  return total;
}

function toInventoryEntries(mergedRegistry: NodeRegistry, sharedApiKey: string | null): NodeInventoryEntry[] {
  const defaults = mergedRegistry.defaults ?? {};
  const pis = mergedRegistry.pis ?? {};

  const entries: NodeInventoryEntry[] = Object.entries(pis).map(([id, pi]) => {
    const host = isNonEmptyString(pi.host) ? pi.host.trim() : undefined;
    const ip = isNonEmptyString(pi.ip) ? pi.ip.trim() : undefined;

    return {
      id,
      host,
      ip,
      nodeName: isNonEmptyString(pi.node_name) ? pi.node_name.trim() : id,
      orientation: isNonEmptyString(pi.orientation) ? pi.orientation.trim() : undefined,
      displayRotate: pi.display_rotate,
      guidePort: pi.guide_port ?? defaults.guide_port ?? 5173,
      nodePort: pi.node_port ?? defaults.node_port ?? 8080,
      serverPort: pi.server_port ?? defaults.server_port ?? 8787,
      // Use one shared key across the fleet.
      apiKey: sharedApiKey,
    };
  });

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

export async function loadNodeInventory(options: LoadInventoryOptions = {}): Promise<{
  paths: RegistryPaths;
  publicRegistry: NodeRegistry;
  localRegistry: NodeRegistry | null;
  mergedRegistry: NodeRegistry;
  entries: NodeInventoryEntry[];
  apiKeyPolicy: {
    source: ApiKeySource;
    sharedConfigured: boolean;
    ignoredPerNodeApiKeys: number;
  };
}> {
  const env = options.env ?? process.env;
  const paths = resolveRegistryPaths({ ...options, env });

  const publicRegistry = await loadTomlFile(paths.canonicalPath);

  const localRegistry =
    paths.localPath && fsSync.existsSync(paths.localPath)
      ? await loadTomlFile(paths.localPath)
      : null;

  const mergedRegistry = mergeRegistry(publicRegistry, localRegistry);
  const resolvedKey = resolveSharedApiKey(mergedRegistry.defaults, env);
  const entries = toInventoryEntries(mergedRegistry, resolvedKey.apiKey);
  const ignoredPerNodeApiKeys = countPerNodeApiKeys(mergedRegistry.pis);

  return {
    paths,
    publicRegistry,
    localRegistry,
    mergedRegistry,
    entries,
    apiKeyPolicy: {
      source: resolvedKey.source,
      sharedConfigured: Boolean(resolvedKey.apiKey),
      ignoredPerNodeApiKeys,
    },
  };
}
