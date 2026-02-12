#!/usr/bin/env node
import process from "node:process";
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
  chiba apply <target> <id> [--nodes a,b] [--dry-run] [--execute] [--timeout-ms N] [--control-plane URL] [--json]
  chiba diff <target> <id> [--nodes a,b] [--fetch] [--timeout-ms N] [--json]

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
`);
}

function parseArgs(argv: string[]): { command: string | null; rest: string[]; flags: Flags } {
  const rest: string[] = [];
  const flags: Flags = {
    json: false,
    dryRun: false,
    execute: false,
    fetch: false,
    nodes: [],
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

async function fetchNodeJson(args: {
  host: string;
  port: number;
  path: string;
  timeoutMs: number;
  apiKey: string | null;
}): Promise<{ ok: boolean; status: number | null; data: unknown; error: string | null }> {
  const normalizedHost =
    args.host.includes(":") && !args.host.startsWith("[") ? `[${args.host}]` : args.host;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (args.apiKey) headers["x-api-key"] = args.apiKey;
    const response = await fetch(`http://${normalizedHost}:${args.port}${args.path}`, {
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
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      error: (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
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

  switch (command) {
    case "get":
      await cmdGet(rest[0], flags);
      break;
    case "inspect":
      await cmdInspect(rest[0], rest[1], flags);
      break;
    case "apply":
      await cmdApply(rest[0], rest[1], flags);
      break;
    case "diff":
      await cmdDiff(rest[0], rest[1], flags);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
