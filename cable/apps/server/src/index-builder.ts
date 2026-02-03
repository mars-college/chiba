import fs from 'node:fs/promises';

export type SourceProgram = {
  title: string;
  subtitle?: string;
  tag?: string;
  url?: string;
  durationSlots?: number;
  durationSec?: number;
};

export type SourceChannel = {
  id: string;
  number: string;
  name: string;
  callSign: string;
  description?: string;
  accent?: string;
  previewUrl?: string;
  audioUrl?: string;
  audioVolume?: number;
  audioOffsetMinSec?: number;
  audioOffsetMaxSec?: number;
  programs: SourceProgram[];
};

export type SourceConfig = {
  slotMinutes: number;
  slotCount: number;
  startTime: string;
  channels: SourceChannel[];
};

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

function formatTimeSlots(startTime: string, slotMinutes: number, slotCount: number): string[] {
  const [hoursStr, minutesStr] = startTime.split(':');
  const baseDate = new Date();
  baseDate.setHours(Number.parseInt(hoursStr, 10), Number.parseInt(minutesStr, 10), 0, 0);

  return Array.from({ length: slotCount }, (_, idx) => {
    const slot = new Date(baseDate.getTime() + idx * slotMinutes * 60 * 1000);
    return slot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  });
}

function buildSchedule(
  programs: SourceProgram[],
  slotCount: number,
  slotMinutes: number
): ProgramSlot[] {
  const schedule: ProgramSlot[] = [];
  let cursor = 0;

  for (const program of programs) {
    if (cursor >= slotCount) break;
    const span = Math.min(program.durationSlots ?? 1, slotCount - cursor);
    const durationSec =
      program.durationSec ?? Math.max(1, span) * slotMinutes * 60;

    schedule.push({
      title: program.title,
      subtitle: program.subtitle,
      tag: program.tag,
      url: program.url,
      durationSec,
      start: cursor,
      span,
      end: cursor + span - 1,
    });
    cursor += span;
  }

  while (cursor < slotCount) {
    schedule.push({
      title: 'Off Air',
      subtitle: 'Standby',
      tag: 'ID',
      start: cursor,
      span: 1,
      end: cursor,
      durationSec: slotMinutes * 60,
    });
    cursor += 1;
  }

  return schedule;
}

export async function buildIndexFromFile(filePath: string): Promise<GuideIndex> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const config = JSON.parse(raw) as SourceConfig;
  const timeSlots = formatTimeSlots(config.startTime, config.slotMinutes, config.slotCount);

  const channels = config.channels.map((channel) => ({
    id: channel.id,
    number: channel.number,
    name: channel.name,
    callSign: channel.callSign,
    description: channel.description,
    accent: channel.accent ?? '#7ed7ff',
    previewUrl: channel.previewUrl,
    audioUrl: channel.audioUrl,
    audioVolume: channel.audioVolume,
    audioOffsetMinSec: channel.audioOffsetMinSec,
    audioOffsetMaxSec: channel.audioOffsetMaxSec,
    schedule: buildSchedule(channel.programs, config.slotCount, config.slotMinutes),
  }));

  return {
    generatedAt: Date.now(),
    slotMinutes: config.slotMinutes,
    slotCount: config.slotCount,
    startTime: config.startTime,
    timeSlots,
    channels,
  };
}
