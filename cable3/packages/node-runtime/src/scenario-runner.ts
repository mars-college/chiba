import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  ApplyScreenAssignmentRequestSchema,
  ScreenConditionTypeSchema,
  type ScreenConditionType,
} from "@chiba-cable3/contracts";
import { z } from "zod";

const ScenarioSchema = z
  .object({
    name: z.string().min(1),
    apiBaseUrl: z.string().url().optional(),
    apply: ApplyScreenAssignmentRequestSchema.omit({
      operationId: true,
    }).extend({
      operationIdPrefix: z.string().min(1).default("scenario"),
    }),
    expectations: z.array(
      z.object({
        condition: ScreenConditionTypeSchema,
        timeoutMs: z.number().int().positive().default(30_000),
      })
    ),
  })
  .strict();

type Scenario = z.infer<typeof ScenarioSchema>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  const next = process.argv[idx + 1];
  return next && !next.startsWith("-") ? next : undefined;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  pnpm -C packages/node-runtime scenario --file <scenario.json> [--api <url>]",
    ].join("\n")
  );
  process.exit(1);
}

async function waitForCondition(args: {
  apiBaseUrl: string;
  screenId: string;
  namespace: string;
  condition: ScreenConditionType;
  timeoutMs: number;
}): Promise<void> {
  const url = new URL("/api/v1/watch/screen-assignment", args.apiBaseUrl);
  url.searchParams.set("screenId", args.screenId);
  url.searchParams.set("namespace", args.namespace);
  url.searchParams.set("waitFor", args.condition);
  url.searchParams.set("timeoutMs", String(args.timeoutMs));

  const res = await fetch(url, { method: "GET" });
  const dataRaw: unknown = await res.json().catch(() => null);
  const data = asRecord(dataRaw);
  if (!res.ok || data?.ok !== true) {
    throw new Error(
      `condition_wait_failed:${args.condition}:status=${res.status}:` +
        `${typeof data?.error === "string" ? data.error : "unknown"}`
    );
  }
}

async function main(): Promise<void> {
  const fileArg = readArg("--file");
  const apiArg = readArg("--api");
  if (!fileArg) usage();

  const filePath = path.resolve(process.cwd(), fileArg);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = ScenarioSchema.parse(JSON.parse(raw));

  const apiBaseUrl = apiArg ?? parsed.apiBaseUrl ?? "http://127.0.0.1:8795";
  const operationId = `${parsed.apply.operationIdPrefix}-${Date.now()}`;

  const applyRes = await fetch(new URL("/api/v1/apply/screen-assignment", apiBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...parsed.apply,
      operationId,
    }),
  });
  const applyRaw: unknown = await applyRes.json().catch(() => null);
  const applyJson = asRecord(applyRaw);
  if (!applyRes.ok || applyJson?.ok !== true) {
    throw new Error(
      `apply_failed:status=${applyRes.status}:` +
        `${typeof applyJson?.error === "string" ? applyJson.error : "unknown"}`
    );
  }

  for (const ex of parsed.expectations) {
    await waitForCondition({
      apiBaseUrl,
      screenId: parsed.apply.screenId,
      namespace: parsed.apply.namespace,
      condition: ex.condition,
      timeoutMs: ex.timeoutMs,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scenario: parsed.name,
        screenId: parsed.apply.screenId,
        namespace: parsed.apply.namespace,
        operationId,
        expectations: parsed.expectations,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
