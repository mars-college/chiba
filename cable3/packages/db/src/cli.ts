import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { ResourceImportPayloadSchema } from "@chiba-cable3/contracts";
import { createDb, createDbPool } from "./db.js";
import { getDbConfig } from "./config.js";
import { runMigrations } from "./migrate.js";
import { importRegistrySnapshot, parseRegistrySnapshot } from "./registry-import.js";
import { getResourceSnapshot, importResources } from "./resource-store.js";
import { importCable2Channels } from "./cable2-channel-import.js";
import { resolveDefaultSeedPaths, seedLocalCatalog } from "./seed-local.js";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  chiba3-db migrate",
      "  chiba3-db import-registry --registry <path> --registry-id <id>",
      "  chiba3-db import-resources --file <path>",
      "  chiba3-db import-cable2-channels [--config-root <path>] [--channels <id,id,...>] [--guide-base-url <url>] [--slot-duration-sec <n>]",
      "  chiba3-db seed-local [--assets-root <path>] [--config-root <path>] [--channels <id,id,...>] [--guide-base-url <url>] [--slot-duration-sec <n>]",
      "  chiba3-db snapshot-resources",
      "",
      "Env:",
      "  CHIBA3_DB_URL=postgresql://...",
    ].join("\n")
  );
  process.exit(1);
}

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  const next = process.argv[idx + 1];
  return next && !next.startsWith("-") ? next : undefined;
}

function resolveUserPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const initCwd = process.env.INIT_CWD?.trim();
  const base = initCwd && initCwd.length > 0 ? initCwd : process.cwd();
  return path.resolve(base, inputPath);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd) usage();

  const pool = createDbPool();
  const db = createDb(pool);
  try {
    if (cmd === "migrate") {
      const cfg = getDbConfig();
      await runMigrations({ db, migrationsDir: cfg.migrationsDir });
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "migrate",
            migrationsDir: cfg.migrationsDir,
          },
          null,
          2
        )
      );
      return;
    }

    if (cmd === "import-registry") {
      const registryPathRaw = readArg("--registry");
      const registryId = readArg("--registry-id");
      if (!registryPathRaw || !registryId) usage();
      const registryPath = resolveUserPath(registryPathRaw);

      const snapshot = await parseRegistrySnapshot({
        registryId,
        sourcePath: registryPath,
      });
      const result = await importRegistrySnapshot({ db, snapshot });
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "import-registry",
            registryId: result.registryId,
            nodeCount: result.nodeCount,
            sourcePath: registryPath,
          },
          null,
          2
        )
      );
      return;
    }

    if (cmd === "import-resources") {
      const filePathRaw = readArg("--file");
      if (!filePathRaw) usage();
      const filePath = resolveUserPath(filePathRaw);
      const raw = await readFile(filePath, "utf8");
      const parsed = ResourceImportPayloadSchema.parse(JSON.parse(raw));
      const counts = await importResources({
        db,
        payload: parsed,
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "import-resources",
            filePath,
            counts,
          },
          null,
          2
        )
      );
      return;
    }

    if (cmd === "import-cable2-channels") {
      const configRootRaw = readArg("--config-root") ?? "cable2/config";
      const configRoot = resolveUserPath(configRootRaw);
      const channelsArg = readArg("--channels");
      const channelIds = channelsArg
        ? channelsArg
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        : undefined;
      const guideBaseUrl = readArg("--guide-base-url");
      const slotDurationSecRaw = readArg("--slot-duration-sec");
      const slotDurationSec = slotDurationSecRaw
        ? Math.max(1, Math.floor(Number(slotDurationSecRaw) || 15))
        : undefined;

      const result = await importCable2Channels({
        db,
        configRoot,
        ...(channelIds ? { channelIds } : {}),
        ...(guideBaseUrl ? { guideBaseUrl } : {}),
        ...(slotDurationSec ? { slotDurationSec } : {}),
      });

      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "import-cable2-channels",
            configRoot,
            channels: channelIds ?? "all",
            ...(guideBaseUrl ? { guideBaseUrl } : {}),
            ...(slotDurationSec ? { slotDurationSec } : {}),
            counts: result.counts,
            warnings: result.warnings,
          },
          null,
          2
        )
      );
      return;
    }

    if (cmd === "seed-local") {
      const defaults = resolveDefaultSeedPaths();
      const assetsRootRaw = readArg("--assets-root");
      const configRootRaw = readArg("--config-root");
      const channelsArg = readArg("--channels");
      const channelIds = channelsArg
        ? channelsArg
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        : undefined;
      const guideBaseUrl = readArg("--guide-base-url");
      const slotDurationSecRaw = readArg("--slot-duration-sec");
      const slotDurationSec = slotDurationSecRaw
        ? Math.max(1, Math.floor(Number(slotDurationSecRaw) || 15))
        : undefined;

      const result = await seedLocalCatalog({
        db,
        assetsRoot: assetsRootRaw
          ? resolveUserPath(assetsRootRaw)
          : defaults.assetsRoot,
        cable2ConfigRoot: configRootRaw
          ? resolveUserPath(configRootRaw)
          : defaults.cable2ConfigRoot,
        ...(channelIds ? { channelIds } : {}),
        ...(guideBaseUrl ? { guideBaseUrl } : {}),
        ...(slotDurationSec ? { slotDurationSec } : {}),
      });

      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "seed-local",
            channels: result.channels,
            counts: {
              local: result.localCounts,
              cable2: result.cable2Counts,
            },
            warnings: result.cable2Warnings,
          },
          null,
          2
        )
      );
      return;
    }

    if (cmd === "snapshot-resources") {
      const snapshot = await getResourceSnapshot({ db });
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "snapshot-resources",
            snapshot,
          },
          null,
          2
        )
      );
      return;
    }

    usage();
  } finally {
    await pool.end();
  }
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
