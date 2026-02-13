import http from "node:http";
import process from "node:process";
import {
  ApplyRequestSchema,
  NodeStatusReportSchema,
  type ApplyDispatchResult,
} from "@chiba-cable2/contracts";
import {
  buildApplyComputation,
  dispatchApplyComputation,
  loadCatalog,
  loadRuntimeCatalog,
  loadNodeInventory,
  loadResourceStore,
} from "@chiba-cable2/core";
import { createOperationStore, type OperationStore, type StoredOperation } from "./db.js";

const port = Number(process.env.PORT ?? 8790);
const sharedNodeApiKey = (process.env.CHIBA_NODE_API_KEY ?? process.env.CHIBA_API_KEY ?? "").trim();

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T | null> {
  return await new Promise<T | null>((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        resolve(null);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function isNodeAuthenticated(req: http.IncomingMessage): boolean {
  if (!sharedNodeApiKey) return true;
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey === sharedNodeApiKey) return true;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length) === sharedNodeApiKey;
  }
  return false;
}

async function createServer(store: OperationStore): Promise<http.Server> {
  return http.createServer(async (req, res) => {
    if (!req.url) {
      sendJson(res, 400, { ok: false, error: "missing_url" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    if (url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "control-plane",
        ts: Date.now(),
        store: {
          kind: store.kind,
          info: store.info,
        },
      });
      return;
    }

    if (url.pathname === "/api/version") {
      sendJson(res, 200, { app: "@chiba-cable2/control-plane", version: "0.0.0" });
      return;
    }

    if (method === "GET" && url.pathname === "/api/nodes") {
      try {
        const inventory = await loadNodeInventory();
        sendJson(res, 200, {
          ok: true,
          canonicalRegistry: inventory.paths.canonicalPath,
          localRegistry: inventory.paths.localPath,
          apiKeyPolicy: inventory.apiKeyPolicy,
          nodes: inventory.entries.map((entry) => ({
            ...entry,
            hasApiKey: Boolean(entry.apiKey),
            apiKey: undefined,
          })),
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/api/catalog") {
      try {
        const [catalog, runtimeCatalog] = await Promise.all([
          loadCatalog(),
          loadRuntimeCatalog(),
        ]);
        sendJson(res, 200, {
          ok: true,
          counts: {
            media: catalog.media.length,
            playlists: catalog.playlists.length,
            blocks: catalog.blocks.length,
            channels: catalog.channels.length,
            profiles: catalog.profiles.length,
          },
          catalog: runtimeCatalog,
          index: catalog,
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/api/operations") {
      try {
        const limitRaw = Number(url.searchParams.get("limit") ?? "200");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
        const operations = await store.list(limit);
        sendJson(res, 200, {
          ok: true,
          count: operations.length,
          operations,
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/api/desired-state") {
      try {
        const nodeId = (url.searchParams.get("nodeId") ?? "").trim() || undefined;
        const desiredState = await store.listDesired(nodeId);
        sendJson(res, 200, {
          ok: true,
          count: desiredState.length,
          desiredState,
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/api/node-status") {
      try {
        const nodeId = (url.searchParams.get("nodeId") ?? "").trim() || undefined;
        const limitRaw = Number(url.searchParams.get("limit") ?? "200");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
        const statuses = await store.listNodeStatus(limit, nodeId);
        sendJson(res, 200, {
          ok: true,
          count: statuses.length,
          statuses,
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/node-status") {
      if (!isNodeAuthenticated(req)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }

      const body = await readJsonBody<Record<string, unknown>>(req);
      if (!body) {
        sendJson(res, 400, { ok: false, error: "invalid_json" });
        return;
      }

      try {
        const report = NodeStatusReportSchema.parse(body);
        await store.upsertNodeStatus(report);
        sendJson(res, 200, {
          ok: true,
          nodeId: report.nodeId,
          seenAt: report.seenAt,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (method === "POST" && (url.pathname === "/api/plan" || url.pathname === "/api/apply")) {
      const body = await readJsonBody<Record<string, unknown>>(req);
      if (!body) {
        sendJson(res, 400, { ok: false, error: "invalid_json" });
        return;
      }

      const dryRunRaw = body.dryRun;
      const executeRaw = body.execute;
      const timeoutMsRaw = body.timeoutMs;

      const dryRun = typeof dryRunRaw === "boolean" ? dryRunRaw : false;
      const executeRequested = typeof executeRaw === "boolean" ? executeRaw : url.pathname === "/api/apply";
      const timeoutMs =
        typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
          ? Math.floor(timeoutMsRaw)
          : 2500;

      try {
        const request = ApplyRequestSchema.parse({
          target: body.target,
          id: body.id,
          nodeIds: Array.isArray(body.nodeIds)
            ? body.nodeIds.filter((value): value is string => typeof value === "string")
            : undefined,
          dryRun,
        });

        const [inventory, storeData] = await Promise.all([
          loadNodeInventory(),
          loadResourceStore(),
        ]);

        const computation = buildApplyComputation({
          request,
          inventory: inventory.entries,
          store: storeData,
        });

        const shouldDispatch = executeRequested && !dryRun;
        const dispatchResults: ApplyDispatchResult[] | null = shouldDispatch
          ? await dispatchApplyComputation({
              computation,
              inventory: inventory.entries,
              timeoutMs,
            })
          : null;

        const operation: StoredOperation = {
          id: `${request.target}:${request.id}:${Date.now()}`,
          createdAt: Date.now(),
          request,
          computation,
          dispatchResults,
        };
        await store.append(operation);
        await store.replaceDesiredForIntents({
          operationId: operation.id,
          request,
          intents: computation.nodeIntents,
        });

        sendJson(res, 200, {
          ok: true,
          operationId: operation.id,
          request,
          computation,
          dispatchResults,
          mode: shouldDispatch ? "dispatched" : "planned_only",
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}

async function main(): Promise<void> {
  const operationStore = await createOperationStore();
  const server = await createServer(operationStore);

  server.listen(port, () => {
    console.log(`cable2 control-plane listening on http://localhost:${port}`);
    console.log(`control-plane store: ${operationStore.kind}`);
  });

  const shutdown = async () => {
    try {
      await operationStore.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
