import fs from "node:fs/promises";
import TOML from "@iarna/toml";
import { eq } from "drizzle-orm";
import {
  DisplayRotateSchema,
  RegistryNodeSchema,
  type RegistrySnapshot,
  RegistrySnapshotSchema,
} from "@chiba-cable3/contracts";
import type { Cable3Db } from "./db.js";
import { schema } from "./db.js";

type ParsedRegistry = {
  defaults?: Record<string, unknown>;
  pis?: Record<string, Record<string, unknown>>;
};

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

function pickRotate(value: unknown): 0 | 90 | 180 | 270 | undefined {
  const parsed = DisplayRotateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mergeNode(
  nodeId: string,
  defaults: Record<string, unknown>,
  node: Record<string, unknown>
) {
  const merged = { ...defaults, ...node };
  return RegistryNodeSchema.parse({
    nodeId,
    host: asString(merged.host),
    ip: asString(merged.ip),
    nodeName: asString(merged.node_name),
    orientation: asString(merged.orientation),
    displayRotate: pickRotate(merged.display_rotate),
    guidePort: asInt(merged.guide_port),
    nodePort: asInt(merged.node_port),
    serverPort: asInt(merged.server_port),
    apiKey: asString(merged.api_key),
  });
}

export async function parseRegistrySnapshot(args: {
  registryId: string;
  sourcePath: string;
}): Promise<RegistrySnapshot> {
  const raw = await fs.readFile(args.sourcePath, "utf8");
  const parsed = TOML.parse(raw) as ParsedRegistry;
  const defaults =
    parsed.defaults && typeof parsed.defaults === "object" ? parsed.defaults : {};
  const pis = parsed.pis && typeof parsed.pis === "object" ? parsed.pis : {};

  const nodes = Object.entries(pis).map(([nodeId, node]) =>
    mergeNode(nodeId, defaults as Record<string, unknown>, node ?? {})
  );

  return RegistrySnapshotSchema.parse({
    registryId: args.registryId,
    sourcePath: args.sourcePath,
    importedAt: Date.now(),
    nodes,
  });
}

export async function importRegistrySnapshot(args: {
  db: Cable3Db;
  snapshot: RegistrySnapshot;
}): Promise<{ registryId: string; nodeCount: number }> {
  await args.db.transaction(async (tx) => {
    await tx
      .insert(schema.registries)
      .values({
        id: args.snapshot.registryId,
        sourcePath: args.snapshot.sourcePath,
        importedAt: args.snapshot.importedAt,
      })
      .onConflictDoUpdate({
        target: schema.registries.id,
        set: {
          sourcePath: args.snapshot.sourcePath,
          importedAt: args.snapshot.importedAt,
        },
      });

    await tx
      .delete(schema.registryNodes)
      .where(eq(schema.registryNodes.registryId, args.snapshot.registryId));

    if (args.snapshot.nodes.length > 0) {
        await tx.insert(schema.registryNodes).values(
        args.snapshot.nodes.map((node) => ({
          registryId: args.snapshot.registryId,
          nodeId: node.nodeId,
          host: node.host ?? null,
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? null,
          orientation: node.orientation ?? null,
          displayRotate: node.displayRotate ?? null,
          guidePort: node.guidePort ?? null,
          nodePort: node.nodePort ?? null,
          serverPort: node.serverPort ?? null,
          apiKey: node.apiKey ?? null,
          importedAt: args.snapshot.importedAt,
          createdAt: args.snapshot.importedAt,
          updatedAt: args.snapshot.importedAt,
        }))
      );
    }
  });

  return {
    registryId: args.snapshot.registryId,
    nodeCount: args.snapshot.nodes.length,
  };
}
