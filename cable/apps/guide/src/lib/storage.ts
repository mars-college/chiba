import {
  AUDIO_STORAGE_KEY,
  AUDIO_VOLUME_DEFAULT,
  DISPLAY_STORAGE_KEY,
} from "../constants/guide";
import type { AudioSettings, DisplaySettings } from "../types/guide";

export function loadDisplaySettings(): DisplaySettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DisplaySettings;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function loadAudioSettings(): AudioSettings {
  if (typeof window === "undefined") {
    return { volume: AUDIO_VOLUME_DEFAULT, muted: false };
  }
  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) {
      return { volume: AUDIO_VOLUME_DEFAULT, muted: false };
    }
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    const volume =
      typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
        ? parsed.volume
        : AUDIO_VOLUME_DEFAULT;
    return { volume, muted: false };
  } catch {
    return { volume: AUDIO_VOLUME_DEFAULT, muted: false };
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

export function loadScreenId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem("chiba:screen") ?? "";
  } catch {
    return "";
  }
}
