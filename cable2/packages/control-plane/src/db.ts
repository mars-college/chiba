import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";
import type {
  ApplyDispatchResult,
  ApplyNodeIntent,
  ApplyRequest,
  DesiredStateRecord,
  NodeStatusReport,
} from "@chiba-cable2/contracts";

export type StoredOperation = {
  id: string;
  createdAt: number;
  request: unknown;
  computation: unknown;
  dispatchResults: ApplyDispatchResult[] | null;
};

export interface OperationStore {
  kind: "file" | "postgres";
  info: Record<string, unknown>;
  list(limit?: number): Promise<StoredOperation[]>;
  append(operation: StoredOperation): Promise<void>;
  replaceDesiredForIntents(args: {
    operationId: string;
    request: ApplyRequest;
    intents: ApplyNodeIntent[];
  }): Promise<void>;
  listDesired(nodeId?: string): Promise<DesiredStateRecord[]>;
  upsertNodeStatus(status: NodeStatusReport): Promise<void>;
  listNodeStatus(limit?: number, nodeId?: string): Promise<NodeStatusReport[]>;
  close(): Promise<void>;
}

type ControlOperationRow = {
  id: string;
  created_at: string | number;
  request_json: unknown;
  computation_json: unknown;
  dispatch_results_json: unknown;
};

type DesiredStateRow = {
  node_id: string;
  updated_at: string | number;
  operation_id: string;
  request_json: unknown;
  intent_json: unknown;
};

type NodeStatusRow = {
  status_json: unknown;
};

type FileDataV1 = {
  version: 1;
  operations: StoredOperation[];
};

type FileDataV2 = {
  version: 2;
  operations: StoredOperation[];
  desiredStates: Record<string, DesiredStateRecord>;
  nodeStatuses: Record<string, NodeStatusReport>;
};

const MAX_FILE_OPERATIONS = 2000;

function clampLimit(limit: number | undefined, fallback = 200, max = 1000): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

function createEmptyFileData(): FileDataV2 {
  return {
    version: 2,
    operations: [],
    desiredStates: {},
    nodeStatuses: {},
  };
}

async function loadFileData(filePath: string): Promise<FileDataV2> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version === 2) {
      return {
        version: 2,
        operations: Array.isArray(parsed.operations) ? (parsed.operations as StoredOperation[]) : [],
        desiredStates:
          parsed.desiredStates && typeof parsed.desiredStates === "object"
            ? (parsed.desiredStates as Record<string, DesiredStateRecord>)
            : {},
        nodeStatuses:
          parsed.nodeStatuses && typeof parsed.nodeStatuses === "object"
            ? (parsed.nodeStatuses as Record<string, NodeStatusReport>)
            : {},
      };
    }
    if (parsed.version === 1 && Array.isArray(parsed.operations)) {
      return {
        version: 2,
        operations: parsed.operations as StoredOperation[],
        desiredStates: {},
        nodeStatuses: {},
      };
    }
  } catch {
    // ignore
  }
  return createEmptyFileData();
}

async function saveFileData(filePath: string, data: FileDataV2): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

function sortDesiredStates(records: DesiredStateRecord[]): DesiredStateRecord[] {
  return records.sort((a, b) => {
    const byNode = a.nodeId.localeCompare(b.nodeId);
    if (byNode !== 0) return byNode;
    return b.updatedAt - a.updatedAt;
  });
}

function sortNodeStatuses(records: NodeStatusReport[]): NodeStatusReport[] {
  return records.sort((a, b) => b.seenAt - a.seenAt);
}

function toDesiredStateRecord(args: {
  operationId: string;
  request: ApplyRequest;
  intent: ApplyNodeIntent;
}): DesiredStateRecord {
  return {
    nodeId: args.intent.nodeId,
    updatedAt: Date.now(),
    operationId: args.operationId,
    request: args.request,
    intent: args.intent,
  };
}

async function createFileStore(filePath: string): Promise<OperationStore> {
  return {
    kind: "file",
    info: { filePath },
    async list(limit = 200) {
      const data = await loadFileData(filePath);
      return data.operations.slice(0, clampLimit(limit));
    },
    async append(operation) {
      const data = await loadFileData(filePath);
      data.operations.unshift(operation);
      if (data.operations.length > MAX_FILE_OPERATIONS) {
        data.operations = data.operations.slice(0, MAX_FILE_OPERATIONS);
      }
      await saveFileData(filePath, data);
    },
    async replaceDesiredForIntents(args) {
      const data = await loadFileData(filePath);
      for (const intent of args.intents) {
        data.desiredStates[intent.nodeId] = toDesiredStateRecord({
          operationId: args.operationId,
          request: args.request,
          intent,
        });
      }
      await saveFileData(filePath, data);
    },
    async listDesired(nodeId) {
      const data = await loadFileData(filePath);
      if (nodeId) {
        const record = data.desiredStates[nodeId];
        return record ? [record] : [];
      }
      return sortDesiredStates(Object.values(data.desiredStates));
    },
    async upsertNodeStatus(status) {
      const data = await loadFileData(filePath);
      data.nodeStatuses[status.nodeId] = status;
      await saveFileData(filePath, data);
    },
    async listNodeStatus(limit = 200, nodeId) {
      const data = await loadFileData(filePath);
      if (nodeId) {
        const record = data.nodeStatuses[nodeId];
        return record ? [record] : [];
      }
      return sortNodeStatuses(Object.values(data.nodeStatuses)).slice(0, clampLimit(limit));
    },
    async close() {
      // no-op
    },
  };
}

async function createPostgresStore(databaseUrl: string): Promise<OperationStore> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS control_operations (
      id TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      request_json JSONB NOT NULL,
      computation_json JSONB NOT NULL,
      dispatch_results_json JSONB
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS control_desired_state (
      node_id TEXT PRIMARY KEY,
      updated_at BIGINT NOT NULL,
      operation_id TEXT NOT NULL,
      request_json JSONB NOT NULL,
      intent_json JSONB NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS control_node_status (
      node_id TEXT PRIMARY KEY,
      seen_at BIGINT NOT NULL,
      status_json JSONB NOT NULL
    )
  `);

  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_control_operations_created_at ON control_operations (created_at DESC)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_control_desired_state_updated_at ON control_desired_state (updated_at DESC)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_control_node_status_seen_at ON control_node_status (seen_at DESC)`
  );

  return {
    kind: "postgres",
    info: { hasDatabaseUrl: true },
    async list(limit = 200) {
      const result = await client.query(
        `
          SELECT id, created_at, request_json, computation_json, dispatch_results_json
          FROM control_operations
          ORDER BY created_at DESC
          LIMIT $1
        `,
        [clampLimit(limit)]
      );

      return result.rows.map((row: ControlOperationRow) => ({
        id: String(row.id),
        createdAt: Number(row.created_at),
        request: row.request_json,
        computation: row.computation_json,
        dispatchResults: (row.dispatch_results_json ?? null) as ApplyDispatchResult[] | null,
      }));
    },
    async append(operation) {
      await client.query(
        `
          INSERT INTO control_operations (id, created_at, request_json, computation_json, dispatch_results_json)
          VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            created_at = EXCLUDED.created_at,
            request_json = EXCLUDED.request_json,
            computation_json = EXCLUDED.computation_json,
            dispatch_results_json = EXCLUDED.dispatch_results_json
        `,
        [
          operation.id,
          operation.createdAt,
          JSON.stringify(operation.request ?? null),
          JSON.stringify(operation.computation ?? null),
          JSON.stringify(operation.dispatchResults ?? null),
        ]
      );
    },
    async replaceDesiredForIntents(args) {
      for (const intent of args.intents) {
        const record = toDesiredStateRecord({
          operationId: args.operationId,
          request: args.request,
          intent,
        });
        await client.query(
          `
            INSERT INTO control_desired_state (node_id, updated_at, operation_id, request_json, intent_json)
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
            ON CONFLICT (node_id) DO UPDATE SET
              updated_at = EXCLUDED.updated_at,
              operation_id = EXCLUDED.operation_id,
              request_json = EXCLUDED.request_json,
              intent_json = EXCLUDED.intent_json
          `,
          [
            record.nodeId,
            record.updatedAt,
            record.operationId,
            JSON.stringify(record.request),
            JSON.stringify(record.intent),
          ]
        );
      }
    },
    async listDesired(nodeId) {
      const result = nodeId
        ? await client.query(
            `
              SELECT node_id, updated_at, operation_id, request_json, intent_json
              FROM control_desired_state
              WHERE node_id = $1
            `,
            [nodeId]
          )
        : await client.query(`
              SELECT node_id, updated_at, operation_id, request_json, intent_json
              FROM control_desired_state
              ORDER BY node_id ASC
            `);

      return result.rows.map((row: DesiredStateRow) => ({
        nodeId: String(row.node_id),
        updatedAt: Number(row.updated_at),
        operationId: String(row.operation_id),
        request: row.request_json as ApplyRequest,
        intent: row.intent_json as ApplyNodeIntent,
      }));
    },
    async upsertNodeStatus(status) {
      await client.query(
        `
          INSERT INTO control_node_status (node_id, seen_at, status_json)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (node_id) DO UPDATE SET
            seen_at = EXCLUDED.seen_at,
            status_json = EXCLUDED.status_json
        `,
        [status.nodeId, status.seenAt, JSON.stringify(status)]
      );
    },
    async listNodeStatus(limit = 200, nodeId) {
      const result = nodeId
        ? await client.query(
            `
              SELECT status_json
              FROM control_node_status
              WHERE node_id = $1
            `,
            [nodeId]
          )
        : await client.query(
            `
              SELECT status_json
              FROM control_node_status
              ORDER BY seen_at DESC
              LIMIT $1
            `,
            [clampLimit(limit)]
          );

      return result.rows
        .map((row: NodeStatusRow) => row.status_json as NodeStatusReport)
        .filter(Boolean);
    },
    async close() {
      await client.end();
    },
  };
}

export async function createOperationStore(): Promise<OperationStore> {
  const databaseUrl = (process.env.CHIBA_CONTROL_DB_URL ?? "").trim();
  if (databaseUrl) {
    try {
      return await createPostgresStore(databaseUrl);
    } catch (error) {
      throw new Error(`postgres_init_failed: ${(error as Error).message}`);
    }
  }

  const filePath =
    process.env.CHIBA_CONTROL_PLANE_DATA_FILE ??
    path.resolve(process.cwd(), "cable2/data/control-plane-data.json");
  return await createFileStore(filePath);
}
