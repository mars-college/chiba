import { and, asc, eq } from "drizzle-orm";
import {
  NodeConnectivitySnapshotSchema,
  NodeInventoryWriteSchema,
  type NodeConnectivitySnapshot,
  type NodeInventoryWrite,
} from "@chiba-cable3/contracts";
import type { Cable3Db } from "./db.js";
import { schema } from "./db.js";

function cleanString(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanInt(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

async function ensureRegistry(args: {
  db: Cable3Db;
  registryId: string;
  now: number;
}): Promise<void> {
  await args.db
    .insert(schema.registries)
    .values({
      id: args.registryId,
      sourcePath: `db://ops/nodes/${args.registryId}`,
      importedAt: args.now,
    })
    .onConflictDoNothing();
}

export async function listRegistryNodes(args: {
  db: Cable3Db;
  registryId: string;
}): Promise<Array<typeof schema.registryNodes.$inferSelect>> {
  return args.db
    .select()
    .from(schema.registryNodes)
    .where(eq(schema.registryNodes.registryId, args.registryId))
    .orderBy(asc(schema.registryNodes.nodeId));
}

export async function upsertRegistryNode(args: {
  db: Cable3Db;
  input: NodeInventoryWrite;
}): Promise<typeof schema.registryNodes.$inferSelect> {
  const parsed = NodeInventoryWriteSchema.parse(args.input);
  const now = Date.now();
  await ensureRegistry({ db: args.db, registryId: parsed.registryId, now });

  await args.db
    .insert(schema.registryNodes)
    .values({
      registryId: parsed.registryId,
      nodeId: parsed.nodeId,
      host: cleanString(parsed.host),
      ip: cleanString(parsed.ip),
      nodeName: cleanString(parsed.nodeName),
      orientation: cleanString(parsed.orientation),
      displayRotate: cleanInt(parsed.displayRotate),
      guidePort: cleanInt(parsed.guidePort),
      nodePort: cleanInt(parsed.nodePort),
      serverPort: cleanInt(parsed.serverPort),
      apiKey: cleanString(parsed.apiKey),
      importedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.registryNodes.registryId, schema.registryNodes.nodeId],
      set: {
        host: cleanString(parsed.host),
        ip: cleanString(parsed.ip),
        nodeName: cleanString(parsed.nodeName),
        orientation: cleanString(parsed.orientation),
        displayRotate: cleanInt(parsed.displayRotate),
        guidePort: cleanInt(parsed.guidePort),
        nodePort: cleanInt(parsed.nodePort),
        serverPort: cleanInt(parsed.serverPort),
        apiKey: cleanString(parsed.apiKey),
        importedAt: now,
        updatedAt: now,
      },
    });

  const rows = await args.db
    .select()
    .from(schema.registryNodes)
    .where(
      and(
        eq(schema.registryNodes.registryId, parsed.registryId),
        eq(schema.registryNodes.nodeId, parsed.nodeId)
      )
    );
  return rows[0]!;
}

export async function deleteRegistryNode(args: {
  db: Cable3Db;
  registryId: string;
  nodeId: string;
}): Promise<number> {
  const rows = await args.db
    .delete(schema.registryNodes)
    .where(
      and(
        eq(schema.registryNodes.registryId, args.registryId),
        eq(schema.registryNodes.nodeId, args.nodeId)
      )
    )
    .returning({ nodeId: schema.registryNodes.nodeId });
  return rows.length;
}

export async function upsertNodeConnectivity(args: {
  db: Cable3Db;
  snapshot: NodeConnectivitySnapshot;
}): Promise<void> {
  const parsed = NodeConnectivitySnapshotSchema.parse(args.snapshot);
  await args.db
    .insert(schema.nodeConnectivity)
    .values({
      registryId: parsed.registryId,
      nodeId: parsed.nodeId,
      namespace: parsed.namespace,
      dnsOk: parsed.dnsOk,
      pingOk: parsed.pingOk,
      sshOk: parsed.sshOk,
      nodeApiOk: parsed.nodeApiOk,
      cableApiOk: parsed.cableApiOk,
      connectivityScore: parsed.connectivityScore,
      connectivityTotal: parsed.connectivityTotal,
      status: parsed.status,
      latencyMs: parsed.latencyMs,
      errorSummary: parsed.errorSummary ?? null,
      checkedAt: parsed.checkedAt,
    })
    .onConflictDoUpdate({
      target: [
        schema.nodeConnectivity.registryId,
        schema.nodeConnectivity.nodeId,
        schema.nodeConnectivity.namespace,
      ],
      set: {
        dnsOk: parsed.dnsOk,
        pingOk: parsed.pingOk,
        sshOk: parsed.sshOk,
        nodeApiOk: parsed.nodeApiOk,
        cableApiOk: parsed.cableApiOk,
        connectivityScore: parsed.connectivityScore,
        connectivityTotal: parsed.connectivityTotal,
        status: parsed.status,
        latencyMs: parsed.latencyMs,
        errorSummary: parsed.errorSummary ?? null,
        checkedAt: parsed.checkedAt,
      },
    });
}

export async function listNodeConnectivity(args: {
  db: Cable3Db;
  registryId: string;
  namespace: string;
}): Promise<Array<typeof schema.nodeConnectivity.$inferSelect>> {
  return args.db
    .select()
    .from(schema.nodeConnectivity)
    .where(
      and(
        eq(schema.nodeConnectivity.registryId, args.registryId),
        eq(schema.nodeConnectivity.namespace, args.namespace)
      )
    )
    .orderBy(asc(schema.nodeConnectivity.nodeId));
}
