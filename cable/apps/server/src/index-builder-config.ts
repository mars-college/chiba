import crypto from "node:crypto";
import path from "node:path";
import type { ChannelManifest, LoadedConfig } from "./config.js";

export type ProgramSlot = {
  title: string;
  subtitle?: string;
  tag?: string;
  url?: string;
  durationSec?: number;
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

function buildSchedule(
  programs: ChannelManifest["programs"],
  slotCount: number,
  slotMinutes: number
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
        ? mediaUrlForPath(program.source.value)
        : program.source?.type === "url"
        ? program.source.value
        : undefined;

    schedule.push({
      title: program.title,
      subtitle: program.subtitle,
      tag: program.tag,
      url,
      durationSec,
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
        ? channel.audio_source.value
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
    schedule: buildSchedule(channel.programs, slotCount, slotMinutes),
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
