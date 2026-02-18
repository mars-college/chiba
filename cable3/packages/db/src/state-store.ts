import { and, eq } from "drizzle-orm";
import type {
  ApplyScreenAssignmentRequest,
  LaunchOptions,
  NodeRuntimeReportV1,
} from "@chiba-cable3/contracts";
import type { Cable3Db } from "./db.js";
import { schema } from "./db.js";

export type DesiredScreenStateRow = {
  screenId: string;
  namespace: string;
  revision: number;
  controllerId: string;
  operationId: string;
  targetKind: string;
  targetId: string;
  launch: LaunchOptions;
  createdAt: number;
};

export type ApplyConflict = {
  expectedRevision: number;
  actualRevision: number;
};

export type ApplyResult =
  | { ok: true; row: DesiredScreenStateRow }
  | { ok: false; conflict: ApplyConflict };

function toDesiredRow(row: typeof schema.desiredScreenState.$inferSelect): DesiredScreenStateRow {
  return {
    screenId: row.screenId,
    namespace: row.namespace,
    revision: row.revision,
    controllerId: row.controllerId,
    operationId: row.operationId,
    targetKind: row.targetKind,
    targetId: row.targetId,
    launch: row.launchJson,
    createdAt: row.createdAt,
  };
}

export async function applyScreenAssignment(args: {
  db: Cable3Db;
  input: ApplyScreenAssignmentRequest;
}): Promise<ApplyResult> {
  return args.db.transaction(async (tx) => {
    const now = Date.now();
    const existingRows = await tx
      .select()
      .from(schema.desiredScreenState)
      .where(
        and(
          eq(schema.desiredScreenState.screenId, args.input.screenId),
          eq(schema.desiredScreenState.namespace, args.input.namespace)
        )
      );
    const existing = existingRows[0];

    if (!existing) {
      if (
        typeof args.input.expectedRevision === "number" &&
        args.input.expectedRevision !== 0
      ) {
        return {
          ok: false,
          conflict: {
            expectedRevision: args.input.expectedRevision,
            actualRevision: 0,
          },
        };
      }

      const insertedRows = await tx
        .insert(schema.desiredScreenState)
        .values({
          screenId: args.input.screenId,
          namespace: args.input.namespace,
          revision: 1,
          controllerId: args.input.controllerId,
          operationId: args.input.operationId,
          targetKind: args.input.target.kind,
          targetId: args.input.target.id,
          launchJson: args.input.launch ?? {},
          createdAt: now,
        })
        .returning();
      const inserted = insertedRows[0];
      if (!inserted) throw new Error("desired_state_insert_failed");

      await tx
        .insert(schema.applyOperations)
        .values({
          id: args.input.operationId,
          namespace: args.input.namespace,
          controllerId: args.input.controllerId,
          requestJson: args.input,
          resultJson: { ok: true, revision: 1 },
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.applyOperations.id,
          set: {
            namespace: args.input.namespace,
            controllerId: args.input.controllerId,
            requestJson: args.input,
            resultJson: { ok: true, revision: 1 },
            updatedAt: now,
          },
        });

      return { ok: true, row: toDesiredRow(inserted) };
    }

    if (
      typeof args.input.expectedRevision === "number" &&
      args.input.expectedRevision !== existing.revision
    ) {
      await tx
        .insert(schema.applyOperations)
        .values({
          id: args.input.operationId,
          namespace: args.input.namespace,
          controllerId: args.input.controllerId,
          requestJson: args.input,
          resultJson: {
            ok: false,
            conflict: {
              expectedRevision: args.input.expectedRevision,
              actualRevision: existing.revision,
            },
          },
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.applyOperations.id,
          set: {
            namespace: args.input.namespace,
            controllerId: args.input.controllerId,
            requestJson: args.input,
            resultJson: {
              ok: false,
              conflict: {
                expectedRevision: args.input.expectedRevision,
                actualRevision: existing.revision,
              },
            },
            updatedAt: now,
          },
        });

      return {
        ok: false,
        conflict: {
          expectedRevision: args.input.expectedRevision,
          actualRevision: existing.revision,
        },
      };
    }

    const nextRevision = existing.revision + 1;
    const updatedRows = await tx
      .update(schema.desiredScreenState)
      .set({
        revision: nextRevision,
        controllerId: args.input.controllerId,
        operationId: args.input.operationId,
        targetKind: args.input.target.kind,
        targetId: args.input.target.id,
        launchJson: args.input.launch ?? {},
        createdAt: now,
      })
      .where(
        and(
          eq(schema.desiredScreenState.screenId, args.input.screenId),
          eq(schema.desiredScreenState.namespace, args.input.namespace)
        )
      )
      .returning();
    const updated = updatedRows[0];
    if (!updated) throw new Error("desired_state_update_failed");

    await tx
      .insert(schema.applyOperations)
      .values({
        id: args.input.operationId,
        namespace: args.input.namespace,
        controllerId: args.input.controllerId,
        requestJson: args.input,
        resultJson: { ok: true, revision: nextRevision },
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.applyOperations.id,
        set: {
          namespace: args.input.namespace,
          controllerId: args.input.controllerId,
          requestJson: args.input,
          resultJson: { ok: true, revision: nextRevision },
          updatedAt: now,
        },
      });

    return { ok: true, row: toDesiredRow(updated) };
  });
}

export async function getDesiredScreenState(args: {
  db: Cable3Db;
  screenId: string;
  namespace: string;
}): Promise<DesiredScreenStateRow | null> {
  const rows = await args.db
    .select()
    .from(schema.desiredScreenState)
    .where(
      and(
        eq(schema.desiredScreenState.screenId, args.screenId),
        eq(schema.desiredScreenState.namespace, args.namespace)
      )
    );
  const row = rows[0];
  return row ? toDesiredRow(row) : null;
}

export async function listDesiredScreenStates(args: {
  db: Cable3Db;
  namespace: string;
  screenId?: string;
}): Promise<DesiredScreenStateRow[]> {
  const rows = await args.db
    .select()
    .from(schema.desiredScreenState)
    .where(
      and(
        eq(schema.desiredScreenState.namespace, args.namespace),
        ...(args.screenId
          ? [eq(schema.desiredScreenState.screenId, args.screenId)]
          : [])
      )
    );
  return rows.map(toDesiredRow);
}

export async function upsertNodeRuntimeReport(args: {
  db: Cable3Db;
  report: NodeRuntimeReportV1;
}): Promise<void> {
  await args.db
    .insert(schema.nodeRuntimeReports)
    .values({
      nodeId: args.report.nodeId,
      namespace: args.report.namespace,
      desiredRevision: args.report.desiredRevision,
      activeRevision: args.report.activeRevision,
      phase: args.report.phase,
      reportJson: args.report,
      updatedAt: args.report.updatedAt,
    })
    .onConflictDoUpdate({
      target: [schema.nodeRuntimeReports.nodeId, schema.nodeRuntimeReports.namespace],
      set: {
        desiredRevision: args.report.desiredRevision,
        activeRevision: args.report.activeRevision,
        phase: args.report.phase,
        reportJson: args.report,
        updatedAt: args.report.updatedAt,
      },
    });
}

export async function getNodeRuntimeReport(args: {
  db: Cable3Db;
  nodeId: string;
  namespace: string;
}): Promise<NodeRuntimeReportV1 | null> {
  const rows = await args.db
    .select({
      report: schema.nodeRuntimeReports.reportJson,
    })
    .from(schema.nodeRuntimeReports)
    .where(
      and(
        eq(schema.nodeRuntimeReports.nodeId, args.nodeId),
        eq(schema.nodeRuntimeReports.namespace, args.namespace)
      )
    );
  return rows[0]?.report ?? null;
}
