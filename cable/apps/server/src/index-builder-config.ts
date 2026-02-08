import crypto from "node:crypto";
import path from "node:path";
import type {
  ChannelInfoCard,
  ChannelManifest,
  LoadedConfig,
  RemoteRegistration,
} from "./config.js";

export type ProgramSlot = {
  title: string;
  subtitle?: string;
  tag?: string;
  artist?: string;
  infoTitle?: string;
  description?: string;
  hudMode?: "always" | "start" | "never";
  hudShowSec?: number;
  url?: string;
  durationSec?: number;
  remoteControls?: RemoteRegistration[];
  start: number;
  span: number;
  end: number;
};

export type ChannelIndex = {
  id: string;
  number: string;
  name: string;
  callSign: string;
  description?: string;
  accent: string;
  previewUrl?: string;
  audioUrl?: string;
  audioVolume?: number;
  audioOffsetMinSec?: number;
  audioOffsetMaxSec?: number;
  schedule: ProgramSlot[];
};

export type GuideIndex = {
  generatedAt: number;
  slotMinutes: number;
  slotCount: number;
  startTime: string;
  timeSlots: string[];
  channels: ChannelIndex[];
};

function formatTimeSlots(
  startTime: string,
  slotMinutes: number,
  slotCount: number
): string[] {
  const [hoursStr, minutesStr] = startTime.split(":");
  const baseDate = new Date();
  baseDate.setHours(
    Number.parseInt(hoursStr, 10),
    Number.parseInt(minutesStr, 10),
    0,
    0
  );

  return Array.from({ length: slotCount }, (_, idx) => {
    const slot = new Date(baseDate.getTime() + idx * slotMinutes * 60 * 1000);
    return slot.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  });
}

function getHalfHourStart(): string {
  const now = new Date();
  const minutes = now.getMinutes();
  const flooredMinutes = minutes < 30 ? 0 : 30;
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    flooredMinutes
  ).padStart(2, "0")}`;
}

function mediaUrlForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const base = path
    .basename(filePath, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
  const hash = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 8);
  const name = base ? `${base}-${hash}${ext}` : `${hash}${ext}`;
  return `/media/${name}?path=${encodeURIComponent(filePath)}`;
}

function stashedMediaUrlForPath(filePath: string): string {
  // Local stash cache for NAS paths. If not cached, server returns 404 quickly so
  // gallery playlist mode can skip it (and the server may warm it in the background).
  const ext = path.extname(filePath).toLowerCase();
  const base = path
    .basename(filePath, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
  const hash = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 10);
  const safeExt = ext && ext.length <= 10 ? ext : ".bin";
  const name = base ? `${base}-${hash}${safeExt}` : `${hash}${safeExt}`;
  return `/stash/${name}?path=${encodeURIComponent(filePath)}`;
}

function cachedMediaUrlForRemote(remoteUrl: string): string {
  let ext = "";
  let base = "";
  try {
    const parsed = new URL(remoteUrl);
    ext = path.extname(parsed.pathname).toLowerCase();
    base = path
      .basename(parsed.pathname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 32);
  } catch {
    ext = "";
    base = "";
  }
  const hash = crypto
    .createHash("sha1")
    .update(remoteUrl)
    .digest("hex")
    .slice(0, 10);
  const safeExt = ext && ext.length <= 10 ? ext : ".bin";
  const name = base ? `${base}-${hash}${safeExt}` : `${hash}${safeExt}`;
  return `/cache/${name}?url=${encodeURIComponent(remoteUrl)}`;
}

function buildSchedule(
  programs: ChannelManifest["programs"],
  slotCount: number,
  slotMinutes: number,
  info?: ChannelInfoCard
): ProgramSlot[] {
  const schedule: ProgramSlot[] = [];
  let cursor = 0;
  let programIndex = 0;

  if (!programs.length) {
    while (cursor < slotCount) {
      schedule.push({
        title: "Off Air",
        subtitle: "Standby",
        tag: "ID",
        start: cursor,
        span: 1,
        end: cursor,
        durationSec: slotMinutes * 60,
      });
      cursor += 1;
    }
    return schedule;
  }

  while (cursor < slotCount) {
    const program = programs[programIndex % programs.length];
    const span = Math.min(
      Math.max(1, program.duration_slots ?? 1),
      slotCount - cursor
    );
    const durationSec = Math.max(1, span) * slotMinutes * 60;
    const url =
      program.source?.type === "path"
        ? program.source.cache
          ? stashedMediaUrlForPath(program.source.value)
          : mediaUrlForPath(program.source.value)
        : program.source?.type === "url"
        ? program.source.cache
          ? cachedMediaUrlForRemote(program.source.value)
          : program.source.value
        : undefined;

    schedule.push({
      title: program.title,
      subtitle: program.subtitle,
      tag: program.tag,
      // Channel-level [info] takes precedence (so a show can brand all pieces
      // consistently without per-program titles leaking into the HUD).
      artist: info?.artist ?? program.artist,
      infoTitle: info?.title ?? program.info_title,
      description: info?.description ?? program.description,
      hudMode: info?.mode ?? (program as any).info_mode,
      hudShowSec:
        typeof info?.show_sec === "number"
          ? info.show_sec
          : typeof program.show_sec === "number"
          ? program.show_sec
          : undefined,
      url,
      durationSec,
      remoteControls: program.remote_controls,
      start: cursor,
      span,
      end: cursor + span - 1,
    });
    cursor += span;
    programIndex += 1;
  }

  return schedule;
}

function normalizeAccent(accent?: string): string {
  return accent ?? "#7ed7ff";
}

export function buildIndexFromConfig(loaded: LoadedConfig): GuideIndex {
  const { config, channels } = loaded;
  const slotMinutes = config.channels.slot_minutes;
  const slotCount = Math.max(
    1,
    Math.round((24 * 60) / Math.max(1, slotMinutes))
  );
  const startTime = getHalfHourStart();
  const timeSlots = formatTimeSlots(startTime, slotMinutes, slotCount);

  const sortedChannels = [...channels].sort((a, b) => {
    const aNum = Number.parseInt(a.number ?? "", 10);
    const bNum = Number.parseInt(b.number ?? "", 10);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    if (Number.isFinite(aNum)) return -1;
    if (Number.isFinite(bNum)) return 1;
    return a.name.localeCompare(b.name);
  });

  const channelIndex: ChannelIndex[] = sortedChannels.map((channel) => ({
    audioUrl:
      channel.audio_source?.type === "path"
        ? mediaUrlForPath(channel.audio_source.value)
        : channel.audio_source?.type === "url"
        ? channel.audio_source.cache
          ? cachedMediaUrlForRemote(channel.audio_source.value)
          : channel.audio_source.value
        : undefined,
    audioVolume: channel.audio_volume,
    audioOffsetMinSec: channel.audio_offset_min_sec,
    audioOffsetMaxSec: channel.audio_offset_max_sec,
    id: channel.id,
    number: channel.number,
    name: channel.name,
    callSign: channel.call_sign,
    description: channel.description,
    accent: normalizeAccent(channel.accent),
    previewUrl: undefined,
    schedule: buildSchedule(channel.programs, slotCount, slotMinutes, channel.info),
  }));

  return {
    generatedAt: Date.now(),
    slotMinutes,
    slotCount,
    startTime,
    timeSlots,
    channels: channelIndex,
  };
}
