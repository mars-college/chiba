#!/usr/bin/env node
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  APPLY_TARGETS,
  ApplyTargetSchema,
  type ApplyComputation,
  type ApplyDispatchResult,
  type CatalogItem,
  type NodeInventoryEntry,
} from "@chiba-cable2/contracts";
import {
  buildApplyComputation,
  dispatchApplyComputation,
  loadCatalog,
  loadNodeInventory,
  loadResourceStore,
} from "@chiba-cable2/core";

type Flags = {
  json: boolean;
  dryRun: boolean;
  execute: boolean;
  fetch: boolean;
  nodes: string[];
  envFiles: string[];
  registryPath?: string;
  registryLocalPath?: string | null;
  timeoutMs: number;
  limit: number;
  controlPlaneUrl?: string;
};

function buildInventoryOptions(flags: Flags): {
  canonicalPath?: string;
  localPath?: string | null;
} {
  const options: { canonicalPath?: string; localPath?: string | null } = {};
  if (flags.registryPath !== undefined) {
    options.canonicalPath = flags.registryPath;
  }
  if (flags.registryLocalPath !== undefined) {
    options.localPath = flags.registryLocalPath;
  }
  return options;
}

function printHelp(): void {
  console.log(`
chiba CLI (cable2 scaffold)

Usage:
  chiba get <resource> [--json]
  chiba inspect node <id> [--fetch] [--timeout-ms N] [--json]
  chiba doctor node <id> [--timeout-ms N] [--json]
  chiba bootstrap <pi-name> [--env-file PATH] [--registry PATH] [--control-plane-url URL] [--no-reboot]
  chiba apply <target> <id> [--nodes a,b] [--dry-run] [--execute] [--timeout-ms N] [--control-plane URL] [--json]
  chiba diff <target> <id> [--nodes a,b] [--fetch] [--timeout-ms N] [--json]
  chiba prepare profile <id> [--write] [--continue-on-error] [--json]
  chiba compile profile <id> [--json]
  chiba import dir <path> --playlist-id <id> [--playlist-title <title>] [--tag <tag>] [--cache] [--write] [--channel-id <id>] [--channel-name <name>] [--channel-number <num>]
  chiba import eden-collection <url-or-id> --playlist-id <id> [--playlist-title <title>] [--tag <tag>] [--db PROD|STAGE] [--cache] [--write] [--channel-id <id>] [--channel-name <name>] [--channel-number <num>]

Resources:
  nodes | media | playlists | blocks | channels | profiles | operations | desired-state | node-status

Apply targets:
  ${APPLY_TARGETS.join(" | ")}

Registry flags:
  --registry PATH         Override canonical registry path
  --registry-local PATH   Override local overlay path
  --no-registry-local     Disable local registry overlay

Global flags:
  --json
  --limit N
  --env-file PATH   Load env file (can be passed multiple times)
`);
}

function parseBootstrapArgs(rest: string[]): { piName: string; scriptArgs: string[] } {
  let piName = "";
  const scriptArgs: string[] = [];
  const expectsValue = new Set([
    "--env-file",
    "--registry",
    "--host",
    "--control-plane-url",
    "--rsync-timeout-sec",
  ]);

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? "";
    if (!piName && !arg.startsWith("-")) {
      piName = arg;
      continue;
    }
    scriptArgs.push(arg);
    if (expectsValue.has(arg)) {
      const next = rest[i + 1];
      if (next !== undefined) {
        scriptArgs.push(next);
        i += 1;
      }
    }
  }

  if (!piName) {
    throw new Error("Missing pi-name for bootstrap");
  }

  return { piName, scriptArgs };
}

function parseArgs(argv: string[]): { command: string | null; rest: string[]; flags: Flags } {
  const rest: string[] = [];
  const flags: Flags = {
    json: false,
    dryRun: false,
    execute: false,
    fetch: false,
    nodes: [],
    envFiles: [],
    timeoutMs: 2500,
    limit: 200,
  };

  let command: string | null = null;

  const pushNodes = (value: string) => {
    for (const item of value.split(",")) {
      const trimmed = item.trim();
      if (trimmed) flags.nodes.push(trimmed);
    }
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--") continue;
    if (!command && !arg.startsWith("-")) {
      command = arg;
      continue;
    }

    if (arg === "--json") {
      flags.json = true;
      continue;
    }
    if (arg === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (arg === "--execute") {
      flags.execute = true;
      continue;
    }
    if (arg === "--fetch") {
      flags.fetch = true;
      continue;
    }
    if (arg === "--env-file") {
      const value = argv[i + 1];
      i += 1;
      if (typeof value === "string" && value.trim()) {
        flags.envFiles.push(value.trim());
      }
      continue;
    }
    if (arg.startsWith("--env-file=")) {
      const value = arg.slice("--env-file=".length).trim();
      if (value) flags.envFiles.push(value);
      continue;
    }
    if (arg === "--nodes") {
      const value = argv[i + 1] ?? "";
      i += 1;
      pushNodes(value);
      continue;
    }
    if (arg.startsWith("--nodes=")) {
      pushNodes(arg.slice("--nodes=".length));
      continue;
    }
    if (arg === "--registry") {
      const value = argv[i + 1];
      i += 1;
      if (value) flags.registryPath = value;
      continue;
    }
    if (arg.startsWith("--registry=")) {
      flags.registryPath = arg.slice("--registry=".length);
      continue;
    }
    if (arg === "--registry-local") {
      flags.registryLocalPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith("--registry-local=")) {
      flags.registryLocalPath = arg.slice("--registry-local=".length);
      continue;
    }
    if (arg === "--no-registry-local") {
      flags.registryLocalPath = null;
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = Number(argv[i + 1] ?? "");
      i += 1;
      if (Number.isFinite(value) && value > 0) {
        flags.timeoutMs = Math.floor(value);
      }
      continue;
    }
    if (arg === "--limit") {
      const value = Number(argv[i + 1] ?? "");
      i += 1;
      if (Number.isFinite(value) && value > 0) {
        flags.limit = Math.floor(value);
      }
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isFinite(value) && value > 0) {
        flags.limit = Math.floor(value);
      }
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      const value = Number(arg.slice("--timeout-ms=".length));
      if (Number.isFinite(value) && value > 0) {
        flags.timeoutMs = Math.floor(value);
      }
      continue;
    }
    if (arg === "--control-plane") {
      const value = argv[i + 1];
      i += 1;
      if (value) flags.controlPlaneUrl = value;
      continue;
    }
    if (arg.startsWith("--control-plane=")) {
      const value = arg.slice("--control-plane=".length);
      if (value) flags.controlPlaneUrl = value;
      continue;
    }

    rest.push(arg);
  }

  return { command, rest, flags };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadEnvFileIfPresent(filePath: string): Promise<boolean> {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return false;
  }
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const m = s.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1] ?? "";
    if (!key) continue;
    let value = (m[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

async function loadCliEnv(flags: Flags): Promise<void> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const cableRoot = path.resolve(moduleDir, "../../..");
  const repoRoot = path.resolve(cableRoot, "..");
  const defaults = [
    path.join(repoRoot, ".env"),
    path.join(cableRoot, ".env"),
    path.join(cableRoot, ".env.pis.local"),
    path.join(cableRoot, ".env.pis.prod"),
    path.join(repoRoot, "scripts", "pis", ".env.pis.local"),
  ];
  const explicit: string[] = [];
  for (const file of flags.envFiles) {
    const candidates = path.isAbsolute(file)
      ? [file]
      : [
          path.resolve(process.cwd(), file),
          path.resolve(repoRoot, file),
          path.resolve(cableRoot, file),
        ];
    let picked: string | null = null;
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        picked = candidate;
        break;
      }
    }
    const firstCandidate = candidates[0] ?? file;
    explicit.push(picked ?? firstCandidate);
  }

  const files = Array.from(new Set([...defaults, ...explicit]));
  for (const file of files) {
    await loadEnvFileIfPresent(file);
  }
}

function printOutput(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

async function postControlPlaneApply(args: {
  baseUrl: string;
  target: string;
  id: string;
  nodeIds: string[];
  dryRun: boolean;
  execute: boolean;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs + 500);
  try {
    const response = await fetch(`${args.baseUrl.replace(/\/$/, "")}/api/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        target: args.target,
        id: args.id,
        nodeIds: args.nodeIds,
        dryRun: args.dryRun,
        execute: args.execute,
        timeoutMs: args.timeoutMs,
      }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // leave as text
    }
    if (!response.ok) {
      throw new Error(`control_plane_http_${response.status}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function getControlPlaneJson(args: {
  baseUrl: string;
  path: string;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs + 500);
  try {
    const response = await fetch(`${args.baseUrl.replace(/\/$/, "")}${args.path}`, {
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // leave as text
    }
    if (!response.ok) {
      throw new Error(`control_plane_http_${response.status}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function renderNodeTable(nodes: NodeInventoryEntry[]): string {
  const rows = [
    ["ID", "NODE_NAME", "HOST", "IP", "GUIDE_PORT", "NODE_PORT", "SERVER_PORT"],
    ...nodes.map((n) => [
      n.id,
      n.nodeName,
      n.host ?? "",
      n.ip ?? "",
      String(n.guidePort),
      String(n.nodePort),
      String(n.serverPort),
    ]),
  ];

  const widths = rows[0]?.map((_, column) => {
    return Math.max(...rows.map((row) => row[column]?.length ?? 0));
  }) ?? [];

  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? cell.length, " "))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

function renderCatalogTable(items: CatalogItem[]): string {
  const rows = [
    ["ID", "TITLE", "FILE"],
    ...items.map((item) => [item.id, item.title ?? "", item.filePath]),
  ];

  const widths =
    rows[0]?.map((_, column) =>
      Math.max(...rows.map((row) => row[column]?.length ?? 0))
    ) ?? [];

  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? cell.length, " "))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

function findCatalogItemsByResource(
  resource: "media" | "playlists" | "blocks" | "channels" | "profiles",
  catalog: Awaited<ReturnType<typeof loadCatalog>>
): CatalogItem[] {
  switch (resource) {
    case "media":
      return catalog.media;
    case "playlists":
      return catalog.playlists;
    case "blocks":
      return catalog.blocks;
    case "channels":
      return catalog.channels;
    case "profiles":
      return catalog.profiles;
  }
}

function findCatalogItemsByTarget(
  target: "profile" | "channel" | "block" | "playlist" | "media",
  catalog: Awaited<ReturnType<typeof loadCatalog>>
): CatalogItem[] {
  switch (target) {
    case "profile":
      return catalog.profiles;
    case "channel":
      return catalog.channels;
    case "block":
      return catalog.blocks;
    case "playlist":
      return catalog.playlists;
    case "media":
      return catalog.media;
  }
}

function suggestIds(candidates: string[], input: string): string[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return [];
  const startsWith = candidates.filter((id) => id.toLowerCase().startsWith(normalized));
  if (startsWith.length > 0) return startsWith.slice(0, 6);
  const includes = candidates.filter((id) => id.toLowerCase().includes(normalized));
  return includes.slice(0, 6);
}

async function cmdGet(resource: string | undefined, flags: Flags): Promise<void> {
  if (!resource) {
    throw new Error("Missing resource for get command");
  }

  if (resource === "operations" || resource === "desired-state" || resource === "node-status") {
    if (!flags.controlPlaneUrl) {
      throw new Error(`get ${resource} requires --control-plane <url>`);
    }
    const nodeIdQuery = flags.nodes.length === 1 ? `nodeId=${encodeURIComponent(flags.nodes[0] ?? "")}` : "";
    const path =
      resource === "operations"
        ? `/api/operations?limit=${flags.limit}`
        : resource === "desired-state"
          ? `/api/desired-state${nodeIdQuery ? `?${nodeIdQuery}` : ""}`
          : `/api/node-status?limit=${flags.limit}${nodeIdQuery ? `&${nodeIdQuery}` : ""}`;
    const payload = await getControlPlaneJson({
      baseUrl: flags.controlPlaneUrl,
      path,
      timeoutMs: flags.timeoutMs,
    });
    printOutput(payload, flags.json);
    return;
  }

  switch (resource) {
    case "nodes": {
      const data = await loadNodeInventory({
        ...buildInventoryOptions(flags),
      });

      if (flags.json) {
        printOutput(
          {
            registry: {
              canonicalPath: data.paths.canonicalPath,
              localPath: data.paths.localPath,
            },
            apiKeyPolicy: data.apiKeyPolicy,
            nodes: data.entries.map((entry) => ({
              ...entry,
              hasApiKey: Boolean(entry.apiKey),
              apiKey: undefined,
            })),
          },
          true
        );
        return;
      }

      console.log(`Registry: ${data.paths.canonicalPath}`);
      console.log(`Local overlay: ${data.paths.localPath ?? "(disabled)"}`);
      console.log(
        `Shared API key: ${
          data.apiKeyPolicy.sharedConfigured
            ? `configured (${data.apiKeyPolicy.source})`
            : "not configured"
        }`
      );
      if (data.apiKeyPolicy.ignoredPerNodeApiKeys > 0) {
        console.log(
          `Ignored per-node API keys: ${data.apiKeyPolicy.ignoredPerNodeApiKeys} (single-key policy)`
        );
      }
      console.log("");
      console.log(renderNodeTable(data.entries));
      return;
    }
    case "media":
    case "playlists":
    case "blocks":
    case "channels":
    case "profiles": {
      const catalog = await loadCatalog();
      const items = findCatalogItemsByResource(resource, catalog);
      if (flags.json) {
        printOutput({ resource, count: items.length, items }, true);
        return;
      }
      console.log(`${resource}: ${items.length}`);
      console.log("");
      console.log(renderCatalogTable(items));
      return;
    }
    default:
      throw new Error(`Unsupported resource: ${resource}`);
  }
}

type NodeFetchResult = {
  ok: boolean;
  status: number | null;
  data: unknown;
  error: string | null;
  ms: number;
  url: string;
};

async function fetchNodeJson(args: {
  host: string;
  port: number;
  path: string;
  timeoutMs: number;
  apiKey: string | null;
}): Promise<NodeFetchResult> {
  const normalizedHost =
    args.host.includes(":") && !args.host.startsWith("[") ? `[${args.host}]` : args.host;
  const requestUrl = `http://${normalizedHost}:${args.port}${args.path}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (args.apiKey) headers["x-api-key"] = args.apiKey;
    const response = await fetch(requestUrl, {
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      data: parsed,
      error: response.ok ? null : `http_${response.status}`,
      ms: Date.now() - startedAt,
      url: requestUrl,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      error: (error as Error).message,
      ms: Date.now() - startedAt,
      url: requestUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function extractCurrentTargetFromState(statePayload: unknown): { kind: string; id: string } | null {
  const root = asRecord(statePayload);
  const state = asRecord(root?.state);
  const lastRequest = asRecord(state?.lastRequest);
  const intent = asRecord(lastRequest?.intent);
  const target = asRecord(intent?.target);
  const kind = typeof target?.kind === "string" ? target.kind.trim() : "";
  const id = typeof target?.id === "string" ? target.id.trim() : "";
  if (!kind || !id) return null;
  return { kind, id };
}

function extractCurrentTargetFromServerKioskState(serverPayload: unknown): { kind: string; id: string } | null {
  const root = asRecord(serverPayload);
  const record = asRecord(root?.record);
  const state = asRecord(record?.state);
  const kind = typeof state?.targetKind === "string" ? state.targetKind.trim() : "";
  const id = typeof state?.targetId === "string" ? state.targetId.trim() : "";
  if (kind && id) return { kind, id };
  const channel = typeof state?.channel === "string" ? state.channel.trim() : "";
  if (channel) return { kind: "channel", id: channel };
  return null;
}

function extractKioskUrl(statusPayload: unknown, kioskPayload: unknown): string | null {
  const statusRoot = asRecord(statusPayload);
  const statusNode = asRecord(statusRoot?.node);
  const fromStatus = typeof statusNode?.kioskUrl === "string" ? statusNode.kioskUrl.trim() : "";
  if (fromStatus) return fromStatus;
  const kioskRoot = asRecord(kioskPayload);
  const fromKiosk = typeof kioskRoot?.kioskUrl === "string" ? kioskRoot.kioskUrl.trim() : "";
  return fromKiosk || null;
}

function extractCurrentTargetFromKioskUrl(kioskUrl: string | null): { kind: string; id: string } | null {
  if (!kioskUrl) return null;
  try {
    const parsed = new URL(kioskUrl);
    const kind = (parsed.searchParams.get("targetKind") ?? "").trim();
    const id = (parsed.searchParams.get("targetId") ?? "").trim();
    if (kind && id) return { kind, id };
    const channel = (parsed.searchParams.get("channel") ?? "").trim();
    if (channel) return { kind: "channel", id: channel };
    return null;
  } catch {
    return null;
  }
}

function sameTarget(a: { kind: string; id: string } | null, b: { kind: string; id: string } | null): boolean {
  if (!a || !b) return false;
  return a.kind.trim() === b.kind.trim() && a.id.trim() === b.id.trim();
}

function renderDoctorProbeTable(rows: Array<[string, NodeFetchResult | null]>): string {
  const records = [
    ["PROBE", "OK", "STATUS", "MS", "ERROR", "URL"],
    ...rows.map(([label, probe]) => [
      label,
      probe ? (probe.ok ? "yes" : "no") : "-",
      probe ? String(probe.status ?? "-") : "-",
      probe ? `${probe.ms}` : "-",
      probe?.error ?? "",
      probe?.url ?? "",
    ]),
  ];
  const widths =
    records[0]?.map((_, col) => Math.max(...records.map((row) => row[col]?.length ?? 0))) ?? [];
  return records
    .map((row) =>
      row
        .map((cell, col) => cell.padEnd(widths[col] ?? cell.length, " "))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

async function cmdInspect(resource: string | undefined, id: string | undefined, flags: Flags): Promise<void> {
  if (resource !== "node") {
    throw new Error("inspect currently supports only: node");
  }
  if (!id) {
    throw new Error("Missing node id for inspect node <id>");
  }

  const inventory = await loadNodeInventory({
    ...buildInventoryOptions(flags),
  });
  const node = inventory.entries.find((entry) => entry.id === id);
  if (!node) {
    throw new Error(`Unknown node id: ${id}`);
  }

  const payload: Record<string, unknown> = {
    node: {
      ...node,
      hasApiKey: Boolean(node.apiKey),
      apiKey: undefined,
    },
    registry: {
      canonicalPath: inventory.paths.canonicalPath,
      localPath: inventory.paths.localPath,
    },
  };

  if (flags.fetch) {
    const host = node.ip ?? node.host;
    if (!host) {
      payload.live = {
        ok: false,
        error: "missing_host_or_ip",
      };
    } else {
      const [statusResult, stateResult, kioskUrlResult] = await Promise.all([
        fetchNodeJson({
          host,
          port: node.nodePort,
          path: "/status",
          timeoutMs: flags.timeoutMs,
          apiKey: node.apiKey,
        }),
        fetchNodeJson({
          host,
          port: node.nodePort,
          path: "/api/state",
          timeoutMs: flags.timeoutMs,
          apiKey: node.apiKey,
        }),
        fetchNodeJson({
          host,
          port: node.nodePort,
          path: "/kiosk-url",
          timeoutMs: flags.timeoutMs,
          apiKey: node.apiKey,
        }),
      ]);
      payload.live = {
        ok: statusResult.ok || stateResult.ok || kioskUrlResult.ok,
        status: statusResult,
        state: stateResult,
        kioskUrl: kioskUrlResult,
      };
    }
  }

  if (flags.json) {
    printOutput(payload, true);
    return;
  }

  console.log(`Node: ${node.id}`);
  console.log(`Name: ${node.nodeName}`);
  console.log(`Host: ${node.host ?? "-"}`);
  console.log(`IP: ${node.ip ?? "-"}`);
  console.log(`Node port: ${node.nodePort}`);
  console.log(`Server port: ${node.serverPort}`);
  console.log(`Guide port: ${node.guidePort}`);
  console.log(`Has API key: ${node.apiKey ? "yes" : "no"}`);
  if (flags.fetch) {
    console.log("");
    console.log("Live fetch attempted (see --json for full payload).");
  }
}

async function cmdDoctor(resource: string | undefined, id: string | undefined, flags: Flags): Promise<void> {
  if (resource !== "node") {
    throw new Error("doctor currently supports only: node");
  }
  if (!id) {
    throw new Error("Missing node id for doctor node <id>");
  }

  const inventory = await loadNodeInventory({
    ...buildInventoryOptions(flags),
  });
  const node = inventory.entries.find((entry) => entry.id === id);
  if (!node) {
    throw new Error(`Unknown node id: ${id}`);
  }

  const host = node.ip ?? node.host;
  if (!host) {
    throw new Error(`Node ${id} has no host/ip in registry`);
  }

  const screenId = encodeURIComponent(node.nodeName || node.id);
  const [nodeHealth, nodeStatus, nodeState, nodeKioskUrl, nodeCache, serverHealth, serverVersion, serverKioskState, guideRoot] =
    await Promise.all([
      fetchNodeJson({
        host,
        port: node.nodePort,
        path: "/health",
        timeoutMs: flags.timeoutMs,
        apiKey: node.apiKey,
      }),
      fetchNodeJson({
        host,
        port: node.nodePort,
        path: "/status",
        timeoutMs: flags.timeoutMs,
        apiKey: node.apiKey,
      }),
      fetchNodeJson({
        host,
        port: node.nodePort,
        path: "/api/state",
        timeoutMs: flags.timeoutMs,
        apiKey: node.apiKey,
      }),
      fetchNodeJson({
        host,
        port: node.nodePort,
        path: "/kiosk-url",
        timeoutMs: flags.timeoutMs,
        apiKey: node.apiKey,
      }),
      fetchNodeJson({
        host,
        port: node.nodePort,
        path: "/api/cache",
        timeoutMs: flags.timeoutMs,
        apiKey: node.apiKey,
      }),
      fetchNodeJson({
        host,
        port: node.serverPort,
        path: "/health",
        timeoutMs: flags.timeoutMs,
        apiKey: null,
      }),
      fetchNodeJson({
        host,
        port: node.serverPort,
        path: "/api/version",
        timeoutMs: flags.timeoutMs,
        apiKey: null,
      }),
      fetchNodeJson({
        host,
        port: node.serverPort,
        path: `/api/kiosk/state?screenId=${screenId}`,
        timeoutMs: flags.timeoutMs,
        apiKey: null,
      }),
      fetchNodeJson({
        host,
        port: node.guidePort,
        path: "/",
        timeoutMs: flags.timeoutMs,
        apiKey: null,
      }),
    ]);

  const nodeStateTarget = extractCurrentTargetFromState(nodeState.data);
  const serverStateTarget = extractCurrentTargetFromServerKioskState(serverKioskState.data);
  const kioskUrl = extractKioskUrl(nodeStatus.data, nodeKioskUrl.data);
  const kioskUrlTarget = extractCurrentTargetFromKioskUrl(kioskUrl);
  const currentTarget = kioskUrlTarget ?? nodeStateTarget ?? serverStateTarget;
  const targetRef = currentTarget ? `${currentTarget.kind}:${currentTarget.id}` : null;

  let stashStatus: NodeFetchResult | null = null;
  let cacheStatus: NodeFetchResult | null = null;
  if (targetRef) {
    const encodedTarget = encodeURIComponent(targetRef);
    [stashStatus, cacheStatus] = await Promise.all([
      fetchNodeJson({
        host,
        port: node.serverPort,
        path: `/api/stash/status?target=${encodedTarget}`,
        timeoutMs: flags.timeoutMs,
        apiKey: null,
      }),
      fetchNodeJson({
        host,
        port: node.serverPort,
        path: `/api/cache/status?target=${encodedTarget}`,
        timeoutMs: flags.timeoutMs,
        apiKey: null,
      }),
    ]);
  }

  const nodeAgentReachable = nodeHealth.ok || nodeStatus.ok || nodeState.ok;
  const serverReachable = serverHealth.ok || serverVersion.ok;
  const guideReachable = guideRoot.ok;

  const nodeCacheRoot = asRecord(nodeCache.data);
  const nodeCachePayload = asRecord(nodeCacheRoot?.cache);
  const nodeCacheBytes =
    typeof nodeCachePayload?.bytes === "number" && Number.isFinite(nodeCachePayload.bytes)
      ? nodeCachePayload.bytes
      : null;
  const nodeCacheFiles =
    typeof nodeCachePayload?.fileCount === "number" && Number.isFinite(nodeCachePayload.fileCount)
      ? nodeCachePayload.fileCount
      : null;

  const stashRoot = asRecord(stashStatus?.data);
  const stashCached = typeof stashRoot?.cached === "number" ? stashRoot.cached : null;
  const stashTotal = typeof stashRoot?.total === "number" ? stashRoot.total : null;

  const remoteCacheRoot = asRecord(cacheStatus?.data);
  const remoteCached = typeof remoteCacheRoot?.cached === "number" ? remoteCacheRoot.cached : null;
  const remoteTotal = typeof remoteCacheRoot?.total === "number" ? remoteCacheRoot.total : null;

  const warnings: string[] = [];
  if (!nodeAgentReachable) warnings.push("node-agent unreachable on node_port");
  if (!serverReachable) warnings.push("cable server unreachable on server_port");
  if (!guideReachable) warnings.push("guide unreachable on guide_port");
  if (!kioskUrl) warnings.push("kiosk URL missing from node-agent status");
  if (serverStateTarget && !kioskUrlTarget) {
    warnings.push(
      `server kiosk-state target is ${serverStateTarget.kind}/${serverStateTarget.id}, but node kiosk URL has no target query params`
    );
  }
  if (serverStateTarget && kioskUrlTarget && !sameTarget(serverStateTarget, kioskUrlTarget)) {
    warnings.push(
      `server kiosk-state target (${serverStateTarget.kind}/${serverStateTarget.id}) does not match kiosk URL target (${kioskUrlTarget.kind}/${kioskUrlTarget.id})`
    );
  }
  if (nodeStateTarget && serverStateTarget && !sameTarget(nodeStateTarget, serverStateTarget)) {
    warnings.push(
      `node-agent apply target (${nodeStateTarget.kind}/${nodeStateTarget.id}) does not match server kiosk-state target (${serverStateTarget.kind}/${serverStateTarget.id})`
    );
  }
  if (stashTotal !== null && stashCached !== null && stashTotal > stashCached) {
    warnings.push(`stash incomplete for current target (${stashCached}/${stashTotal} cached)`);
  }
  if (remoteTotal !== null && remoteCached !== null && remoteTotal > remoteCached) {
    warnings.push(`remote cache incomplete for current target (${remoteCached}/${remoteTotal} cached)`);
  }

  const payload = {
    ok: warnings.length === 0,
    timestamp: new Date().toISOString(),
    node: {
      ...node,
      hostResolved: host,
      hasApiKey: Boolean(node.apiKey),
      apiKey: undefined,
    },
    registry: {
      canonicalPath: inventory.paths.canonicalPath,
      localPath: inventory.paths.localPath,
    },
    summary: {
      reachable: {
        nodeAgent: nodeAgentReachable,
        cableServer: serverReachable,
        guide: guideReachable,
      },
      targets: {
        effective: currentTarget,
        nodeState: nodeStateTarget,
        kioskUrl: kioskUrlTarget,
        serverKioskState: serverStateTarget,
      },
      currentTarget,
      kioskUrl,
      nodeCache: {
        bytes: nodeCacheBytes,
        fileCount: nodeCacheFiles,
      },
      stash: stashStatus
        ? {
            cached: stashCached,
            total: stashTotal,
            target: targetRef,
          }
        : null,
      remoteCache: cacheStatus
        ? {
            cached: remoteCached,
            total: remoteTotal,
            target: targetRef,
          }
        : null,
      warnings,
    },
    probes: {
      nodeHealth,
      nodeStatus,
      nodeState,
      nodeKioskUrl,
      nodeCache,
      serverHealth,
      serverVersion,
      serverKioskState,
      guideRoot,
      stashStatus,
      cacheStatus,
    },
  };

  if (flags.json) {
    printOutput(payload, true);
    if (warnings.length > 0) process.exitCode = 2;
    return;
  }

  console.log(`Doctor: node/${node.id}`);
  console.log(`Host resolved: ${host}`);
  console.log(`Ports: node=${node.nodePort} server=${node.serverPort} guide=${node.guidePort}`);
  console.log(`Current target: ${currentTarget ? `${currentTarget.kind}/${currentTarget.id}` : "-"}`);
  console.log(`Kiosk URL: ${kioskUrl ?? "-"}`);
  if (nodeCacheFiles !== null || nodeCacheBytes !== null) {
    console.log(`Node cache: files=${nodeCacheFiles ?? "-"} bytes=${nodeCacheBytes ?? "-"}`);
  }
  if (stashStatus) {
    console.log(`Stash status (${targetRef}): ${stashCached ?? "-"} / ${stashTotal ?? "-"}`);
  }
  if (cacheStatus) {
    console.log(`Remote cache status (${targetRef}): ${remoteCached ?? "-"} / ${remoteTotal ?? "-"}`);
  }
  console.log("");
  console.log(
    renderDoctorProbeTable([
      ["node /health", nodeHealth],
      ["node /status", nodeStatus],
      ["node /api/state", nodeState],
      ["node /kiosk-url", nodeKioskUrl],
      ["node /api/cache", nodeCache],
      ["server /health", serverHealth],
      ["server /api/version", serverVersion],
      ["server /api/kiosk/state", serverKioskState],
      ["guide /", guideRoot],
      ["server /api/stash/status", stashStatus],
      ["server /api/cache/status", cacheStatus],
    ])
  );

  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
    process.exitCode = 2;
  }
}

type NodeDiffRow = {
  nodeId: string;
  expected: { kind: string; id: string };
  actual: { kind: string; id: string } | null;
  status: "in_sync" | "drift" | "unknown" | "unreachable";
  error: string | null;
};

function renderDiffTable(rows: NodeDiffRow[]): string {
  const records = [
    ["NODE", "STATUS", "EXPECTED", "ACTUAL", "ERROR"],
    ...rows.map((row) => [
      row.nodeId,
      row.status,
      `${row.expected.kind}/${row.expected.id}`,
      row.actual ? `${row.actual.kind}/${row.actual.id}` : "-",
      row.error ?? "",
    ]),
  ];

  const widths =
    records[0]?.map((_, col) => Math.max(...records.map((row) => row[col]?.length ?? 0))) ?? [];

  return records
    .map((row) =>
      row
        .map((cell, col) => cell.padEnd(widths[col] ?? cell.length, " "))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

async function cmdDiff(targetRaw: string | undefined, id: string | undefined, flags: Flags): Promise<void> {
  if (!targetRaw) {
    throw new Error("Missing diff target");
  }
  if (!id) {
    throw new Error("Missing resource id for diff");
  }

  const target = ApplyTargetSchema.parse(targetRaw);
  const [inventory, store, catalog] = await Promise.all([
    loadNodeInventory({
      ...buildInventoryOptions(flags),
    }),
    loadResourceStore(),
    loadCatalog(),
  ]);
  const targetItems = findCatalogItemsByTarget(target, catalog);
  const targetExists = targetItems.some((item) => item.id === id);
  if (!targetExists) {
    const suggestions = suggestIds(
      targetItems.map((item) => item.id),
      id
    );
    const suffix =
      suggestions.length > 0
        ? ` Suggestions: ${suggestions.join(", ")}`
        : " No similar ids found.";
    throw new Error(`Unknown ${target} id: ${id}.${suffix}`);
  }

  const computation: ApplyComputation = buildApplyComputation({
    request: {
      target,
      id,
      nodeIds: flags.nodes.length > 0 ? flags.nodes : undefined,
      dryRun: true,
    },
    inventory: inventory.entries,
    store,
  });

  const inventoryById = new Map(inventory.entries.map((entry) => [entry.id, entry]));

  const rows: NodeDiffRow[] = await Promise.all(
    computation.nodeIntents.map(async (intent) => {
      const row: NodeDiffRow = {
        nodeId: intent.nodeId,
        expected: {
          kind: intent.target.kind,
          id: intent.target.id,
        },
        actual: null,
        status: "unknown",
        error: flags.fetch ? null : "fetch_not_requested",
      };

      if (!flags.fetch) return row;

      const node = inventoryById.get(intent.nodeId);
      if (!node) {
        return {
          ...row,
          status: "unreachable",
          error: "unknown_node",
        };
      }

      const host = node.ip ?? node.host;
      if (!host) {
        return {
          ...row,
          status: "unreachable",
          error: "missing_host_or_ip",
        };
      }

      const stateResult = await fetchNodeJson({
        host,
        port: node.nodePort,
        path: "/api/state",
        timeoutMs: flags.timeoutMs,
        apiKey: node.apiKey,
      });

      if (!stateResult.ok) {
        return {
          ...row,
          status: "unreachable",
          error: stateResult.error,
        };
      }

      const actualTarget = (() => {
        const targetUnknown = (stateResult.data as any)?.state?.lastRequest?.intent?.target as
          | { kind?: unknown; id?: unknown }
          | undefined;
        if (!targetUnknown) return null;
        if (typeof targetUnknown.kind !== "string" || typeof targetUnknown.id !== "string") {
          return null;
        }
        return {
          kind: targetUnknown.kind,
          id: targetUnknown.id,
        };
      })();

      if (!actualTarget) {
        return {
          ...row,
          status: "unknown",
          actual: null,
          error: "missing_last_request",
        };
      }

      const isMatch = actualTarget.kind === intent.target.kind && actualTarget.id === intent.target.id;
      return {
        ...row,
        actual: actualTarget,
        status: isMatch ? "in_sync" : "drift",
        error: isMatch ? null : "target_mismatch",
      };
    })
  );

  rows.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  const summary = {
    total: rows.length,
    inSync: rows.filter((row) => row.status === "in_sync").length,
    drift: rows.filter((row) => row.status === "drift").length,
    unknown: rows.filter((row) => row.status === "unknown").length,
    unreachable: rows.filter((row) => row.status === "unreachable").length,
  };

  const payload = {
    target: { kind: target, id },
    fetchedLiveState: flags.fetch,
    selectedNodeIds: computation.selectedNodeIds,
    warnings: computation.warnings,
    summary,
    rows,
  };

  if (flags.json) {
    printOutput(payload, true);
    return;
  }

  console.log(`Diff for ${target}/${id}`);
  console.log(`Nodes: ${summary.total}`);
  console.log(
    `in_sync=${summary.inSync} drift=${summary.drift} unknown=${summary.unknown} unreachable=${summary.unreachable}`
  );
  if (!flags.fetch) {
    console.log("Live node fetch was not requested. Add --fetch to compare with actual node state.");
  }
  console.log("");
  console.log(renderDiffTable(rows));
}

async function cmdApply(targetRaw: string | undefined, id: string | undefined, flags: Flags): Promise<void> {
  if (!targetRaw) {
    throw new Error("Missing apply target");
  }
  if (!id) {
    throw new Error("Missing resource id for apply");
  }

  const target = ApplyTargetSchema.parse(targetRaw);
  if (flags.controlPlaneUrl) {
    const remote = await postControlPlaneApply({
      baseUrl: flags.controlPlaneUrl,
      target,
      id,
      nodeIds: flags.nodes,
      dryRun: flags.dryRun,
      execute: flags.execute,
      timeoutMs: flags.timeoutMs,
    });
    printOutput(remote, flags.json);
    return;
  }

  const inventory = await loadNodeInventory({
    ...buildInventoryOptions(flags),
  });
  const store = await loadResourceStore();
  const catalog = await loadCatalog();
  const targetItems = findCatalogItemsByTarget(target, catalog);
  const targetExists = targetItems.some((item) => item.id === id);
  if (!targetExists) {
    const suggestions = suggestIds(
      targetItems.map((item) => item.id),
      id
    );
    const suffix =
      suggestions.length > 0
        ? ` Suggestions: ${suggestions.join(", ")}`
        : " No similar ids found.";
    throw new Error(`Unknown ${target} id: ${id}.${suffix}`);
  }

  const request = {
    target,
    id,
    nodeIds: flags.nodes.length > 0 ? flags.nodes : undefined,
    dryRun: flags.dryRun,
  };
  const computation: ApplyComputation = buildApplyComputation({
    request,
    inventory: inventory.entries,
    store,
  });

  let dispatchResults: ApplyDispatchResult[] | null = null;
  if (flags.execute && !flags.dryRun) {
    dispatchResults = await dispatchApplyComputation({
      computation,
      inventory: inventory.entries,
      timeoutMs: flags.timeoutMs,
    });
  }

  const payload = {
    request: {
      ...computation.request,
    },
    createdAt: computation.createdAt,
    selectedNodeIds: computation.selectedNodeIds,
    mode:
      flags.dryRun
        ? "planned_only"
        : flags.execute
          ? "dispatched"
          : "planned_only",
    dependencies: computation.dependencies,
    warnings: computation.warnings,
    nodeIntents: computation.nodeIntents,
    dispatchResults,
    notes: [
      `Canonical registry: ${inventory.paths.canonicalPath}`,
      `Local overlay: ${inventory.paths.localPath ?? "(disabled)"}`,
      `Shared API key policy source: ${inventory.apiKeyPolicy.source}`,
      inventory.apiKeyPolicy.ignoredPerNodeApiKeys > 0
        ? `Ignored per-node API keys: ${inventory.apiKeyPolicy.ignoredPerNodeApiKeys}`
        : "Ignored per-node API keys: 0",
      flags.execute && !flags.dryRun
        ? `Dispatch timeout: ${flags.timeoutMs}ms`
        : "Dispatch not requested",
    ],
  };

  if (!flags.json) {
    console.log(`Apply plan created for ${target}/${id}`);
    console.log(`Nodes: ${computation.selectedNodeIds.length}`);
    if (flags.execute && !flags.dryRun) {
      const ok = dispatchResults?.filter((result) => result.ok).length ?? 0;
      const total = dispatchResults?.length ?? 0;
      console.log(`Dispatch: ${ok}/${total} nodes ok`);
    } else {
      console.log("Dispatch not requested; showing plan only.");
    }
    console.log("");
  }

  printOutput(payload, flags.json);
}

type ImportCommonOptions = {
  configRoot: string;
  playlistId: string;
  playlistTitle?: string;
  tag?: string;
  cache: boolean;
  write: boolean;
  channelId?: string;
  channelName?: string;
  channelNumber?: string;
};

type ImportDirOptions = ImportCommonOptions & {
  sourceDir: string;
  playlistTitle: string;
};

type EdenDb = "PROD" | "STAGE";

type ImportEdenCollectionOptions = ImportCommonOptions & {
  collectionInput: string;
  collectionId: string;
  db: EdenDb;
  edenApiKey?: string;
  artist?: string;
  maxItems?: number;
};

type ImportMediaPlanItem = {
  id: string;
  title: string;
  filePath: string;
  sourceType: "path" | "url";
  sourceValue: string;
  kind?: "image" | "video" | "audio" | "unknown";
  artist?: string;
};

const IMPORT_MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

function tomlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function titleFromFileName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  return base.replace(/[_-]+/g, " ").trim() || base;
}

function hash10(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function toTitleCaseFromId(id: string): string {
  const tail = id.startsWith("pl-") ? id.slice(3) : id;
  return tail.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEdenDb(value: string): EdenDb {
  const normalized = value.trim().toUpperCase();
  if (normalized === "PROD") return "PROD";
  if (normalized === "STAGE") return "STAGE";
  throw new Error(`Invalid --db value: ${value}. Expected PROD or STAGE.`);
}

function parseEdenCollectionReference(
  value: string,
  dbOverride?: EdenDb
): { collectionId: string; db: EdenDb } {
  const input = value.trim();
  if (!input) throw new Error("Missing Eden collection URL or ID.");

  if (/^https?:\/\//i.test(input)) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error(`Invalid URL: ${input}`);
    }

    const host = parsed.hostname.toLowerCase();
    if (!host.includes("eden.art")) {
      throw new Error(`Not an Eden URL: ${input}`);
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((part) => {
      const lower = part.toLowerCase();
      return lower === "collection" || lower === "collections";
    });
    const collectionId = idx >= 0 ? parts[idx + 1] : "";
    if (!collectionId) {
      throw new Error(`Could not parse collection ID from URL: ${input}`);
    }
    const dbFromHost: EdenDb = host.includes("staging") ? "STAGE" : "PROD";
    return { collectionId, db: dbOverride ?? dbFromHost };
  }

  const collectionId = input.replace(/^collections?\//i, "").trim();
  if (!collectionId || collectionId.includes("/")) {
    throw new Error(`Invalid collection ID: ${value}`);
  }
  return { collectionId, db: dbOverride ?? "PROD" };
}

function cleanInlineText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function inferRemoteMediaKind(args: {
  url: string;
  mimeType?: string;
}): "image" | "video" | "audio" | "unknown" | undefined {
  const mimeType = args.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  let pathname = "";
  try {
    pathname = new URL(args.url).pathname.toLowerCase();
  } catch {
    pathname = args.url.toLowerCase();
  }
  if (/\.(jpg|jpeg|png|gif|webp|avif|bmp)(\?|$)/i.test(pathname)) return "image";
  if (/\.(mp4|mov|m4v|webm|mkv|avi)(\?|$)/i.test(pathname)) return "video";
  if (/\.(mp3|wav|aac|ogg|flac|m4a)(\?|$)/i.test(pathname)) return "audio";
  return undefined;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency)));
  const output = new Array<U>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      output[index] = await mapper(items[index] as T, index);
    }
  });

  await Promise.all(workers);
  return output;
}

const EDEN_API_BASE: Record<EdenDb, string> = {
  PROD: "https://api.eden.art",
  STAGE: "https://staging.api.eden.art",
};

type EdenCollection = {
  id: string;
  name: string;
  description?: string;
  author?: string;
};

type EdenCreation = {
  id: string;
  url: string;
  title?: string;
  filename?: string;
  author?: string;
  mimeType?: string;
};

async function edenApiGetJson(args: {
  db: EdenDb;
  apiKey: string;
  endpointPath: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const base = EDEN_API_BASE[args.db];
  const endpoint = args.endpointPath.startsWith("/")
    ? args.endpointPath
    : `/${args.endpointPath}`;
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? 12_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const response = await fetch(`${base}${endpoint}`, {
        headers: {
          "x-api-key": args.apiKey,
          accept: "application/json",
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const body = text.slice(0, 400);
        throw new Error(`Eden API ${response.status} for ${endpoint}: ${body}`);
      }
      try {
        return text ? (JSON.parse(text) as unknown) : null;
      } catch {
        throw new Error(`Eden API returned invalid JSON for ${endpoint}`);
      }
    } catch (error) {
      const message = (error as Error).message;
      if ((error as Error).name === "AbortError") {
        throw new Error(`Eden API request timeout for ${endpoint}`);
      }
      throw new Error(`Eden API request failed for ${endpoint}: ${message}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseEdenCollection(raw: unknown, fallbackId?: string): EdenCollection | null {
  const root = recordOrNull(raw);
  if (!root) return null;
  const candidates: Record<string, unknown>[] = [];
  const pushCandidate = (value: unknown) => {
    const rec = recordOrNull(value);
    if (!rec) return;
    candidates.push(rec);
  };

  pushCandidate(root);
  pushCandidate(root.collection);
  pushCandidate(root.data);
  pushCandidate(root.doc);
  pushCandidate(root.result);
  pushCandidate(root.item);
  pushCandidate(root.payload);
  const dataObj = recordOrNull(root.data);
  if (dataObj) {
    pushCandidate(dataObj.collection);
    pushCandidate(dataObj.item);
    pushCandidate(dataObj.doc);
  }

  for (const data of candidates) {
    const id = stringOrNull(data._id) ?? stringOrNull(data.id) ?? fallbackId ?? null;
    const name =
      cleanInlineText(
        stringOrNull(data.name) ??
          stringOrNull(data.title) ??
          stringOrNull(recordOrNull(data.metadata)?.name) ??
          undefined
      ) ??
      id;
    if (!id || !name) continue;
    const description =
      cleanInlineText(
        stringOrNull(data.description) ??
          stringOrNull(recordOrNull(data.metadata)?.description) ??
          undefined
      ) ?? undefined;
    const user = recordOrNull(data.user);
    const author =
      cleanInlineText(
        stringOrNull(user?.username) ??
          stringOrNull(user?.name) ??
          stringOrNull(data.author) ??
          undefined
      ) ?? undefined;
    const out: EdenCollection = { id, name };
    if (description !== undefined) out.description = description;
    if (author !== undefined) out.author = author;
    return out;
  }
  return null;
}

function parseEdenCreation(raw: unknown): EdenCreation | null {
  const wrapper = recordOrNull(raw);
  if (!wrapper) return null;
  const candidates: Record<string, unknown>[] = [];
  const pushCandidate = (value: unknown) => {
    const rec = recordOrNull(value);
    if (!rec) return;
    candidates.push(rec);
  };

  pushCandidate(wrapper);
  pushCandidate(wrapper.creation);
  pushCandidate(wrapper.data);
  pushCandidate(wrapper.item);
  pushCandidate(wrapper.doc);
  const dataObj = recordOrNull(wrapper.data);
  if (dataObj) {
    pushCandidate(dataObj.creation);
    pushCandidate(dataObj.item);
  }

  for (const data of candidates) {
    const id = stringOrNull(data._id) ?? stringOrNull(data.id);
    const mediaAttributes = recordOrNull(data.mediaAttributes);
    const url =
      stringOrNull(data.url) ??
      stringOrNull(recordOrNull(data.media)?.url) ??
      stringOrNull(recordOrNull(data.asset)?.url);
    if (!id || !url) continue;

    const user = recordOrNull(data.user);
    const out: EdenCreation = {
      id,
      url,
    };
    const title =
      cleanInlineText(
        stringOrNull(data.name) ??
          stringOrNull(data.title) ??
          stringOrNull(data.filename) ??
          undefined
      ) ?? undefined;
    const filename = cleanInlineText(stringOrNull(data.filename) ?? undefined) ?? undefined;
    const author =
      cleanInlineText(
        stringOrNull(user?.username) ?? stringOrNull(user?.name) ?? undefined
      ) ?? undefined;
    const mimeType = cleanInlineText(stringOrNull(mediaAttributes?.mimeType) ?? undefined) ?? undefined;
    if (title !== undefined) out.title = title;
    if (filename !== undefined) out.filename = filename;
    if (author !== undefined) out.author = author;
    if (mimeType !== undefined) out.mimeType = mimeType;
    return out;
  }
  return null;
}

function hasNextPageInEdenPayload(raw: Record<string, unknown>): boolean {
  if (raw.hasNextPage === true || raw.has_more === true || raw.hasMore === true) {
    return true;
  }
  const page = typeof raw.page === "number" ? raw.page : Number(raw.page);
  const totalPages =
    typeof raw.totalPages === "number"
      ? raw.totalPages
      : typeof raw.pages === "number"
        ? raw.pages
        : Number(raw.totalPages ?? raw.pages);
  if (Number.isFinite(page) && Number.isFinite(totalPages) && page < totalPages) {
    return true;
  }
  const nextPage =
    typeof raw.nextPage === "number"
      ? raw.nextPage
      : Number(raw.nextPage);
  return Number.isFinite(nextPage) && nextPage > 0;
}

function extractCreationId(row: unknown): string | null {
  const direct = stringOrNull(row);
  if (direct) return direct;
  const record = recordOrNull(row);
  if (!record) return null;
  return stringOrNull(record._id) ?? stringOrNull(record.id);
}

async function fetchEdenCollectionData(args: {
  collectionId: string;
  db: EdenDb;
  apiKey: string;
}): Promise<{
  collection: EdenCollection;
  creationIds: string[];
  creations: EdenCreation[];
  missingCreationIds: string[];
}> {
  const collectionRaw = await edenApiGetJson({
    db: args.db,
    apiKey: args.apiKey,
    endpointPath: `/v2/collections/${args.collectionId}`,
  });
  const collection = parseEdenCollection(collectionRaw, args.collectionId);
  if (!collection) {
    const root = recordOrNull(collectionRaw);
    const rootKeys = root ? Object.keys(root).slice(0, 16).join(",") : typeof collectionRaw;
    throw new Error(
      `Could not parse Eden collection payload for ${args.collectionId} (shape=${rootKeys || "unknown"})`
    );
  }

  const creationIds: string[] = [];
  let page = 1;
  while (true) {
    const pageRaw = await edenApiGetJson({
      db: args.db,
      apiKey: args.apiKey,
      endpointPath: `/v2/collections/${args.collectionId}/creations?page=${page}&limit=100`,
    });
    const pageObj = recordOrNull(pageRaw);
    const docs = Array.isArray(pageObj?.docs)
      ? pageObj.docs
      : Array.isArray(pageObj?.items)
        ? pageObj.items
        : Array.isArray(recordOrNull(pageObj?.data)?.docs)
          ? (recordOrNull(pageObj?.data)?.docs as unknown[])
          : Array.isArray(recordOrNull(pageObj?.data)?.items)
            ? (recordOrNull(pageObj?.data)?.items as unknown[])
            : Array.isArray(pageRaw)
              ? pageRaw
              : [];
    for (const doc of docs) {
      const id = extractCreationId(doc);
      if (id) creationIds.push(id);
    }
    const hasNextPage = pageObj ? hasNextPageInEdenPayload(pageObj) : false;
    if (!hasNextPage) break;
    page += 1;
    if (page > 2000) {
      throw new Error("Eden collection pagination exceeded hard limit (2000 pages).");
    }
  }

  const uniqueIds = Array.from(new Set(creationIds));
  const results = await mapWithConcurrency(uniqueIds, 6, async (creationId) => {
    try {
      const raw = await edenApiGetJson({
        db: args.db,
        apiKey: args.apiKey,
        endpointPath: `/v2/creations/${creationId}`,
      });
      return parseEdenCreation(raw);
    } catch {
      return null;
    }
  });

  const creations: EdenCreation[] = [];
  const missingCreationIds: string[] = [];
  for (let i = 0; i < uniqueIds.length; i += 1) {
    const parsed = results[i];
    if (parsed) {
      creations.push(parsed);
    } else {
      missingCreationIds.push(uniqueIds[i] as string);
    }
  }

  return {
    collection,
    creationIds: uniqueIds,
    creations,
    missingCreationIds,
  };
}

function normalizePlaylistId(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error("Missing --playlist-id");
  return s.startsWith("pl-") ? s : `pl-${slugify(s)}`;
}

function normalizeBlockIdFromPlaylist(playlistId: string): string {
  const tail = playlistId.startsWith("pl-") ? playlistId.slice(3) : playlistId;
  return `blk-${tail}`;
}

function parseImportDirOptions(rest: string[]): ImportDirOptions {
  if ((rest[0] ?? "") !== "dir") {
    throw new Error("import supports: chiba import dir <path> ...");
  }
  const sourceDirRaw = rest[1];
  if (!sourceDirRaw) {
    throw new Error("Missing source directory: chiba import dir <path> ...");
  }

  let configRoot = "cable2/config";
  let playlistId = "";
  let playlistTitle = "";
  let tag: string | undefined;
  let cache = true;
  let write = false;
  let channelId: string | undefined;
  let channelName: string | undefined;
  let channelNumber: string | undefined;

  for (let i = 2; i < rest.length; i += 1) {
    const arg = rest[i] ?? "";
    const next = rest[i + 1] ?? "";
    if (arg === "--playlist-id") {
      playlistId = normalizePlaylistId(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--playlist-id=")) {
      playlistId = normalizePlaylistId(arg.slice("--playlist-id=".length));
      continue;
    }
    if (arg === "--playlist-title") {
      playlistTitle = next.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--playlist-title=")) {
      playlistTitle = arg.slice("--playlist-title=".length).trim();
      continue;
    }
    if (arg === "--tag") {
      tag = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--tag=")) {
      tag = arg.slice("--tag=".length).trim() || undefined;
      continue;
    }
    if (arg === "--config-root") {
      configRoot = next.trim() || configRoot;
      i += 1;
      continue;
    }
    if (arg.startsWith("--config-root=")) {
      configRoot = arg.slice("--config-root=".length).trim() || configRoot;
      continue;
    }
    if (arg === "--cache") {
      cache = true;
      continue;
    }
    if (arg === "--no-cache") {
      cache = false;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--channel-id") {
      const raw = next.trim();
      channelId = raw ? slugify(raw) : undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--channel-id=")) {
      const raw = arg.slice("--channel-id=".length).trim();
      channelId = raw ? slugify(raw) : undefined;
      continue;
    }
    if (arg === "--channel-name") {
      channelName = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--channel-name=")) {
      channelName = arg.slice("--channel-name=".length).trim() || undefined;
      continue;
    }
    if (arg === "--channel-number") {
      channelNumber = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--channel-number=")) {
      channelNumber = arg.slice("--channel-number=".length).trim() || undefined;
      continue;
    }
  }

  if (!playlistId) {
    throw new Error("Missing --playlist-id (example: --playlist-id pl-co-lab)");
  }
  if (!playlistTitle) {
    playlistTitle = toTitleCaseFromId(playlistId);
  }

  const parsed: ImportDirOptions = {
    sourceDir: sourceDirRaw,
    configRoot,
    playlistId,
    playlistTitle,
    cache,
    write,
  };
  if (tag !== undefined) parsed.tag = tag;
  if (channelId !== undefined) parsed.channelId = channelId;
  if (channelName !== undefined) parsed.channelName = channelName;
  if (channelNumber !== undefined) parsed.channelNumber = channelNumber;
  return parsed;
}

function parseImportEdenCollectionOptions(rest: string[]): ImportEdenCollectionOptions {
  const subcommand = (rest[0] ?? "").trim().toLowerCase();
  if (subcommand !== "eden-collection" && subcommand !== "eden") {
    throw new Error(
      "import supports: chiba import eden-collection <url-or-id> ..."
    );
  }

  const collectionInput = (rest[1] ?? "").trim();
  if (!collectionInput) {
    throw new Error(
      "Missing collection URL/ID: chiba import eden-collection <url-or-id> ..."
    );
  }

  let configRoot = "cable2/config";
  let playlistId = "";
  let playlistTitle: string | undefined;
  let tag: string | undefined;
  let cache = true;
  let write = false;
  let channelId: string | undefined;
  let channelName: string | undefined;
  let channelNumber: string | undefined;
  let dbOverride: EdenDb | undefined;
  let edenApiKey: string | undefined;
  let artist: string | undefined;
  let maxItems: number | undefined;

  for (let i = 2; i < rest.length; i += 1) {
    const arg = rest[i] ?? "";
    const next = rest[i + 1] ?? "";

    if (arg === "--playlist-id") {
      playlistId = normalizePlaylistId(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--playlist-id=")) {
      playlistId = normalizePlaylistId(arg.slice("--playlist-id=".length));
      continue;
    }
    if (arg === "--playlist-title") {
      playlistTitle = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--playlist-title=")) {
      playlistTitle = arg.slice("--playlist-title=".length).trim() || undefined;
      continue;
    }
    if (arg === "--tag") {
      tag = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--tag=")) {
      tag = arg.slice("--tag=".length).trim() || undefined;
      continue;
    }
    if (arg === "--config-root") {
      configRoot = next.trim() || configRoot;
      i += 1;
      continue;
    }
    if (arg.startsWith("--config-root=")) {
      configRoot = arg.slice("--config-root=".length).trim() || configRoot;
      continue;
    }
    if (arg === "--cache") {
      cache = true;
      continue;
    }
    if (arg === "--no-cache") {
      cache = false;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--channel-id") {
      const raw = next.trim();
      channelId = raw ? slugify(raw) : undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--channel-id=")) {
      const raw = arg.slice("--channel-id=".length).trim();
      channelId = raw ? slugify(raw) : undefined;
      continue;
    }
    if (arg === "--channel-name") {
      channelName = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--channel-name=")) {
      channelName = arg.slice("--channel-name=".length).trim() || undefined;
      continue;
    }
    if (arg === "--channel-number") {
      channelNumber = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--channel-number=")) {
      channelNumber = arg.slice("--channel-number=".length).trim() || undefined;
      continue;
    }
    if (arg === "--db") {
      dbOverride = parseEdenDb(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbOverride = parseEdenDb(arg.slice("--db=".length));
      continue;
    }
    if (arg === "--eden-api-key") {
      edenApiKey = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--eden-api-key=")) {
      edenApiKey = arg.slice("--eden-api-key=".length).trim() || undefined;
      continue;
    }
    if (arg === "--artist") {
      artist = next.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--artist=")) {
      artist = arg.slice("--artist=".length).trim() || undefined;
      continue;
    }
    if (arg === "--max-items") {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        maxItems = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-items=")) {
      const parsed = Number(arg.slice("--max-items=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        maxItems = Math.floor(parsed);
      }
      continue;
    }
  }

  if (!playlistId) {
    throw new Error(
      "Missing --playlist-id (example: --playlist-id pl-scanalyzer-daily-digest)"
    );
  }

  const ref = parseEdenCollectionReference(collectionInput, dbOverride);
  const parsed: ImportEdenCollectionOptions = {
    collectionInput,
    collectionId: ref.collectionId,
    db: ref.db,
    configRoot,
    playlistId,
    cache,
    write,
  };
  if (playlistTitle !== undefined) parsed.playlistTitle = playlistTitle;
  if (tag !== undefined) parsed.tag = tag;
  if (channelId !== undefined) parsed.channelId = channelId;
  if (channelName !== undefined) parsed.channelName = channelName;
  if (channelNumber !== undefined) parsed.channelNumber = channelNumber;
  if (edenApiKey !== undefined) parsed.edenApiKey = edenApiKey;
  if (artist !== undefined) parsed.artist = artist;
  if (maxItems !== undefined) parsed.maxItems = maxItems;
  return parsed;
}

function buildMediaToml(args: {
  id: string;
  title: string;
  sourceType: "path" | "url";
  sourceValue: string;
  cache: boolean;
  kind?: "image" | "video" | "audio" | "unknown";
  tag?: string;
  artist?: string;
}): string {
  const lines: string[] = [
    `id = ${tomlQuote(args.id)}`,
    `title = ${tomlQuote(args.title)}`,
  ];
  if (args.kind) lines.push(`kind = ${tomlQuote(args.kind)}`);
  if (args.tag) lines.push(`tag = ${tomlQuote(args.tag)}`);
  if (args.artist) lines.push(`artist = ${tomlQuote(args.artist)}`);
  lines.push("");
  lines.push("[source]");
  lines.push(`type = ${tomlQuote(args.sourceType)}`);
  lines.push(`value = ${tomlQuote(args.sourceValue)}`);
  if (args.cache) lines.push("cache = true");
  lines.push("");
  return lines.join("\n");
}

function buildPlaylistToml(args: {
  id: string;
  title: string;
  items: Array<{ mediaId: string; title: string }>;
  tag?: string;
}): string {
  const lines: string[] = [
    `id = ${tomlQuote(args.id)}`,
    `name = ${tomlQuote(args.title)}`,
    "",
  ];
  for (const item of args.items) {
    lines.push("[[item]]");
    lines.push(`media = ${tomlQuote(item.mediaId)}`);
    lines.push("duration_slots = 1");
    lines.push(`title = ${tomlQuote(item.title)}`);
    if (args.tag) lines.push(`tag = ${tomlQuote(args.tag)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildBlockToml(args: { blockId: string; playlistId: string }): string {
  return [
    `id = ${tomlQuote(args.blockId)}`,
    'mode = "loop"',
    `playlist = ${tomlQuote(args.playlistId)}`,
    "",
  ].join("\n");
}

function buildChannelToml(args: {
  channelId: string;
  channelName: string;
  channelNumber?: string;
  blockId: string;
  tag?: string;
}): string {
  const callSign =
    args.tag && args.tag.trim().length > 0
      ? args.tag.trim().toUpperCase()
      : args.channelId.replace(/[^a-zA-Z0-9]+/g, "").toUpperCase().slice(0, 6);
  const lines: string[] = [
    `id = ${tomlQuote(args.channelId)}`,
  ];
  if (args.channelNumber) lines.push(`number = ${tomlQuote(args.channelNumber)}`);
  lines.push(`name = ${tomlQuote(args.channelName)}`);
  lines.push(`call_sign = ${tomlQuote(callSign)}`);
  lines.push(`blocks = [ ${tomlQuote(args.blockId)} ]`);
  lines.push("");
  return lines.join("\n");
}

async function cmdImportDir(
  rest: string[],
  flags: Flags,
  cmdOpts: { emitOutput?: boolean } = {}
): Promise<unknown> {
  const emitOutput = cmdOpts.emitOutput ?? true;
  const options = parseImportDirOptions(rest);
  const repoRoot = process.cwd();
  const sourceDir = path.resolve(repoRoot, options.sourceDir);
  const configRoot = path.resolve(repoRoot, options.configRoot);
  const mediaDir = path.join(configRoot, "media");
  const playlistsDir = path.join(configRoot, "playlists");
  const blocksDir = path.join(configRoot, "blocks");
  const channelsDir = path.join(configRoot, "channels");

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => IMPORT_MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  if (files.length === 0) {
    throw new Error(`No media files found in ${sourceDir}`);
  }

  const mediaPlan = files.map((fileName) => {
    const sourcePath = path.join(sourceDir, fileName);
    const title = titleFromFileName(fileName);
    const slug = slugify(title) || slugify(fileName) || "media";
    const id = `m-${slug}-${hash10(sourcePath)}`;
    const filePath = path.join(mediaDir, `${id}.toml`);
    return { fileName, sourcePath, title, id, filePath };
  });

  const playlistFilePath = path.join(playlistsDir, `${options.playlistId}.toml`);
  const blockId = normalizeBlockIdFromPlaylist(options.playlistId);
  const blockFilePath = path.join(blocksDir, `${blockId}.toml`);
  const channelId = options.channelId;
  const channelName =
    options.channelName ??
    (channelId
      ? channelId.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
      : undefined);
  const channelFilePath = channelId ? path.join(channelsDir, `${channelId}.toml`) : null;

  const payload = {
    ok: true,
    sourceDir,
    configRoot,
    write: options.write,
    playlist: {
      id: options.playlistId,
      title: options.playlistTitle,
      filePath: playlistFilePath,
      itemCount: mediaPlan.length,
    },
    media: mediaPlan.map((item) => ({
      id: item.id,
      title: item.title,
      sourcePath: item.sourcePath,
      filePath: item.filePath,
    })),
    channel:
      channelId && channelFilePath
        ? {
            id: channelId,
            name: channelName,
            number: options.channelNumber,
            blockId,
            blockFilePath,
            channelFilePath,
          }
        : null,
  };

  if (!options.write) {
    if (emitOutput) printOutput(payload, true);
    if (emitOutput && !flags.json) {
      console.log("\nDry-run only. Re-run with --write to persist TOML files.");
    }
    return payload;
  }

  await Promise.all([
    fs.mkdir(mediaDir, { recursive: true }),
    fs.mkdir(playlistsDir, { recursive: true }),
    channelId ? fs.mkdir(blocksDir, { recursive: true }) : Promise.resolve(),
    channelId ? fs.mkdir(channelsDir, { recursive: true }) : Promise.resolve(),
  ]);

  for (const item of mediaPlan) {
    const mediaArgs: {
      id: string;
      title: string;
      sourceType: "path" | "url";
      sourceValue: string;
      cache: boolean;
      kind?: "image" | "video" | "audio" | "unknown";
      tag?: string;
      artist?: string;
    } = {
      id: item.id,
      title: item.title,
      sourceType: "path",
      sourceValue: item.sourcePath,
      cache: options.cache,
    };
    if (options.tag !== undefined) mediaArgs.tag = options.tag;
    const content = buildMediaToml(mediaArgs);
    await fs.writeFile(item.filePath, content, "utf-8");
  }

  const playlistArgs: {
    id: string;
    title: string;
    items: Array<{ mediaId: string; title: string }>;
    tag?: string;
  } = {
    id: options.playlistId,
    title: options.playlistTitle,
    items: mediaPlan.map((item) => ({ mediaId: item.id, title: item.title })),
  };
  if (options.tag !== undefined) playlistArgs.tag = options.tag;
  const playlistToml = buildPlaylistToml(playlistArgs);
  await fs.writeFile(playlistFilePath, playlistToml, "utf-8");

  if (channelId && channelFilePath && channelName) {
    await fs.writeFile(
      blockFilePath,
      buildBlockToml({ blockId, playlistId: options.playlistId }),
      "utf-8"
    );
    const channelArgs: {
      channelId: string;
      channelName: string;
      channelNumber?: string;
      blockId: string;
      tag?: string;
    } = {
      channelId,
      channelName,
      blockId,
    };
    if (options.channelNumber !== undefined) channelArgs.channelNumber = options.channelNumber;
    if (options.tag !== undefined) channelArgs.tag = options.tag;
    await fs.writeFile(channelFilePath, buildChannelToml(channelArgs), "utf-8");
  }

  if (emitOutput) printOutput(payload, true);
  return payload;
}

async function cmdImportEdenCollection(
  rest: string[],
  flags: Flags,
  cmdOpts: { emitOutput?: boolean } = {}
): Promise<unknown> {
  const emitOutput = cmdOpts.emitOutput ?? true;
  const options = parseImportEdenCollectionOptions(rest);
  const apiKey = (
    options.edenApiKey ??
    process.env.EDEN_API_KEY ??
    process.env.CHIBA_EDEN_API_KEY ??
    process.env.CHIBA_EDEN_KEY ??
    ""
  ).trim();
  if (!apiKey) {
    throw new Error("Missing Eden API key. Set EDEN_API_KEY or pass --eden-api-key.");
  }

  const repoRoot = process.cwd();
  const configRoot = path.resolve(repoRoot, options.configRoot);
  const mediaDir = path.join(configRoot, "media");
  const playlistsDir = path.join(configRoot, "playlists");
  const blocksDir = path.join(configRoot, "blocks");
  const channelsDir = path.join(configRoot, "channels");

  const eden = await fetchEdenCollectionData({
    collectionId: options.collectionId,
    db: options.db,
    apiKey,
  });

  const playlistTitle =
    options.playlistTitle ??
    cleanInlineText(eden.collection.name) ??
    toTitleCaseFromId(options.playlistId);

  const withUrl = eden.creations.filter(
    (creation) => stringOrNull(creation.url) !== null
  );
  const limited =
    typeof options.maxItems === "number" && options.maxItems > 0
      ? withUrl.slice(0, options.maxItems)
      : withUrl;

  const mediaPlan: ImportMediaPlanItem[] = [];
  const seenMediaIds = new Set<string>();
  let skippedDuplicates = 0;

  for (const creation of limited) {
    const idKey = creation.id.toLowerCase().replace(/[^a-z0-9]/g, "");
    const mediaId = idKey ? `m-eden-${idKey}` : `m-eden-${hash10(creation.url)}`;
    if (seenMediaIds.has(mediaId)) {
      skippedDuplicates += 1;
      continue;
    }
    seenMediaIds.add(mediaId);

    const title =
      cleanInlineText(
        creation.title ??
          creation.filename ??
          `Eden ${creation.id.slice(0, 8)}`
      ) ?? `Eden ${creation.id.slice(0, 8)}`;
    const artist =
      options.artist ??
      cleanInlineText(creation.author) ??
      cleanInlineText(eden.collection.author) ??
      undefined;
    const kind = inferRemoteMediaKind(
      creation.mimeType !== undefined
        ? { url: creation.url, mimeType: creation.mimeType }
        : { url: creation.url }
    );
    const planned: ImportMediaPlanItem = {
      id: mediaId,
      title,
      filePath: path.join(mediaDir, `${mediaId}.toml`),
      sourceType: "url",
      sourceValue: creation.url,
    };
    if (kind !== undefined) planned.kind = kind;
    if (artist !== undefined) planned.artist = artist;
    mediaPlan.push(planned);
  }

  if (mediaPlan.length === 0) {
    throw new Error(
      `No importable creations with URL found for Eden collection ${options.collectionId}.`
    );
  }

  const playlistFilePath = path.join(playlistsDir, `${options.playlistId}.toml`);
  const blockId = normalizeBlockIdFromPlaylist(options.playlistId);
  const blockFilePath = path.join(blocksDir, `${blockId}.toml`);
  const channelId = options.channelId;
  const channelName =
    options.channelName ??
    (channelId
      ? channelId.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
      : undefined);
  const channelFilePath = channelId ? path.join(channelsDir, `${channelId}.toml`) : null;

  const payload = {
    ok: true,
    source: "eden-collection",
    collection: {
      input: options.collectionInput,
      id: eden.collection.id,
      name: eden.collection.name,
      db: options.db,
      totalCreationIds: eden.creationIds.length,
      fetchedCreations: eden.creations.length,
      missingCreations: eden.missingCreationIds.length,
      importedMedia: mediaPlan.length,
      skippedDuplicates,
    },
    configRoot,
    write: options.write,
    playlist: {
      id: options.playlistId,
      title: playlistTitle,
      filePath: playlistFilePath,
      itemCount: mediaPlan.length,
    },
    media: mediaPlan.map((item) => ({
      id: item.id,
      title: item.title,
      sourceType: item.sourceType,
      sourceValue: item.sourceValue,
      kind: item.kind,
      artist: item.artist,
      filePath: item.filePath,
    })),
    channel:
      channelId && channelFilePath
        ? {
            id: channelId,
            name: channelName,
            number: options.channelNumber,
            blockId,
            blockFilePath,
            channelFilePath,
          }
        : null,
  };

  if (!options.write) {
    if (emitOutput) printOutput(payload, true);
    if (emitOutput && !flags.json) {
      console.log("\nDry-run only. Re-run with --write to persist TOML files.");
    }
    return payload;
  }

  await Promise.all([
    fs.mkdir(mediaDir, { recursive: true }),
    fs.mkdir(playlistsDir, { recursive: true }),
    channelId ? fs.mkdir(blocksDir, { recursive: true }) : Promise.resolve(),
    channelId ? fs.mkdir(channelsDir, { recursive: true }) : Promise.resolve(),
  ]);

  for (const item of mediaPlan) {
    const mediaArgs: {
      id: string;
      title: string;
      sourceType: "path" | "url";
      sourceValue: string;
      cache: boolean;
      kind?: "image" | "video" | "audio" | "unknown";
      tag?: string;
      artist?: string;
    } = {
      id: item.id,
      title: item.title,
      sourceType: item.sourceType,
      sourceValue: item.sourceValue,
      cache: options.cache,
    };
    if (item.kind !== undefined) mediaArgs.kind = item.kind;
    if (options.tag !== undefined) mediaArgs.tag = options.tag;
    if (item.artist !== undefined) mediaArgs.artist = item.artist;
    const content = buildMediaToml(mediaArgs);
    await fs.writeFile(item.filePath, content, "utf-8");
  }

  const playlistArgs: {
    id: string;
    title: string;
    items: Array<{ mediaId: string; title: string }>;
    tag?: string;
  } = {
    id: options.playlistId,
    title: playlistTitle,
    items: mediaPlan.map((item) => ({ mediaId: item.id, title: item.title })),
  };
  if (options.tag !== undefined) playlistArgs.tag = options.tag;
  const playlistToml = buildPlaylistToml(playlistArgs);
  await fs.writeFile(playlistFilePath, playlistToml, "utf-8");

  if (channelId && channelFilePath && channelName) {
    await fs.writeFile(
      blockFilePath,
      buildBlockToml({ blockId, playlistId: options.playlistId }),
      "utf-8"
    );
    const channelArgs: {
      channelId: string;
      channelName: string;
      channelNumber?: string;
      blockId: string;
      tag?: string;
    } = {
      channelId,
      channelName,
      blockId,
    };
    if (options.channelNumber !== undefined) channelArgs.channelNumber = options.channelNumber;
    if (options.tag !== undefined) channelArgs.tag = options.tag;
    await fs.writeFile(channelFilePath, buildChannelToml(channelArgs), "utf-8");
  }

  if (emitOutput) printOutput(payload, true);
  return payload;
}

async function cmdImport(rest: string[], flags: Flags): Promise<void> {
  const kind = (rest[0] ?? "").trim().toLowerCase();
  if (kind === "dir") {
    await cmdImportDir(rest, flags);
    return;
  }
  if (kind === "eden-collection" || kind === "eden") {
    await cmdImportEdenCollection(rest, flags);
    return;
  }
  throw new Error(
    "import supports: chiba import dir <path> ... | chiba import eden-collection <url-or-id> ..."
  );
}

type PrepareProfileOptions = {
  profileId: string;
  write: boolean;
  continueOnError: boolean;
};

const UNDER_CONSTRUCTION_MEDIA_ID = "m-under-construction-stryve";
const UNDER_CONSTRUCTION_PLAYLIST_ID = "pl-under-construction";
const UNDER_CONSTRUCTION_ASSET_FILE =
  "How to make a fly 90s website A GeoCities tribute  Stryve.gif";
const UNDER_CONSTRUCTION_ASSET_URL = `http://localhost:8787/assets-local/${encodeURIComponent(
  UNDER_CONSTRUCTION_ASSET_FILE
)}`;

function parsePrepareProfileOptions(rest: string[]): PrepareProfileOptions {
  if ((rest[0] ?? "") !== "profile") {
    throw new Error("prepare supports: chiba prepare profile <id> [--write]");
  }
  const profileId = (rest[1] ?? "").trim();
  if (!profileId) {
    throw new Error("Missing profile id: chiba prepare profile <id> [--write]");
  }

  let write = false;
  let continueOnError = false;
  for (let i = 2; i < rest.length; i += 1) {
    const arg = (rest[i] ?? "").trim();
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--continue-on-error") {
      continueOnError = true;
      continue;
    }
  }

  return { profileId, write, continueOnError };
}

function parseCompileProfileOptions(rest: string[]): PrepareProfileOptions {
  if ((rest[0] ?? "") !== "profile") {
    throw new Error("compile supports: chiba compile profile <id>");
  }
  const profileId = (rest[1] ?? "").trim();
  if (!profileId) {
    throw new Error("Missing profile id: chiba compile profile <id>");
  }

  let write = true;
  let continueOnError = true;
  for (let i = 2; i < rest.length; i += 1) {
    const arg = (rest[i] ?? "").trim();
    if (arg === "--no-write") {
      write = false;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--stop-on-error") {
      continueOnError = false;
      continue;
    }
    if (arg === "--continue-on-error") {
      continueOnError = true;
      continue;
    }
  }
  return { profileId, write, continueOnError };
}

function pushImportArg(parts: string[], flag: string, value: string | undefined): void {
  if (!value) return;
  parts.push(flag, value);
}

function mergeProfileModes(
  defaults: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined
): Record<string, unknown> {
  return { ...(defaults ?? {}), ...(override ?? {}) };
}

function collectProfilePlaylistTargetIds(profile: {
  defaults?: Record<string, unknown>;
  pis?: Record<string, Record<string, unknown>>;
}): string[] {
  const out = new Set<string>();
  const collectFromMode = (mode: Record<string, unknown> | undefined) => {
    if (!mode) return;
    const targetKind = typeof mode.target_kind === "string" ? mode.target_kind.trim() : "";
    const targetId = typeof mode.target_id === "string" ? mode.target_id.trim() : "";
    if (targetKind === "playlist" && targetId) out.add(targetId);
    const prefetchTargets = Array.isArray(mode.prefetch_targets) ? mode.prefetch_targets : [];
    for (const tokenRaw of prefetchTargets) {
      if (typeof tokenRaw !== "string") continue;
      const token = tokenRaw.trim();
      if (!token) continue;
      const idx = token.indexOf(":");
      if (idx <= 0) continue;
      const kind = token.slice(0, idx).trim().toLowerCase();
      const id = token.slice(idx + 1).trim();
      if (kind === "playlist" && id) out.add(id);
    }
  };

  collectFromMode(profile.defaults);
  const pis = profile.pis ?? {};
  for (const override of Object.values(pis)) {
    collectFromMode(mergeProfileModes(profile.defaults, override));
  }
  return Array.from(out).sort();
}

function playlistHasPlayableContent(
  store: {
    playlistsById: Record<string, { items?: Array<{ media?: string; playlist?: string; source?: { value?: string } }> }>;
    mediaById: Record<string, { source?: { value?: string } }>;
  },
  playlistId: string,
  visiting: Set<string> = new Set<string>()
): boolean {
  const id = String(playlistId ?? "").trim();
  if (!id) return false;
  if (visiting.has(id)) return false;
  const playlist = store.playlistsById[id];
  if (!playlist) return false;
  const items = Array.isArray(playlist.items) ? playlist.items : [];
  if (!items.length) return false;

  visiting.add(id);
  for (const item of items) {
    if (item?.source?.value && String(item.source.value).trim()) {
      visiting.delete(id);
      return true;
    }
    const mediaId = typeof item?.media === "string" ? item.media.trim() : "";
    if (mediaId) {
      const media = store.mediaById[mediaId];
      if (media?.source?.value && String(media.source.value).trim()) {
        visiting.delete(id);
        return true;
      }
    }
    const nestedPlaylist = typeof item?.playlist === "string" ? item.playlist.trim() : "";
    if (nestedPlaylist && playlistHasPlayableContent(store, nestedPlaylist, visiting)) {
      visiting.delete(id);
      return true;
    }
  }
  visiting.delete(id);
  return false;
}

async function ensureUnderConstructionArtifacts(args: {
  configRoot: string;
  write: boolean;
}): Promise<{
  missingCount: number;
  writes: number;
  actions: Array<Record<string, unknown>>;
}> {
  const actions: Array<Record<string, unknown>> = [];
  let missingCount = 0;
  let writes = 0;
  const mediaPath = path.join(args.configRoot, "media", `${UNDER_CONSTRUCTION_MEDIA_ID}.toml`);
  const playlistPath = path.join(args.configRoot, "playlists", `${UNDER_CONSTRUCTION_PLAYLIST_ID}.toml`);

  const mediaExists = await fs
    .access(mediaPath)
    .then(() => true)
    .catch(() => false);
  if (!mediaExists) {
    missingCount += 1;
  }
  if (args.write) {
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(
      mediaPath,
      buildMediaToml({
        id: UNDER_CONSTRUCTION_MEDIA_ID,
        title: "Under Construction",
        sourceType: "url",
        sourceValue: UNDER_CONSTRUCTION_ASSET_URL,
        cache: false,
        kind: "image",
        tag: "UNDER-CONSTRUCTION",
      }),
      "utf-8"
    );
    writes += 1;
    actions.push({
      kind: "media",
      id: UNDER_CONSTRUCTION_MEDIA_ID,
      action: mediaExists ? "updated" : "created",
    });
  } else if (!mediaExists) {
    actions.push({ kind: "media", id: UNDER_CONSTRUCTION_MEDIA_ID, action: "missing" });
  }

  const playlistExists = await fs
    .access(playlistPath)
    .then(() => true)
    .catch(() => false);
  if (!playlistExists) {
    missingCount += 1;
  }
  if (args.write) {
    await fs.mkdir(path.dirname(playlistPath), { recursive: true });
    await fs.writeFile(
      playlistPath,
      buildPlaylistToml({
        id: UNDER_CONSTRUCTION_PLAYLIST_ID,
        title: "Under Construction",
        items: [{ mediaId: UNDER_CONSTRUCTION_MEDIA_ID, title: "Under Construction" }],
        tag: "UNDER-CONSTRUCTION",
      }),
      "utf-8"
    );
    writes += 1;
    actions.push({
      kind: "playlist",
      id: UNDER_CONSTRUCTION_PLAYLIST_ID,
      action: playlistExists ? "updated" : "created",
    });
  } else if (!playlistExists) {
    actions.push({
      kind: "playlist",
      id: UNDER_CONSTRUCTION_PLAYLIST_ID,
      action: "missing",
    });
  }

  return { missingCount, writes, actions };
}

async function ensureProfileTargetFallbackPlaylists(args: {
  store: Awaited<ReturnType<typeof loadResourceStore>>;
  profileId: string;
  write: boolean;
}): Promise<{
  missingCount: number;
  writes: number;
  actions: Array<Record<string, unknown>>;
}> {
  const profile = args.store.profilesById[args.profileId];
  if (!profile) throw new Error(`Unknown profile id: ${args.profileId}`);

  const targetPlaylistIds = collectProfilePlaylistTargetIds(profile as any);
  let missingCount = 0;
  let writes = 0;
  const actions: Array<Record<string, unknown>> = [];

  for (const playlistId of targetPlaylistIds) {
    if (playlistId === UNDER_CONSTRUCTION_PLAYLIST_ID) continue;
    const playlist = args.store.playlistsById[playlistId];
    const playable = playlist ? playlistHasPlayableContent(args.store as any, playlistId) : false;
    if (playlist && playable) continue;

    missingCount += 1;
    const reason = playlist ? "no_playable_content" : "missing_playlist";
    actions.push({
      kind: "playlist",
      id: playlistId,
      reason,
      action: args.write ? "fallback_written" : "needs_fallback",
    });

    if (!args.write) continue;

    const fallbackPath = path.join(args.store.configRoot, "playlists", `${playlistId}.toml`);
    const fallbackTitle =
      (playlist?.title && playlist.title.trim()) ||
      `Fallback for ${playlistId}`;
    await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
    await fs.writeFile(
      fallbackPath,
      buildPlaylistToml({
        id: playlistId,
        title: fallbackTitle,
        items: [{ mediaId: UNDER_CONSTRUCTION_MEDIA_ID, title: "Under Construction" }],
        tag: "UNDER-CONSTRUCTION",
      }),
      "utf-8"
    );
    writes += 1;
  }

  return { missingCount, writes, actions };
}

async function runPrepareProfile(
  options: PrepareProfileOptions,
  flags: Flags,
  behavior: { allowStepFailures: boolean } = { allowStepFailures: false }
): Promise<void> {
  const store = await loadResourceStore();
  const profile = store.profilesById[options.profileId];
  if (!profile) {
    throw new Error(`Unknown profile id: ${options.profileId}`);
  }

  const prepareSteps = profile.prepare ?? [];
  const results: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  if (prepareSteps.length === 0) {
    notes.push("No [prepare] steps declared in profile.");
  }

  for (const [index, step] of prepareSteps.entries()) {
    const stepBase = {
      index,
      kind: step.kind,
    };
    try {
      if (step.kind === "dir") {
        const cmdRest = ["dir", step.path, "--playlist-id", step.playlist_id, "--config-root", store.configRoot];
        pushImportArg(cmdRest, "--playlist-title", step.playlist_title);
        pushImportArg(cmdRest, "--tag", step.tag);
        pushImportArg(cmdRest, "--channel-id", step.channel_id);
        pushImportArg(cmdRest, "--channel-name", step.channel_name);
        pushImportArg(cmdRest, "--channel-number", step.channel_number);
        if (step.cache === false) cmdRest.push("--no-cache");
        if (step.cache === true) cmdRest.push("--cache");
        if (options.write) cmdRest.push("--write");
        const importPayload = await cmdImportDir(cmdRest, flags, { emitOutput: false });
        results.push({
          ...stepBase,
          ok: true,
          target: {
            playlistId: step.playlist_id,
            channelId: step.channel_id ?? null,
          },
          import: importPayload,
        });
        continue;
      }

      if (step.kind === "eden_collection") {
        const cmdRest = [
          "eden-collection",
          step.source,
          "--playlist-id",
          step.playlist_id,
          "--config-root",
          store.configRoot,
        ];
        pushImportArg(cmdRest, "--playlist-title", step.playlist_title);
        pushImportArg(cmdRest, "--tag", step.tag);
        pushImportArg(cmdRest, "--db", step.db);
        pushImportArg(cmdRest, "--channel-id", step.channel_id);
        pushImportArg(cmdRest, "--channel-name", step.channel_name);
        pushImportArg(cmdRest, "--channel-number", step.channel_number);
        pushImportArg(cmdRest, "--artist", step.artist);
        if (typeof step.max_items === "number" && step.max_items > 0) {
          cmdRest.push("--max-items", String(step.max_items));
        }
        if (step.cache === false) cmdRest.push("--no-cache");
        if (step.cache === true) cmdRest.push("--cache");
        if (options.write) cmdRest.push("--write");
        const importPayload = await cmdImportEdenCollection(cmdRest, flags, { emitOutput: false });
        results.push({
          ...stepBase,
          ok: true,
          target: {
            playlistId: step.playlist_id,
            channelId: step.channel_id ?? null,
          },
          import: importPayload,
        });
        continue;
      }
    } catch (error) {
      results.push({
        ...stepBase,
        ok: false,
        error: (error as Error).message,
      });
      if (!options.continueOnError) {
        break;
      }
    }
  }

  let refreshed = await loadResourceStore({
    repoRoot: store.repoRoot,
    configRoot: store.configRoot,
  });
  const placeholder = await ensureUnderConstructionArtifacts({
    configRoot: refreshed.configRoot,
    write: options.write,
  });
  if (placeholder.writes > 0) {
    refreshed = await loadResourceStore({
      repoRoot: store.repoRoot,
      configRoot: store.configRoot,
    });
  }

  const fallbacks = await ensureProfileTargetFallbackPlaylists({
    store: refreshed,
    profileId: options.profileId,
    write: options.write,
  });
  if (fallbacks.writes > 0) {
    refreshed = await loadResourceStore({
      repoRoot: store.repoRoot,
      configRoot: store.configRoot,
    });
  }

  const failed = results.filter((row) => row.ok === false).length;
  const unresolvedAutofix = !options.write
    ? placeholder.missingCount + fallbacks.missingCount
    : 0;
  if (!options.write && unresolvedAutofix > 0) {
    notes.push(
      `Profile has ${unresolvedAutofix} unresolved dependencies. Re-run with --write (or use compile).`
    );
  }
  const runtimeReady = unresolvedAutofix === 0;
  const payload = {
    ok: behavior.allowStepFailures ? runtimeReady : failed === 0 && runtimeReady,
    profileId: options.profileId,
    write: options.write,
    continueOnError: options.continueOnError,
    stepsDeclared: prepareSteps.length,
    stepsExecuted: results.length,
    failed,
    unresolvedAutofix,
    runtimeReady,
    results,
    notes,
    autofix: {
      placeholder,
      targetFallbacks: fallbacks,
    },
  };
  printOutput(payload, true);
  const shouldFail = behavior.allowStepFailures
    ? unresolvedAutofix > 0
    : failed > 0 || unresolvedAutofix > 0;
  if (shouldFail) {
    process.exitCode = 1;
  }
}

async function cmdPrepare(rest: string[], flags: Flags): Promise<void> {
  const options = parsePrepareProfileOptions(rest);
  await runPrepareProfile(options, flags, { allowStepFailures: false });
}

async function cmdCompile(rest: string[], flags: Flags): Promise<void> {
  const options = parseCompileProfileOptions(rest);
  await runPrepareProfile(options, flags, { allowStepFailures: true });
}

async function cmdBootstrap(rest: string[], flags: Flags): Promise<void> {
  const { piName, scriptArgs } = parseBootstrapArgs(rest);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const cableRoot = path.resolve(moduleDir, "../../..");
  const repoRoot = path.resolve(cableRoot, "..");
  const scriptPath = path.join(cableRoot, "scripts", "pis", "bootstrap.sh");

  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error(`bootstrap script not found: ${scriptPath}`);
  }

  const extraArgs: string[] = [];
  const scriptHasRegistryArg = scriptArgs.some((arg) => arg === "--registry" || arg.startsWith("--registry="));
  if (!flags.registryPath && !scriptHasRegistryArg) {
    const localRegistryPath = path.join(cableRoot, "config", "registry.local.toml");
    try {
      const raw = await fs.readFile(localRegistryPath, "utf-8");
      if (raw.includes(`[pis.${piName}]`)) {
        extraArgs.push("--registry", localRegistryPath);
      }
    } catch {
      // ignore auto-detection failures
    }
  }
  if (flags.registryPath && !scriptArgs.some((arg) => arg === "--registry" || arg.startsWith("--registry="))) {
    extraArgs.push("--registry", flags.registryPath);
  }
  if (
    flags.controlPlaneUrl &&
    !scriptArgs.some((arg) => arg === "--control-plane-url" || arg.startsWith("--control-plane-url="))
  ) {
    extraArgs.push("--control-plane-url", flags.controlPlaneUrl);
  }

  const args = [scriptPath, piName, ...scriptArgs, ...extraArgs];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("bash", args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`bootstrap terminated by signal ${signal}`));
        return;
      }
      reject(new Error(`bootstrap failed with exit code ${code ?? 1}`));
    });
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    return;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const { command, rest, flags } = parseArgs(argv);
  if (!command) {
    printHelp();
    return;
  }
  await loadCliEnv(flags);

  switch (command) {
    case "get":
      await cmdGet(rest[0], flags);
      break;
    case "inspect":
      await cmdInspect(rest[0], rest[1], flags);
      break;
    case "doctor":
      await cmdDoctor(rest[0], rest[1], flags);
      break;
    case "bootstrap":
      await cmdBootstrap(rest, flags);
      break;
    case "apply":
      await cmdApply(rest[0], rest[1], flags);
      break;
    case "diff":
      await cmdDiff(rest[0], rest[1], flags);
      break;
    case "prepare":
      await cmdPrepare(rest, flags);
      break;
    case "compile":
      await cmdCompile(rest, flags);
      break;
    case "import":
      await cmdImport(rest, flags);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
