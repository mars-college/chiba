import {
  DEBUG_CHANNEL_ID,
  DEBUG_CHANNEL_NUMBER,
  GODMODE_CHANNEL_ID,
  GODMODE_CHANNEL_NUMBER,
} from "../constants/guide";
import type { GuideChannel, GuideIndex, ProgramSlot } from "../types/guide";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeChannelNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(number)) return null;
  return number;
}

export function isHiddenChannel(channel: GuideChannel): boolean {
  if (!channel) return false;
  const number = normalizeChannelNumber(channel.number ?? "");
  return (
    channel.id === GODMODE_CHANNEL_ID ||
    channel.id === DEBUG_CHANNEL_ID ||
    number === normalizeChannelNumber(GODMODE_CHANNEL_NUMBER) ||
    number === normalizeChannelNumber(DEBUG_CHANNEL_NUMBER)
  );
}

export function ensureDebugChannel(indexData: GuideIndex): GuideIndex {
  if (
    indexData.channels.some(
      (channel) =>
        channel.id === DEBUG_CHANNEL_ID ||
        channel.number === DEBUG_CHANNEL_NUMBER
    )
  ) {
    return indexData;
  }
  const slotCount = Math.max(1, indexData.slotCount);
  const schedule: ProgramSlot[] = [
    {
      title: "Diagnostics",
      subtitle: "Bandwidth + health",
      tag: "DEBUG",
      start: 0,
      span: slotCount,
      end: slotCount - 1,
      durationSec: slotCount * indexData.slotMinutes * 60,
    },
  ];
  const debugChannel: GuideChannel = {
    id: DEBUG_CHANNEL_ID,
    number: DEBUG_CHANNEL_NUMBER,
    name: "Debug",
    callSign: "DBG",
    description: "Performance and media load.",
    accent: "#8fa7ff",
    previewUrl: "",
    schedule,
  };
  const channels = [...indexData.channels];
  const insertAt = channels.findIndex((channel) => {
    const number = normalizeChannelNumber(channel.number);
    return number !== null && number > 26;
  });
  if (insertAt === -1) {
    channels.push(debugChannel);
  } else {
    channels.splice(insertAt, 0, debugChannel);
  }
  return {
    ...indexData,
    channels,
  };
}

export function ensureSystemChannels(indexData: GuideIndex): GuideIndex {
  const debugged = ensureDebugChannel(indexData);
  const channels = debugged.channels;
  if (
    channels.some(
      (channel) =>
        channel.id === GODMODE_CHANNEL_ID ||
        channel.number === GODMODE_CHANNEL_NUMBER
    )
  ) {
    return debugged;
  }
  const slotCount = Math.max(1, debugged.slotCount);
  const schedule: ProgramSlot[] = [
    {
      title: "God Mode",
      subtitle: "Pick any program",
      tag: "GOD",
      start: 0,
      span: slotCount,
      end: slotCount - 1,
      durationSec: slotCount * debugged.slotMinutes * 60,
    },
  ];
  return {
    ...debugged,
    channels: [
      {
        id: GODMODE_CHANNEL_ID,
        number: GODMODE_CHANNEL_NUMBER,
        name: "God Mode",
        callSign: "GOD",
        description: "Pick any program",
        accent: "#ff7fbc",
        previewUrl: "",
        schedule,
      },
      ...channels,
    ],
  };
}

export function getCurrentSlotIndex(
  now: Date,
  startTime: string,
  slotMinutes: number,
  slotCount: number
): number {
  const parts = startTime.split(":");
  const startHour = Number.parseInt(parts[0] ?? "", 10);
  const startMinute = Number.parseInt(parts[1] ?? "", 10);
  if (
    !Number.isFinite(startHour) ||
    !Number.isFinite(startMinute) ||
    slotMinutes <= 0
  ) {
    return 0;
  }
  const start = new Date(now);
  start.setHours(startHour, startMinute, 0, 0);
  const diffMs = now.getTime() - start.getTime();
  const slotIndex = Math.floor(diffMs / (slotMinutes * 60 * 1000));
  return clamp(slotIndex, 0, Math.max(0, slotCount - 1));
}
