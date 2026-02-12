import { type ApplyComputation, type ApplyDispatchResult, type NodeInventoryEntry } from "@chiba-cable2/contracts";

function formatHostForUrl(hostOrIp: string): string {
  if (hostOrIp.includes(":") && !hostOrIp.startsWith("[")) {
    return `[${hostOrIp}]`;
  }
  return hostOrIp;
}

async function postJson(args: {
  url: string;
  body: unknown;
  timeoutMs: number;
  apiKey: string | null;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; json: unknown; error: string | null }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (args.apiKey) {
    headers["x-api-key"] = args.apiKey;
  }

  try {
    const res = await fetch(args.url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(args.body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      json: parsed,
      error: res.ok ? null : `http_${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      ms: null,
      json: null,
      error: (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchApplyComputation(args: {
  computation: ApplyComputation;
  inventory: NodeInventoryEntry[];
  timeoutMs?: number;
}): Promise<ApplyDispatchResult[]> {
  const timeoutMs = args.timeoutMs ?? 2500;
  const results: ApplyDispatchResult[] = [];

  const inventoryById = new Map(args.inventory.map((entry) => [entry.id, entry]));

  for (const intent of args.computation.nodeIntents) {
    const node = inventoryById.get(intent.nodeId);
    if (!node) {
      results.push({
        nodeId: intent.nodeId,
        ok: false,
        status: null,
        ms: null,
        error: "unknown_node",
        response: null,
      });
      continue;
    }

    const host = node.ip ?? node.host;
    if (!host) {
      results.push({
        nodeId: intent.nodeId,
        ok: false,
        status: null,
        ms: null,
        error: "missing_host_or_ip",
        response: null,
      });
      continue;
    }

    const url = `http://${formatHostForUrl(host)}:${node.nodePort}/api/apply`;
    const response = await postJson({
      url,
      timeoutMs,
      apiKey: node.apiKey,
      body: {
        request: args.computation.request,
        intent,
      },
    });

    results.push({
      nodeId: intent.nodeId,
      ok: response.ok,
      status: response.status,
      ms: response.ms,
      error: response.error,
      response: response.ok && typeof response.json === "object" && response.json !== null
        ? (response.json as any)
        : null,
    });
  }

  return results;
}
