import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import toml from "@iarna/toml";
import {
  type Catalog,
  type CatalogItem,
  CatalogSchema,
} from "@chiba-cable2/contracts";
import { findRepoRoot } from "./registry.js";

export type LoadCatalogOptions = {
  repoRoot?: string;
  configRoot?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toCatalogItem(args: {
  kind: CatalogItem["kind"];
  filePath: string;
  parsed: Record<string, unknown> | null;
}): CatalogItem {
  const basename = path.basename(args.filePath, ".toml");
  const parsedId = isNonEmptyString(args.parsed?.id) ? String(args.parsed.id).trim() : "";
  const id = parsedId || basename;

  const titleCandidates = [args.parsed?.name, args.parsed?.title, args.parsed?.description];
  const title = titleCandidates.find((candidate) => isNonEmptyString(candidate));

  return {
    kind: args.kind,
    id,
    filePath: args.filePath,
    title: isNonEmptyString(title) ? title.trim() : undefined,
  };
}

async function loadKindFromDir(args: {
  dirPath: string;
  kind: CatalogItem["kind"];
}): Promise<CatalogItem[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(args.dirPath))
      .filter((name) => name.endsWith(".toml"))
      .map((name) => path.join(args.dirPath, name));
  } catch {
    return [];
  }

  const entries: CatalogItem[] = [];
  for (const filePath of files) {
    let parsed: Record<string, unknown> | null = null;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      parsed = toml.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    entries.push(toCatalogItem({ kind: args.kind, filePath, parsed }));
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

export async function loadCatalog(options: LoadCatalogOptions = {}): Promise<Catalog> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const defaultConfigRoot = options.configRoot ?? (() => {
    const candidates = ["config", "cable2/config"];
    for (const candidate of candidates) {
      if (fsSync.existsSync(path.join(repoRoot, candidate))) {
        return candidate;
      }
    }
    return "config";
  })();
  const configRoot = path.resolve(repoRoot, defaultConfigRoot);

  const [media, playlists, blocks, channels, profiles] = await Promise.all([
    loadKindFromDir({ dirPath: path.join(configRoot, "media"), kind: "media" }),
    loadKindFromDir({ dirPath: path.join(configRoot, "playlists"), kind: "playlist" }),
    loadKindFromDir({ dirPath: path.join(configRoot, "blocks"), kind: "block" }),
    loadKindFromDir({ dirPath: path.join(configRoot, "channels"), kind: "channel" }),
    loadKindFromDir({ dirPath: path.join(configRoot, "profiles"), kind: "profile" }),
  ]);

  return CatalogSchema.parse({
    media,
    playlists,
    blocks,
    channels,
    profiles,
  });
}
