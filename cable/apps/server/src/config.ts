import fs from "node:fs/promises";
import path from "node:path";
import toml from "@iarna/toml";

export type ChannelProgramSource = {
  type: "path" | "url";
  value: string;
};

export type ChannelProgram = {
  title: string;
  subtitle?: string;
  tag?: string;
  duration_slots?: number;
  source?: ChannelProgramSource;
};

export type ChannelManifest = {
  id: string;
  number: string;
  name: string;
  call_sign: string;
  accent?: string;
  description?: string;
  audio_source?: ChannelProgramSource;
  audio_volume?: number;
  audio_offset_min_sec?: number;
  audio_offset_max_sec?: number;
  embed?: ChannelEmbedConfig;
  programs: ChannelProgram[];
};

export type ChannelEmbedOverlay = {
  title?: string;
  subtitle?: string;
  hint?: string;
  qr?: string;
  button?: string;
  show_delay_ms?: number;
  hide_on_message?: boolean;
  mode?: "center" | "corner";
};

export type ChannelEmbedMask = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  width?: number;
  height?: number;
};

export type ChannelEmbedConfig = {
  mode?: "iframe" | "proxy";
  url?: string;
  allow?: string;
  sandbox?: string;
  autoplay_messages?: string[];
  autoplay_delay_ms?: number;
  autoplay_retry_ms?: number;
  autoplay_retries?: number;
  dismiss_selectors?: string[];
  mask?: ChannelEmbedMask;
  overlay?: ChannelEmbedOverlay;
};

export type ChibaConfig = {
  server?: {
    host?: string;
    port?: number;
    remote_url?: string;
  };
  library: {
    roots: string[];
  };
  index?: {
    scan_interval_sec?: number;
    full_scan_on_start?: boolean;
  };
  channels: {
    manifest_dir: string;
    slot_minutes: number;
    slot_count: number;
    start_time: string;
  };
};

export type LoadedConfig = {
  config: ChibaConfig;
  configPath: string;
  manifestDir: string;
  libraryRoots: string[];
  channels: ChannelManifest[];
};

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function resolvePath(baseDir: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.resolve(baseDir, target);
}

function normalizePrograms(programs: ChannelProgram[] | undefined): ChannelProgram[] {
  return ensureArray(programs ?? []).map((program) => ({
    ...program,
    duration_slots:
      typeof program.duration_slots === "number" && program.duration_slots > 0
        ? program.duration_slots
        : 1,
  }));
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function normalizeEmbed(value: unknown): ChannelEmbedConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const overlayRaw =
    raw.overlay && typeof raw.overlay === "object"
      ? (raw.overlay as Record<string, unknown>)
      : undefined;
  const maskRaw =
    raw.mask && typeof raw.mask === "object"
      ? (raw.mask as Record<string, unknown>)
      : undefined;
  const embed: ChannelEmbedConfig = {
    mode:
      raw.mode === "proxy" || raw.mode === "iframe"
        ? raw.mode
        : undefined,
    url: isString(raw.url) ? raw.url : undefined,
    allow: isString(raw.allow) ? raw.allow : undefined,
    sandbox: isString(raw.sandbox) ? raw.sandbox : undefined,
    autoplay_messages: ensureArray(raw.autoplay_messages).filter(isString),
    autoplay_delay_ms: normalizeNumber(raw.autoplay_delay_ms),
    autoplay_retry_ms: normalizeNumber(raw.autoplay_retry_ms),
    autoplay_retries: normalizeNumber(raw.autoplay_retries),
    dismiss_selectors: ensureArray(raw.dismiss_selectors).filter(isString),
    mask: maskRaw
      ? {
          top: normalizeNumber(maskRaw.top),
          right: normalizeNumber(maskRaw.right),
          bottom: normalizeNumber(maskRaw.bottom),
          left: normalizeNumber(maskRaw.left),
          width: normalizeNumber(maskRaw.width),
          height: normalizeNumber(maskRaw.height),
        }
      : undefined,
    overlay: overlayRaw
      ? {
          title: isString(overlayRaw.title) ? overlayRaw.title : undefined,
          subtitle: isString(overlayRaw.subtitle) ? overlayRaw.subtitle : undefined,
          hint: isString(overlayRaw.hint) ? overlayRaw.hint : undefined,
          qr: isString(overlayRaw.qr) ? overlayRaw.qr : undefined,
          button: isString(overlayRaw.button) ? overlayRaw.button : undefined,
          show_delay_ms: normalizeNumber(overlayRaw.show_delay_ms),
          hide_on_message:
            typeof overlayRaw.hide_on_message === "boolean"
              ? overlayRaw.hide_on_message
              : undefined,
          mode:
            overlayRaw.mode === "corner" || overlayRaw.mode === "center"
              ? overlayRaw.mode
              : undefined,
        }
      : undefined,
  };
  if (!embed.mode && !embed.url) return undefined;
  return embed;
}

async function loadChannelManifest(filePath: string): Promise<ChannelManifest> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = toml.parse(raw) as Partial<ChannelManifest> & {
    program?: ChannelProgram[] | ChannelProgram;
  };

  const programs = normalizePrograms(
    (parsed.programs ?? parsed.program) as ChannelProgram[] | undefined
  );

  return {
    id: parsed.id ?? path.basename(filePath, path.extname(filePath)),
    number: parsed.number ?? "",
    name: parsed.name ?? parsed.id ?? "Channel",
    call_sign: parsed.call_sign ?? "",
    accent: parsed.accent,
    description: parsed.description,
    audio_source: parsed.audio_source,
    audio_volume: normalizeNumber(parsed.audio_volume),
    audio_offset_min_sec: normalizeNumber(parsed.audio_offset_min_sec),
    audio_offset_max_sec: normalizeNumber(parsed.audio_offset_max_sec),
    embed: normalizeEmbed(parsed.embed),
    programs,
  };
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const configRaw = await fs.readFile(configPath, "utf-8");
  const parsed = toml.parse(configRaw) as ChibaConfig;
  if (!parsed.library || !parsed.channels) {
    throw new Error("Config missing [library] or [channels] sections.");
  }
  const baseDir = path.dirname(configPath);
  const manifestDir = resolvePath(baseDir, parsed.channels.manifest_dir);

  const rootCandidates = ensureArray(parsed.library.roots).filter(isString);
  const libraryRoots = rootCandidates.map((root) => resolvePath(baseDir, root));

  let channelFiles: string[] = [];
  try {
    channelFiles = (await fs.readdir(manifestDir))
      .filter((file) => file.endsWith(".toml"))
      .map((file) => path.join(manifestDir, file));
  } catch {
    channelFiles = [];
  }

  const channels = await Promise.all(
    channelFiles.map((file) => loadChannelManifest(file))
  );

  return {
    config: parsed,
    configPath,
    manifestDir,
    libraryRoots,
    channels,
  };
}
