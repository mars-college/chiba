import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "./App.css";
import { DEFAULT_THEME_ID, THEME_MAP } from "./themes";
import { fallbackIndex } from "./data/fallbackIndex";
import {
  AUDIO_VOLUME_DEFAULT,
  AUDIO_VOLUME_STEP,
  AUTO_SCROLL_END_HOLD_MS,
  AUTO_SCROLL_PX_PER_SEC,
  DEBUG_CHANNEL_ID,
  DEBUG_CHANNEL_NUMBER,
  DIAL_OVERLAY_COMMIT_MS,
  DIAL_OVERLAY_IDLE_MS,
  DISPLAY_STORAGE_KEY,
  GODMODE_CHANNEL_ID,
  GODMODE_CHANNEL_NUMBER,
  LANDSCAPE_VISIBLE_HOURS,
  PORTRAIT_VISIBLE_HOURS,
  ROW_GAP,
  ROW_HEIGHT,
  TEXT_SCALE_DEFAULT,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  USER_PAUSE_MS,
} from "./constants/guide";
import {
  PARAM_ART_INDEX,
  PARAM_EMBED_DEBUG,
  PARAM_HOURS,
  PARAM_MUTE_KEYS,
  PARAM_NO_SPLASH,
  PARAM_REMOTE_APP_KEYS,
  PARAM_REMOTE_HOST,
  PARAM_REMOTE_HTTPS,
  PARAM_RETURN_ROW,
  PARAM_SCALE,
  PARAM_SCREEN_KEYS,
  PARAM_SPLASH,
  PARAM_TEXT_SCALE_KEYS,
  PARAM_THEME,
} from "./constants/params";
import { usePreloadManager } from "./hooks/usePreloadManager";
import { useRemoteControls } from "./hooks/useRemoteControls";
import { useRemoteSocket } from "./hooks/useRemoteSocket";
import {
  clamp,
  ensureSystemChannels,
  getCurrentSlotIndex,
  isHiddenChannel,
  normalizeChannelNumber,
} from "./lib/guide";
import { createLogger } from "./lib/logger";
import { getAppIdFromUrl, getMediaKind } from "./lib/media";
import {
  appendQueryParam,
  getFirstParam,
  parseBooleanParam,
} from "./lib/queryParams";
import { buildRemoteUrls } from "./lib/remote";
import {
  loadAudioSettings,
  loadDisplaySettings,
  loadScreenId,
  saveAudioSettings,
} from "./lib/storage";
import {
  DisplayTuningPanel,
  type DisplayTuningPayload,
} from "./components/DisplayTuningPanel";
import { SplashScreen } from "./components/SplashScreen";
import { ArtView } from "./views/ArtView";
import { GuideView } from "./views/GuideView";
import { RemoteView } from "./views/RemoteView";
import type {
  DisplaySettings,
  GuideChannel,
  GuideIndex,
  MediaDebugStats,
  PlayerMeta,
  ProgramSlot,
  AudioSettings,
  RemoteMessage,
  ViewMode,
} from "./types/guide";

const log = createLogger("guide-app");

function App() {
  const isRemote = window.location.pathname.startsWith("/remote");
  const channelId = window.location.pathname.startsWith("/channel/")
    ? window.location.pathname.replace("/channel/", "")
    : null;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const viewMode: ViewMode = isRemote ? "remote" : channelId ? "art" : "guide";
  const returnRowParam = Number(params.get(PARAM_RETURN_ROW) ?? "");
  const requestedRemoteAppId =
    getFirstParam(params, PARAM_REMOTE_APP_KEYS) ?? "";
  const scaleParam = params.get(PARAM_SCALE);
  const textScaleParam = getFirstParam(params, PARAM_TEXT_SCALE_KEYS);
  const hoursParam = params.get(PARAM_HOURS);
  const themeParam = params.get(PARAM_THEME);
  const splashParam = params.get(PARAM_SPLASH);
  const noSplashParam = params.get(PARAM_NO_SPLASH);
  const muteParam = getFirstParam(params, PARAM_MUTE_KEYS);
  const screenParam = getFirstParam(params, PARAM_SCREEN_KEYS);
  const embedDebugParam = params.get(PARAM_EMBED_DEBUG);
  const [, setScreenId] = useState(() =>
    screenParam ? screenParam : loadScreenId()
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() =>
    loadDisplaySettings()
  );
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => {
    const base = loadAudioSettings();
    const forcedMuted = parseBooleanParam(muteParam);
    if (forcedMuted === null) return base;
    return { ...base, muted: forcedMuted };
  });
  const splashOverride = parseBooleanParam(splashParam);
  const skipSplash =
    parseBooleanParam(noSplashParam) === true || splashOverride === false;
  const embedDebugEnabled = parseBooleanParam(embedDebugParam) === true;
  const isBaseGuide =
    viewMode === "guide" &&
    (window.location.pathname === "/" || window.location.pathname === "");
  const shouldSplash =
    viewMode === "guide" &&
    !skipSplash &&
    (isBaseGuide || splashOverride === true);
  const activeThemeId = useMemo(() => {
    const fromParam = themeParam ? themeParam.trim() : "";
    const fromSettings = displaySettings.theme ?? "";
    const candidate = fromParam || fromSettings || DEFAULT_THEME_ID;
    return THEME_MAP[candidate] ? candidate : DEFAULT_THEME_ID;
  }, [themeParam, displaySettings.theme]);
  const themeVars = useMemo(
    () => THEME_MAP[activeThemeId]?.vars ?? {},
    [activeThemeId]
  );
  const uiScale = useMemo(() => {
    const raw = scaleParam
      ? Number(scaleParam)
      : displaySettings.scale ?? UI_SCALE_DEFAULT;
    if (!Number.isFinite(raw)) return UI_SCALE_DEFAULT;
    return clamp(raw, UI_SCALE_MIN, UI_SCALE_MAX);
  }, [scaleParam, displaySettings.scale]);
  const textScale = useMemo(() => {
    const raw = textScaleParam
      ? Number(textScaleParam)
      : displaySettings.textScale ?? TEXT_SCALE_DEFAULT;
    if (!Number.isFinite(raw)) return TEXT_SCALE_DEFAULT;
    return clamp(raw, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
  }, [textScaleParam, displaySettings.textScale]);
  const masterVolume = useMemo(() => {
    const raw = audioSettings.volume;
    if (!Number.isFinite(raw)) return AUDIO_VOLUME_DEFAULT;
    return clamp(raw, 0, 1);
  }, [audioSettings.volume]);
  const masterMuted = audioSettings.muted ?? false;

  const [now, setNow] = useState(() => new Date());
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [showVolumeHud, setShowVolumeHud] = useState(false);
  const volumeHudTimerRef = useRef<number | null>(null);
  const didVolumeMountRef = useRef(false);
  const [showSplash, setShowSplash] = useState(() => shouldSplash);
  const splashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    saveAudioSettings({ volume: masterVolume, muted: masterMuted });
  }, [masterVolume, masterMuted]);

  useEffect(() => {
    if (!didVolumeMountRef.current) {
      didVolumeMountRef.current = true;
      return;
    }
    setShowVolumeHud(true);
    if (volumeHudTimerRef.current) {
      window.clearTimeout(volumeHudTimerRef.current);
    }
    volumeHudTimerRef.current = window.setTimeout(() => {
      setShowVolumeHud(false);
    }, 1400);
    return () => {
      if (volumeHudTimerRef.current) {
        window.clearTimeout(volumeHudTimerRef.current);
      }
    };
  }, [masterVolume, masterMuted]);

  useEffect(() => {
    if (!showSplash) return;
    if (splashTimerRef.current) {
      window.clearTimeout(splashTimerRef.current);
    }
    splashTimerRef.current = window.setTimeout(() => {
      setShowSplash(false);
    }, 4500);
    return () => {
      if (splashTimerRef.current) {
        window.clearTimeout(splashTimerRef.current);
      }
    };
  }, [showSplash]);
  const [indexData, setIndexData] = useState<GuideIndex>(() =>
    ensureSystemChannels(fallbackIndex)
  );
  const slotCount = indexData.timeSlots.length;
  const isPortrait = viewportSize.height >= viewportSize.width;
  const visibleHours = useMemo(() => {
    const raw = hoursParam ? Number(hoursParam) : displaySettings.hours ?? NaN;
    if (Number.isFinite(raw) && raw > 0) return raw;
    return isPortrait ? PORTRAIT_VISIBLE_HOURS : LANDSCAPE_VISIBLE_HOURS;
  }, [hoursParam, displaySettings.hours, isPortrait]);
  const visibleSlotCount = useMemo(() => {
    const minutes = Math.max(1, indexData.slotMinutes);
    return Math.max(1, Math.round((visibleHours * 60) / minutes));
  }, [indexData.slotMinutes, visibleHours]);
  const allChannels = indexData.channels;
  const channels = useMemo(
    () => allChannels.filter((channel) => !isHiddenChannel(channel)),
    [allChannels]
  );
  const currentSlotIndex = useMemo(
    () =>
      getCurrentSlotIndex(
        now,
        indexData.startTime,
        indexData.slotMinutes,
        slotCount
      ),
    [now, indexData.startTime, indexData.slotMinutes, slotCount]
  );
  const [visibleStartSlot, setVisibleStartSlot] = useState(0);

  const [selectedRow, setSelectedRow] = useState(0);
  const [selectedCol, setSelectedCol] = useState(0);
  const [showQr, setShowQr] = useState(true);
  const [visibleRows, setVisibleRows] = useState(6);
  const [artIndex, setArtIndex] = useState(0);
  const [artPaused, setArtPaused] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerMeta, setPlayerMeta] = useState<PlayerMeta | null>(null);
  const [showPlayerHud, setShowPlayerHud] = useState(false);
  const [playerChannelIndex, setPlayerChannelIndex] = useState<number | null>(
    null
  );
  const [showDebug, setShowDebug] = useState(false);
  const [memoryStats, setMemoryStats] = useState<{
    used: number;
    total: number;
    limit: number;
  } | null>(null);
  const [mediaStats, setMediaStats] = useState<MediaDebugStats | null>(null);
  const [remoteGodmodeOpen, setRemoteGodmodeOpen] = useState(false);
  const [remoteNowChannel, setRemoteNowChannel] = useState<{
    id?: string;
    number?: string;
    title?: string;
    url?: string;
  } | null>(null);
  const [godmodeQuery, setGodmodeQuery] = useState("");
  const [dialOverlay, setDialOverlay] = useState("");
  const [dialBuffer, setDialBuffer] = useState("");
  const [activeRemoteAppId, setActiveRemoteAppId] =
    useState(requestedRemoteAppId);
  const [remotePanel, setRemotePanel] = useState<"remote" | "app">("remote");

  const pauseUntilRef = useRef(0);
  const autoHoldUntilRef = useRef(0);
  const autoResetPendingRef = useRef(false);
  const lastFrameRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const scrollOffsetRef = useRef(0);
  const prevViewModeRef = useRef(viewMode);
  const prevPlayerOpenRef = useRef(playerOpen);
  const prevPausedRef = useRef(false);
  const lastAppMessageRef = useRef<string | null>(null);
  const lastCurrentSlotRef = useRef<number>(currentSlotIndex);
  const dialTimeoutRef = useRef<number | null>(null);
  const sendRef = useRef<((msg: RemoteMessage) => void) | null>(null);
  const dialOverlayTimerRef = useRef<number | null>(null);

  const getViewportMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const styles = window.getComputedStyle(viewport);
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const innerHeight = Math.max(
      0,
      viewport.clientHeight - paddingTop - paddingBottom
    );
    const rowsEl =
      rowsRef.current ?? viewport.querySelector<HTMLElement>(".channel-rows");
    const rowEl = rowsEl?.querySelector<HTMLElement>(".channel-row");
    const rowHeight =
      rowEl?.getBoundingClientRect().height ?? ROW_HEIGHT * uiScale;
    const gap =
      (rowsEl
        ? Number.parseFloat(window.getComputedStyle(rowsEl).rowGap)
        : NaN) || ROW_GAP * uiScale;
    const stride = rowHeight + gap;
    const contentHeight = rowsEl
      ? rowsEl.scrollHeight
      : Math.max(
          0,
          channels.length * rowHeight + Math.max(0, channels.length - 1) * gap
        );
    return {
      innerHeight,
      paddingY: paddingTop + paddingBottom,
      rowHeight,
      gap,
      stride,
      contentHeight,
    };
  }, [channels.length, uiScale]);

  const getScrollBounds = useCallback(() => {
    const metrics = getViewportMetrics();
    if (!metrics) return null;
    const maxScroll = Math.max(0, metrics.contentHeight - metrics.innerHeight);
    return { ...metrics, maxScroll };
  }, [getViewportMetrics]);

  const moveSelection = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      if (dir === "up") {
        setSelectedRow(
          (prev) => (prev - 1 + channels.length) % channels.length
        );
      }
      if (dir === "down") {
        setSelectedRow((prev) => (prev + 1) % channels.length);
      }
      if (dir === "left") {
        const baseRow = selectedRow;
        const schedule = channels[baseRow]?.schedule ?? [];
        setSelectedCol((prev) => {
          if (!schedule.length) return prev;
          const currentIdx = schedule.findIndex(
            (slot) => prev >= slot.start && prev <= slot.end
          );
          const idx = currentIdx >= 0 ? currentIdx : 0;
          const nextIdx = Math.max(idx - 1, 0);
          const target = schedule[nextIdx]?.start ?? prev;
          return Math.max(target, currentSlotIndex);
        });
      }
      if (dir === "right") {
        const baseRow = selectedRow;
        const schedule = channels[baseRow]?.schedule ?? [];
        setSelectedCol((prev) => {
          if (!schedule.length) return prev;
          const currentIdx = schedule.findIndex(
            (slot) => prev >= slot.start && prev <= slot.end
          );
          const idx = currentIdx >= 0 ? currentIdx : 0;
          const nextIdx = Math.min(idx + 1, schedule.length - 1);
          return schedule[nextIdx]?.start ?? prev;
        });
      }
    },
    [channels, selectedRow, currentSlotIndex]
  );

  const [isPaused, setIsPaused] = useState(false);
  useEffect(() => {
    const check = () => {
      setIsPaused(Date.now() < pauseUntilRef.current);
    };
    check();
    const interval = window.setInterval(check, 100);
    return () => window.clearInterval(interval);
  }, []);
  const activeRow = selectedRow;

  const selectedChannel = channels[activeRow];
  const selectedProgram =
    selectedChannel?.schedule.find(
      (slot) => selectedCol >= slot.start && selectedCol <= slot.end
    ) ??
    selectedChannel?.schedule[0] ??
    null;
  const playerChannel = useMemo(() => {
    if (playerChannelIndex === null) return selectedChannel;
    return channels[playerChannelIndex] ?? selectedChannel;
  }, [playerChannelIndex, channels, selectedChannel]);
  const ambientAudio = useMemo(() => {
    if (!playerOpen) return null;
    if (!playerChannel?.audioUrl) return null;
    return {
      url: playerChannel.audioUrl,
      volume: playerChannel.audioVolume,
      offsetMinSec: playerChannel.audioOffsetMinSec,
      offsetMaxSec: playerChannel.audioOffsetMaxSec,
    };
  }, [playerOpen, playerChannel]);
  const decorateProgramUrl = useCallback(
    (url: string | null) => {
      if (!url) return url;
      if (!embedDebugEnabled) return url;
      if (!url.startsWith("/embed/")) return url;
      return appendQueryParam(url, PARAM_EMBED_DEBUG, "1");
    },
    [embedDebugEnabled]
  );
  const selectedProgramUrl = useMemo(
    () => decorateProgramUrl(selectedProgram?.url ?? null),
    [decorateProgramUrl, selectedProgram?.url]
  );
  const activeAppId = useMemo(() => getAppIdFromUrl(playerUrl), [playerUrl]);
  const playerKind = useMemo(
    () => (playerUrl ? getMediaKind(playerUrl) : null),
    [playerUrl]
  );
  const {
    hasPreviewMedia,
    posterImageReady,
    setPosterImageReady,
    previewContainerRef,
  } = usePreloadManager({
    viewMode,
    selectedProgramUrl,
    selectedChannelPreviewUrl: selectedChannel?.previewUrl ?? null,
    playerOpen,
    playerUrl,
    setPlayerUrl,
    setPlayerReady,
    channels,
    playerChannelIndex,
    activeRow,
    currentSlotIndex,
  });
  const godmodeItems = useMemo(() => {
    const items: Array<{
      id: string;
      program: ProgramSlot;
      channel: GuideChannel;
    }> = [];
    const seen = new Set<string>();
    channels.forEach((channel) => {
      if (channel.id === GODMODE_CHANNEL_ID) return;
      channel.schedule.forEach((program, index) => {
        if (!program.url) return;
        const key = `${program.url}|${program.title ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          id: `${channel.id}-${index}`,
          program,
          channel,
        });
      });
    });
    return items;
  }, [channels]);
  const filteredGodmodeItems = useMemo(() => {
    const query = godmodeQuery.trim().toLowerCase();
    if (!query) return godmodeItems;
    return godmodeItems.filter((item) => {
      const haystack = [
        item.program.title,
        item.program.subtitle,
        item.channel.name,
        item.channel.callSign,
        item.channel.number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [godmodeItems, godmodeQuery]);

  const getProgramForChannel = useCallback(
    (channel: GuideChannel | undefined) => {
      if (!channel) return null;
      return (
        channel.schedule.find(
          (slot) =>
            currentSlotIndex >= slot.start && currentSlotIndex <= slot.end
        ) ?? channel.schedule[0]
      );
    },
    [currentSlotIndex]
  );

  const showDialOverlay = useCallback((value: string, holdMs: number) => {
    if (!value) return;
    setDialOverlay(value);
    if (dialOverlayTimerRef.current) {
      window.clearTimeout(dialOverlayTimerRef.current);
    }
    dialOverlayTimerRef.current = window.setTimeout(() => {
      setDialOverlay("");
    }, holdMs);
  }, []);

  const applyScrollOffset = useCallback((value: number) => {
    scrollOffsetRef.current = value;
    const target = rowsRef.current;
    if (target) {
      target.style.transform = `translateY(-${value}px)`;
    }
  }, []);

  const openProgram = useCallback(
    (program: ProgramSlot, channel: GuideChannel) => {
      if (!program.url) return;
      const programUrl = decorateProgramUrl(program.url);
      if (!programUrl) return;
      setPlayerOpen(true);
      if (playerUrl !== programUrl) {
        setPlayerReady(false);
        setPlayerUrl(programUrl);
      }
      setShowPlayerHud(false);
      const channelIndex = channels.findIndex((item) => item.id === channel.id);
      setPlayerChannelIndex(channelIndex >= 0 ? channelIndex : activeRow);
      setPlayerMeta({
        title: program.title,
        subtitle: program.subtitle,
        channelName: channel.name,
        callSign: channel.callSign,
      });
      sendRef.current?.({
        type: "now",
        channelId: channel.id,
        number: channel.number,
        title: program.title,
        url: program.url,
      });
    },
    [decorateProgramUrl, playerUrl, channels, activeRow]
  );

  const handleChannelChange = useCallback(
    (dir: "up" | "down") => {
      if (!channels.length) return;
      const delta = dir === "up" ? -1 : 1;
      const nextRow = (activeRow + delta + channels.length) % channels.length;
      const nextChannel = channels[nextRow];
      setSelectedRow(nextRow);
      setSelectedCol(currentSlotIndex);
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      if (nextChannel?.number) {
        showDialOverlay(nextChannel.number, DIAL_OVERLAY_COMMIT_MS);
        sendRef.current?.({
          type: "dial",
          value: nextChannel.number,
          committed: true,
        });
      }
      const nextProgram = getProgramForChannel(nextChannel);
      if (nextProgram?.url && nextChannel) {
        openProgram(nextProgram, nextChannel);
      } else {
        setPlayerOpen(false);
        if (nextChannel) {
          sendRef.current?.({
            type: "now",
            channelId: nextChannel.id,
            number: nextChannel.number,
            title: nextProgram?.title,
            url: nextProgram?.url,
          });
        }
      }
    },
    [
      channels,
      activeRow,
      currentSlotIndex,
      openProgram,
      getProgramForChannel,
      showDialOverlay,
    ]
  );

  const handleTuneToNumber = useCallback(
    (value: string) => {
      const targetNumber = normalizeChannelNumber(value);
      if (targetNumber === null) return;
      if (targetNumber === normalizeChannelNumber(GODMODE_CHANNEL_NUMBER)) {
        setPlayerOpen(false);
        sendRef.current?.({
          type: "now",
          channelId: GODMODE_CHANNEL_ID,
          number: GODMODE_CHANNEL_NUMBER,
        });
        return;
      }
      if (targetNumber === normalizeChannelNumber(DEBUG_CHANNEL_NUMBER)) {
        setShowDebug(true);
        setPlayerOpen(false);
        sendRef.current?.({
          type: "now",
          channelId: DEBUG_CHANNEL_ID,
          number: DEBUG_CHANNEL_NUMBER,
          title: "Diagnostics",
        });
        return;
      }
      const targetChannel = allChannels.find((channel) => {
        const channelNumber = normalizeChannelNumber(channel.number);
        return channelNumber !== null && channelNumber === targetNumber;
      });
      if (!targetChannel) return;
      const visibleIndex = channels.findIndex(
        (channel) => channel.id === targetChannel.id
      );
      if (visibleIndex >= 0) {
        setSelectedRow(visibleIndex);
        setSelectedCol(currentSlotIndex);
        pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      }
      const program = getProgramForChannel(targetChannel);
      if (program?.url) {
        openProgram(program, targetChannel);
      } else {
        setPlayerOpen(false);
        sendRef.current?.({
          type: "now",
          channelId: targetChannel.id,
          number: targetChannel.number,
          title: program?.title,
          url: program?.url,
        });
      }
    },
    [allChannels, channels, currentSlotIndex, getProgramForChannel, openProgram]
  );

  const handleGodmodePick = useCallback(
    (program: ProgramSlot, channel: GuideChannel) => {
      const channelIndex = channels.findIndex((item) => item.id === channel.id);
      if (channelIndex >= 0) {
        setSelectedRow(channelIndex);
        setSelectedCol(program.start ?? currentSlotIndex);
      }
      openProgram(program, channel);
    },
    [channels, currentSlotIndex, openProgram]
  );

  const handleSelect = useCallback(() => {
    if (!selectedChannel) return;
    if (
      selectedChannel.id === GODMODE_CHANNEL_ID ||
      selectedChannel.number === GODMODE_CHANNEL_NUMBER
    ) {
      setPlayerOpen(false);
      sendRef.current?.({
        type: "now",
        channelId: selectedChannel.id,
        number: selectedChannel.number,
      });
      return;
    }
    if (
      selectedChannel.id === DEBUG_CHANNEL_ID ||
      selectedChannel.number === DEBUG_CHANNEL_NUMBER
    ) {
      setShowDebug((prev) => !prev);
      return;
    }
    const currentProgram = getProgramForChannel(selectedChannel);
    if (!currentProgram?.url) return;
    openProgram(currentProgram, selectedChannel);
  }, [selectedChannel, getProgramForChannel, openProgram]);

  const fetchIndex = useCallback(async () => {
    try {
      const res = await fetch("/api/index");
      if (!res.ok) {
        log.warn("index-fetch-status", { status: res.status });
        return;
      }
      const data = (await res.json()) as GuideIndex;
      if (data.channels?.length) {
        setIndexData(ensureSystemChannels(data));
      }
    } catch (error) {
      log.warn("index-fetch-failed", error);
    }
  }, []);

  const applyDisplaySettings = useCallback(
    (payload: {
      scale?: number | null;
      textScale?: number | null;
      hours?: number | null;
      theme?: string | null;
    }) => {
      setDisplaySettings((prev) => {
        const next: DisplaySettings = { ...prev };
        if (payload.scale === null) {
          delete next.scale;
        } else if (typeof payload.scale === "number") {
          next.scale = clamp(payload.scale, UI_SCALE_MIN, UI_SCALE_MAX);
        }
        if (payload.textScale === null) {
          delete next.textScale;
        } else if (typeof payload.textScale === "number") {
          next.textScale = clamp(
            payload.textScale,
            TEXT_SCALE_MIN,
            TEXT_SCALE_MAX
          );
        }
        if (payload.hours === null) {
          delete next.hours;
        } else if (typeof payload.hours === "number") {
          next.hours = clamp(payload.hours, 1, 6);
        }
        if (payload.theme === null) {
          delete next.theme;
        } else if (typeof payload.theme === "string") {
          if (THEME_MAP[payload.theme]) {
            next.theme = payload.theme;
          }
        }
        return next;
      });
    },
    []
  );

  const setMuted = useCallback((next?: boolean) => {
    setAudioSettings((prev) => {
      const currentMuted = prev.muted ?? false;
      const muted = typeof next === "boolean" ? next : !currentMuted;
      const baseVolume = Number.isFinite(prev.volume)
        ? prev.volume
        : AUDIO_VOLUME_DEFAULT;
      return {
        volume: clamp(baseVolume, 0, 1),
        muted,
      };
    });
  }, []);

  const adjustVolume = useCallback((dir: "up" | "down") => {
    setAudioSettings((prev) => {
      const baseVolume = Number.isFinite(prev.volume)
        ? prev.volume
        : AUDIO_VOLUME_DEFAULT;
      const delta = dir === "up" ? AUDIO_VOLUME_STEP : -AUDIO_VOLUME_STEP;
      const volume = clamp(baseVolume + delta, 0, 1);
      return {
        volume,
        muted: false,
      };
    });
  }, []);

  const { send, status } = useRemoteSocket((msg) => {
    if (msg.type === "display") {
      applyDisplaySettings(msg);
      return;
    }
    if (msg.type === "index") {
      if (viewMode === "guide") {
        void fetchIndex();
      }
      return;
    }
    if (msg.type === "volume") {
      if (viewMode !== "remote") {
        adjustVolume(msg.dir);
      }
      return;
    }
    if (msg.type === "mute") {
      if (viewMode !== "remote") {
        setMuted(msg.muted);
      }
      return;
    }
    if (viewMode === "remote") {
      if (msg.type === "app") {
        const nextAppId = msg.appId ?? "";
        if (requestedRemoteAppId) return;
        setActiveRemoteAppId(nextAppId);
      }
      if (msg.type === "dial") {
        if (msg.value) {
          showDialOverlay(
            msg.value,
            msg.committed ? DIAL_OVERLAY_COMMIT_MS : DIAL_OVERLAY_IDLE_MS
          );
        }
      }
      if (msg.type === "now") {
        setRemoteNowChannel({
          id: msg.channelId,
          number: msg.number,
          title: msg.title,
          url: msg.url,
        });
        const normalized = normalizeChannelNumber(msg.number ?? "");
        setRemoteGodmodeOpen(
          msg.channelId === GODMODE_CHANNEL_ID || normalized === 67
        );
      }
      return;
    }

    if (msg.type === "guide") {
      if (playerOpen) {
        setPlayerOpen(false);
        return;
      }
      if (viewMode !== "guide") {
        const returnRow = Number.isFinite(returnRowParam)
          ? Math.floor(returnRowParam)
          : null;
        const target = returnRow === null ? "/" : `/?r=${returnRow}`;
        window.location.assign(target);
      }
      return;
    }
    if (msg.type === "info") {
      if (playerOpen) {
        setShowPlayerHud((prev) => !prev);
      }
      return;
    }
    if (msg.type === "dial") {
      if (msg.value) {
        showDialOverlay(
          msg.value,
          msg.committed ? DIAL_OVERLAY_COMMIT_MS : DIAL_OVERLAY_IDLE_MS
        );
      }
      return;
    }
    if (msg.type === "tune") {
      if (viewMode === "guide") {
        handleTuneToNumber(msg.number);
      }
      return;
    }
    if (msg.type === "godselect") {
      if (viewMode === "guide") {
        const channel = channels.find((item) => item.id === msg.channelId);
        const program = channel?.schedule.find((slot) => slot.url === msg.url);
        if (channel && program) {
          handleGodmodePick(program, channel);
        }
      }
      return;
    }
    if (msg.type === "channel") {
      if (viewMode === "guide") {
        handleChannelChange(msg.dir);
      }
      return;
    }
    if (msg.type === "nav") {
      if (viewMode === "art") {
        const artItems =
          channels
            .find((channel) => channel.id === (channelId ?? "jensen-art"))
            ?.schedule.filter((slot) => slot.url) ?? [];
        if (msg.dir === "left" || msg.dir === "up") {
          setArtIndex((prev) => (prev - 1 + artItems.length) % artItems.length);
        } else if (msg.dir === "right" || msg.dir === "down") {
          setArtIndex((prev) => (prev + 1) % artItems.length);
        }
        return;
      }
      moveSelection(msg.dir);
    }
    if (msg.type === "select") {
      if (viewMode === "art") {
        setArtPaused((prev) => !prev);
      } else {
        handleSelect();
      }
    }
  });

  const { remoteControls, remoteControlsStatus, handleRemoteControl } =
    useRemoteControls({
      viewMode,
      activeRemoteAppId,
      send,
    });

  const handleDisplayChange = useCallback(
    (payload: DisplayTuningPayload) => {
      applyDisplaySettings(payload);
      send({ type: "display", ...payload });
    },
    [applyDisplaySettings, send]
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const commitDial = useCallback(
    (value: string) => {
      if (!value) return;
      const normalized = normalizeChannelNumber(value);
      if (normalized === 67) {
        setRemoteGodmodeOpen(true);
      } else {
        setRemoteGodmodeOpen(false);
      }
      send({ type: "dial", value, committed: true });
      showDialOverlay(value, DIAL_OVERLAY_COMMIT_MS);
      send({ type: "tune", number: value });
      setDialBuffer("");
    },
    [send, showDialOverlay]
  );

  const pushDialDigit = useCallback((digit: number) => {
    setDialBuffer((prev) => {
      const next = `${prev}${digit}`.slice(-3);
      return next;
    });
  }, []);

  useEffect(() => {
    if (viewMode !== "remote") {
      setDialBuffer("");
      setRemoteGodmodeOpen(false);
      setRemoteNowChannel(null);
      setGodmodeQuery("");
      return;
    }
    if (!dialBuffer) return;
    if (dialTimeoutRef.current) {
      window.clearTimeout(dialTimeoutRef.current);
    }
    send({ type: "dial", value: dialBuffer });
    showDialOverlay(dialBuffer, DIAL_OVERLAY_IDLE_MS);
    if (dialBuffer.length >= 3) {
      commitDial(dialBuffer);
      return;
    }
    dialTimeoutRef.current = window.setTimeout(() => {
      commitDial(dialBuffer);
    }, 700);
    return () => {
      if (dialTimeoutRef.current) {
        window.clearTimeout(dialTimeoutRef.current);
      }
    };
  }, [dialBuffer, commitDial, viewMode, send, showDialOverlay]);

  const gridStyle = useMemo(
    () =>
      ({
        "--slots": Math.min(slotCount, visibleSlotCount),
        "--row-height": `${ROW_HEIGHT * uiScale}px`,
        "--row-gap": `${ROW_GAP * uiScale}px`,
        "--ui-scale": uiScale,
        "--text-scale": textScale,
        ...themeVars,
      } as CSSProperties),
    [slotCount, visibleSlotCount, uiScale, textScale, themeVars]
  );

  useEffect(() => {
    if (viewMode === "remote") {
      document.documentElement.style.fontSize = "";
      return;
    }
    document.documentElement.style.fontSize = `${16 * textScale}px`;
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [viewMode, textScale]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      const payload: DisplaySettings = {};
      if (displaySettings.scale !== undefined) {
        payload.scale = displaySettings.scale;
      }
      if (displaySettings.textScale !== undefined) {
        payload.textScale = displaySettings.textScale;
      }
      if (displaySettings.hours !== undefined) {
        payload.hours = displaySettings.hours;
      }
      if (displaySettings.theme !== undefined) {
        payload.theme = displaySettings.theme;
      }
      window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [displaySettings]);

  useEffect(() => {
    if (!screenParam) return;
    setScreenId(screenParam);
    try {
      window.localStorage.setItem("chiba:screen", screenParam);
    } catch {
      // ignore
    }
  }, [screenParam]);

  useEffect(() => {
    if (!themeParam) return;
    if (THEME_MAP[themeParam]) {
      setDisplaySettings((prev) => ({ ...prev, theme: themeParam }));
    }
  }, [themeParam]);

  useEffect(() => {
    const prev = prevViewModeRef.current;
    if (viewMode === "guide" && prev !== "guide") {
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      const maxStart = Math.max(0, slotCount - visibleSlotCount);
      setVisibleStartSlot(clamp(currentSlotIndex, 0, maxStart));
      setSelectedCol(currentSlotIndex);
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode, currentSlotIndex, slotCount, visibleSlotCount]);

  useEffect(() => {
    if (!playerOpen && prevPlayerOpenRef.current) {
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      log.info("player-close", {
        url: playerUrl,
        kind: playerKind,
        retained: Boolean(playerUrl),
        viewMode,
      });
    } else if (playerOpen && !prevPlayerOpenRef.current) {
      log.info("player-open", { url: playerUrl, kind: playerKind, viewMode });
    }
    prevPlayerOpenRef.current = playerOpen;
  }, [playerOpen, playerUrl, playerKind, viewMode]);

  useEffect(() => {
    if (!showDebug) return;
    type MemoryInfo = {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
    const update = () => {
      const memory = (performance as Performance & { memory?: MemoryInfo })
        .memory;
      if (!memory) {
        setMemoryStats(null);
        return;
      }
      setMemoryStats({
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        limit: memory.jsHeapSizeLimit,
      });
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [showDebug]);

  useEffect(() => {
    if (!showDebug) {
      setMediaStats(null);
      return;
    }
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/debug/media");
        if (!res.ok) {
          log.warn("media-stats-status", { status: res.status });
          return;
        }
        const data = (await res.json()) as MediaDebugStats;
        if (!cancelled) {
          setMediaStats(data);
        }
      } catch (error) {
        log.warn("media-stats-failed", error);
      }
    };
    void fetchStats();
    const interval = window.setInterval(fetchStats, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [showDebug]);

  useEffect(() => {
    if (!prevPausedRef.current && isPaused) {
      const bounds = getScrollBounds();
      if (!bounds) return;
      const anchor = Math.floor(visibleRows / 2);
      const desired = clamp(
        selectedRow - anchor,
        0,
        Math.max(0, channels.length - visibleRows)
      );
      applyScrollOffset(clamp(desired * bounds.stride, 0, bounds.maxScroll));
      lastFrameRef.current = null;
      prevPausedRef.current = true;
      return;
    }
    if (prevPausedRef.current && !isPaused) {
      const bounds = getScrollBounds();
      if (!bounds) return;
      const anchor = Math.floor(visibleRows / 2);
      const desired = clamp(
        selectedRow - anchor,
        0,
        Math.max(0, channels.length - visibleRows)
      );
      applyScrollOffset(clamp(desired * bounds.stride, 0, bounds.maxScroll));
      lastFrameRef.current = null;
      prevPausedRef.current = false;
      return;
    }
    prevPausedRef.current = isPaused;
  }, [
    isPaused,
    channels.length,
    selectedRow,
    visibleRows,
    getScrollBounds,
    applyScrollOffset,
  ]);

  useEffect(() => {
    if (viewMode !== "guide") return;
    if (!channels.length) return;
    if (!Number.isFinite(returnRowParam)) return;
    const targetRow = clamp(Math.floor(returnRowParam), 0, channels.length - 1);
    setSelectedRow(targetRow);
    setSelectedCol(currentSlotIndex);
    pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
  }, [viewMode, channels.length, returnRowParam, currentSlotIndex]);

  useEffect(() => {
    if (!channels.length) return;
    setSelectedRow((prev) => clamp(prev, 0, channels.length - 1));
    setSelectedCol((prev) =>
      clamp(Math.max(prev, currentSlotIndex), 0, Math.max(0, slotCount - 1))
    );
  }, [channels.length, slotCount, currentSlotIndex]);

  useEffect(() => {
    const maxStart = Math.max(0, slotCount - visibleSlotCount);
    setVisibleStartSlot((prev) => clamp(prev, 0, maxStart));
  }, [slotCount, visibleSlotCount]);

  useEffect(() => {
    if (viewMode !== "guide") {
      lastCurrentSlotRef.current = currentSlotIndex;
      return;
    }
    const prevSlot = lastCurrentSlotRef.current;
    if (currentSlotIndex !== prevSlot && selectedCol <= prevSlot) {
      setSelectedCol(currentSlotIndex);
    }
    lastCurrentSlotRef.current = currentSlotIndex;
  }, [viewMode, currentSlotIndex, selectedCol]);

  useEffect(() => {
    if (viewMode !== "guide") return;
    if (selectedCol !== currentSlotIndex) return;
    const maxStart = Math.max(0, slotCount - visibleSlotCount);
    const minStart = Math.min(currentSlotIndex, maxStart);
    setVisibleStartSlot(clamp(currentSlotIndex, minStart, maxStart));
  }, [viewMode, currentSlotIndex, selectedCol, slotCount, visibleSlotCount]);

  useEffect(() => {
    const maxStart = Math.max(0, slotCount - visibleSlotCount);
    const minStart = Math.min(currentSlotIndex, maxStart);
    if (selectedCol < visibleStartSlot) {
      setVisibleStartSlot(clamp(selectedCol, minStart, maxStart));
    } else if (selectedCol >= visibleStartSlot + visibleSlotCount) {
      setVisibleStartSlot(
        clamp(selectedCol - visibleSlotCount + 1, minStart, maxStart)
      );
    }
  }, [
    selectedCol,
    visibleStartSlot,
    visibleSlotCount,
    slotCount,
    currentSlotIndex,
  ]);

  useEffect(() => {
    void fetchIndex();
    const interval = window.setInterval(() => {
      void fetchIndex();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [fetchIndex]);

  useEffect(() => {
    const updateRows = () => {
      const metrics = getViewportMetrics();
      const height = viewportRef.current?.clientHeight ?? 0;
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
      if (!height || !metrics) return;
      if (!Number.isFinite(metrics.stride) || metrics.stride <= 0) return;
      const rows = Math.max(
        1,
        Math.floor((metrics.innerHeight + metrics.gap) / metrics.stride)
      );
      setVisibleRows(rows);
      log.debug("rows-update", {
        height,
        available: metrics.innerHeight,
        paddingY: metrics.paddingY,
        stride: metrics.stride,
        gap: metrics.gap,
        contentHeight: metrics.contentHeight,
        rows,
        uiScale,
      });
    };
    updateRows();
    window.addEventListener("resize", updateRows);
    return () => window.removeEventListener("resize", updateRows);
  }, [getViewportMetrics, uiScale]);

  useEffect(() => {
    const bounds = getScrollBounds();
    if (!bounds || channels.length <= visibleRows || bounds.maxScroll <= 0) {
      applyScrollOffset(0);
      autoHoldUntilRef.current = 0;
      autoResetPendingRef.current = false;
      return;
    }
    const maxScroll = bounds.maxScroll;
    autoHoldUntilRef.current = 0;
    autoResetPendingRef.current = false;

    const tick = (time: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = time;
      const delta = time - lastFrameRef.current;
      lastFrameRef.current = time;

      const nowMs = Date.now();
      if (nowMs >= pauseUntilRef.current) {
        let next = scrollOffsetRef.current;
        if (autoHoldUntilRef.current > nowMs) {
          // hold
        } else if (autoResetPendingRef.current) {
          autoResetPendingRef.current = false;
          autoHoldUntilRef.current = nowMs + AUTO_SCROLL_END_HOLD_MS;
          next = 0;
        } else if (next >= maxScroll) {
          autoResetPendingRef.current = true;
          autoHoldUntilRef.current = nowMs + AUTO_SCROLL_END_HOLD_MS;
          next = maxScroll;
        } else {
          const candidate = next + (AUTO_SCROLL_PX_PER_SEC * delta) / 1000;
          if (candidate >= maxScroll) {
            autoResetPendingRef.current = true;
            autoHoldUntilRef.current = nowMs + AUTO_SCROLL_END_HOLD_MS;
            next = maxScroll;
          } else {
            next = candidate;
          }
        }
        if (next !== scrollOffsetRef.current) {
          applyScrollOffset(next);
        }
      }

      requestAnimationFrame(tick);
    };

    const raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastFrameRef.current = null;
    };
  }, [channels.length, visibleRows, getScrollBounds, applyScrollOffset]);

  useEffect(() => {
    if (Date.now() < pauseUntilRef.current) {
      const bounds = getScrollBounds();
      if (!bounds) return;
      const anchor = Math.floor(visibleRows / 2);
      const desired = clamp(
        selectedRow - anchor,
        0,
        Math.max(0, channels.length - visibleRows)
      );
      applyScrollOffset(clamp(desired * bounds.stride, 0, bounds.maxScroll));
    }
  }, [
    channels.length,
    selectedRow,
    visibleRows,
    getScrollBounds,
    applyScrollOffset,
  ]);

  useEffect(() => {
    if (viewMode !== "art") return;
    if (artPaused) return;
    const artItems =
      channels
        .find((channel) => channel.id === (channelId ?? "jensen-art"))
        ?.schedule.filter((slot) => slot.url) ?? [];
    const item = artItems[artIndex];
    const duration = (item?.durationSec ?? 90) * 1000;
    const timer = window.setTimeout(() => {
      setArtIndex((prev) => (prev + 1) % Math.max(1, artItems.length));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [artIndex, artPaused, viewMode, channels, channelId]);

  useEffect(() => {
    if (viewMode !== "art") return;
    const raw = Number(params.get(PARAM_ART_INDEX) ?? "");
    if (!Number.isFinite(raw)) return;
    const artItems =
      channels
        .find((channel) => channel.id === (channelId ?? "jensen-art"))
        ?.schedule.filter((slot) => slot.url) ?? [];
    const safeIndex = Math.max(0, raw % Math.max(1, artItems.length));
    setArtIndex(safeIndex);
  }, [viewMode, channelId, channels, params]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.closest("input, textarea, select") ||
          target.closest('[contenteditable="true"]') ||
          target.closest('[contenteditable=""]'))
      ) {
        return;
      }
      const key = event.key;
      const code = event.code;
      const channelUp =
        key === "PageUp" ||
        key === "[" ||
        key === "{" ||
        key === "ChannelUp" ||
        code === "BracketLeft";
      const channelDown =
        key === "PageDown" ||
        key === "]" ||
        key === "}" ||
        key === "ChannelDown" ||
        code === "BracketRight";
      if (key === "q" || key === "Q") {
        setShowQr((prev) => !prev);
        return;
      }
      if (key === "d" || key === "D") {
        setShowDebug((prev) => !prev);
        return;
      }
      if (viewMode !== "remote" && (key === "m" || key === "M")) {
        event.preventDefault();
        setMuted();
        return;
      }
      const volumeUp = key === "+" || key === "=";
      const volumeDown = key === "-" || key === "_";
      if (viewMode !== "remote" && (volumeUp || volumeDown)) {
        event.preventDefault();
        adjustVolume(volumeUp ? "up" : "down");
        return;
      }
      if (playerOpen && (key === "i" || key === "I")) {
        setShowPlayerHud((prev) => !prev);
        return;
      }
      if (viewMode === "guide" && playerOpen && (channelUp || channelDown)) {
        event.preventDefault();
        handleChannelChange(channelUp ? "up" : "down");
        return;
      }
      if (
        viewMode === "guide" &&
        playerOpen &&
        (key === "Escape" || key === "Backspace")
      ) {
        setPlayerOpen(false);
        return;
      }
      if (viewMode === "guide") {
        if (channelUp) {
          event.preventDefault();
          moveSelection("up");
          return;
        }
        if (channelDown) {
          event.preventDefault();
          moveSelection("down");
          return;
        }
      }
      if (viewMode === "art") {
        if (key === " ") {
          setArtPaused((prev) => !prev);
        }
        if (key === "ArrowLeft" || key === "ArrowUp") {
          const artItems =
            channels
              .find((channel) => channel.id === (channelId ?? "jensen-art"))
              ?.schedule.filter((slot) => slot.url) ?? [];
          setArtIndex((prev) => (prev - 1 + artItems.length) % artItems.length);
        }
        if (key === "ArrowRight" || key === "ArrowDown") {
          const artItems =
            channels
              .find((channel) => channel.id === (channelId ?? "jensen-art"))
              ?.schedule.filter((slot) => slot.url) ?? [];
          setArtIndex((prev) => (prev + 1) % artItems.length);
        }
        return;
      }
      if (key === "Enter") {
        handleSelect();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key))
        return;

      const map: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      moveSelection(map[key]);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    adjustVolume,
    moveSelection,
    viewMode,
    channels,
    channelId,
    handleSelect,
    playerOpen,
    handleChannelChange,
    setMuted,
  ]);

  const progressValue = useMemo(() => {
    if (!selectedProgram) return 0;
    const parts = indexData.startTime.split(":");
    const startHour = Number.parseInt(parts[0] ?? "", 10);
    const startMinute = Number.parseInt(parts[1] ?? "", 10);
    if (!Number.isFinite(startHour) || !Number.isFinite(startMinute)) return 0;
    const scheduleStart = new Date(now);
    scheduleStart.setHours(startHour, startMinute, 0, 0);
    const programStartMs =
      scheduleStart.getTime() +
      selectedProgram.start * indexData.slotMinutes * 60 * 1000;
    const durationMs =
      Math.max(1, selectedProgram.span) * indexData.slotMinutes * 60 * 1000;
    const elapsed = now.getTime() - programStartMs;
    const ratio = clamp(elapsed / durationMs, 0, 1);
    return ratio * 100;
  }, [now, selectedProgram, indexData.startTime, indexData.slotMinutes]);

  const hostOverride = params.get(PARAM_REMOTE_HOST);
  const forceHttps = params.get(PARAM_REMOTE_HTTPS) === "1";
  const metaRemote =
    document.querySelector<HTMLMetaElement>('meta[name="remote-url"]')
      ?.content ?? "";
  const [remoteOverride, setRemoteOverride] = useState<{
    baseUrl: string;
    remoteUrl: string;
    qrUrl: string;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    const guidePort =
      window.location.port && window.location.port.length > 0
        ? window.location.port
        : window.location.protocol === "https:"
        ? "443"
        : "80";
    const scheme = window.location.protocol.replace(":", "");
    fetch(`/api/remote?guide_port=${guidePort}&scheme=${scheme}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data?.baseUrl || !data?.qrUrl) return;
        setRemoteOverride({
          baseUrl: data.baseUrl as string,
          remoteUrl: data.remoteUrl as string,
          qrUrl: data.qrUrl as string,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const { qrUrl } = buildRemoteUrls({
    hostOverride,
    forceHttps,
    metaRemote: remoteOverride?.baseUrl ?? metaRemote,
  });
  const qrImageUrl = remoteOverride?.qrUrl ?? qrUrl;

  useEffect(() => {
    if (viewMode !== "guide") return;
    const nextAppId = playerOpen ? activeAppId : null;
    if (lastAppMessageRef.current === nextAppId) return;
    lastAppMessageRef.current = nextAppId;
    send({ type: "app", appId: nextAppId });
  }, [viewMode, playerOpen, activeAppId, send]);

  useEffect(() => {
    const bounds = getScrollBounds();
    log.debug("scroll-metrics", {
      channels: channels.length,
      visibleRows,
      uiScale,
      maxScroll: bounds?.maxScroll ?? null,
      contentHeight: bounds?.contentHeight ?? null,
      innerHeight: bounds?.innerHeight ?? null,
    });
  }, [channels.length, visibleRows, uiScale, getScrollBounds]);
  const hasAppControls = Boolean(activeRemoteAppId);
  const showAppPanel = hasAppControls && remotePanel === "app";
  const showGodPanel = remoteGodmodeOpen;
  useEffect(() => {
    if (!showGodPanel) {
      setGodmodeQuery("");
    }
  }, [showGodPanel]);
  const isRemoteDebug =
    remoteNowChannel?.id === DEBUG_CHANNEL_ID ||
    normalizeChannelNumber(remoteNowChannel?.number ?? "") ===
      normalizeChannelNumber(DEBUG_CHANNEL_NUMBER);
  const handleLocalDisplayChange = useCallback(
    (payload: DisplayTuningPayload) => {
      applyDisplaySettings(payload);
    },
    [applyDisplaySettings]
  );
  const displayTuningOverlay =
    viewMode !== "remote" && showDebug ? (
      <DisplayTuningPanel
        className="remote-display"
        floating
        uiScale={uiScale}
        textScale={textScale}
        visibleHours={visibleHours}
        activeThemeId={activeThemeId}
        onChange={handleLocalDisplayChange}
      />
    ) : null;
  const splashOverlay =
    shouldSplash && viewMode === "guide" ? (
      <SplashScreen active={showSplash} />
    ) : null;

  if (viewMode === "remote") {
    return (
      <RemoteView
        status={status}
        uiScale={uiScale}
        textScale={textScale}
        visibleHours={visibleHours}
        activeThemeId={activeThemeId}
        onDisplayChange={handleDisplayChange}
        send={send}
        isRemoteDebug={isRemoteDebug}
        showGodPanel={showGodPanel}
        setRemoteGodmodeOpen={setRemoteGodmodeOpen}
        filteredGodmodeItems={filteredGodmodeItems}
        godmodeQuery={godmodeQuery}
        setGodmodeQuery={setGodmodeQuery}
        setDialBuffer={setDialBuffer}
        showAppPanel={showAppPanel}
        hasAppControls={hasAppControls}
        remoteControlsStatus={remoteControlsStatus}
        remoteControls={remoteControls}
        handleRemoteControl={handleRemoteControl}
        setRemotePanel={setRemotePanel}
        pushDialDigit={pushDialDigit}
        showDebug={showDebug}
        memoryStats={memoryStats}
        mediaStats={mediaStats}
        dialOverlay={dialOverlay}
      />
    );
  }

  if (viewMode === "art") {
    return (
      <>
        <ArtView
          channels={channels}
          channelId={channelId}
          artIndex={artIndex}
          artPaused={artPaused}
          showDebug={showDebug}
          memoryStats={memoryStats}
          mediaStats={mediaStats}
          dialOverlay={dialOverlay}
          masterVolume={masterVolume}
          masterMuted={masterMuted}
          showVolumeHud={showVolumeHud}
        />
        {displayTuningOverlay}
      </>
    );
  }

  return (
    <>
      <GuideView
        gridStyle={gridStyle}
        now={now}
        selectedChannel={selectedChannel}
        selectedProgram={selectedProgram}
        playerOpen={playerOpen}
        playerReady={playerReady}
        hasPreviewMedia={hasPreviewMedia}
        posterImageReady={posterImageReady}
        setPosterImageReady={setPosterImageReady}
        previewContainerRef={previewContainerRef}
        progressValue={progressValue}
        indexData={indexData}
        visibleStartSlot={visibleStartSlot}
        visibleSlotCount={visibleSlotCount}
        slotCount={slotCount}
        selectedCol={selectedCol}
        currentSlotIndex={currentSlotIndex}
        channels={channels}
        activeRow={activeRow}
        isPaused={isPaused}
        viewportRef={viewportRef}
        rowsRef={rowsRef}
        onSelectRow={setSelectedRow}
        onSelectCol={setSelectedCol}
        onOpenProgram={openProgram}
        onToggleDebug={() => setShowDebug((prev) => !prev)}
        showQr={showQr}
        qrUrl={qrImageUrl}
        playerUrl={playerUrl}
        playerKind={playerKind}
        playerMeta={playerMeta}
        showPlayerHud={showPlayerHud}
        ambientAudio={ambientAudio}
        masterVolume={masterVolume}
        masterMuted={masterMuted}
        showVolumeHud={showVolumeHud}
        setPlayerReady={setPlayerReady}
        showDebug={showDebug}
        memoryStats={memoryStats}
        mediaStats={mediaStats}
        dialOverlay={dialOverlay}
      />
      {displayTuningOverlay}
      {splashOverlay}
    </>
  );
}

export default App;
