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
  PARAM_GALLERY,
  PARAM_GALLERY_CHANNEL_KEYS,
  PARAM_HUD_MODE,
  PARAM_HUD_SEC_KEYS,
  PARAM_PLAYLIST,
  PARAM_HOURS,
  PARAM_LOCK_KEYS,
  PARAM_MUTE_KEYS,
  PARAM_NO_SPLASH,
  PARAM_QR_KEYS,
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
import { buildQrUrl, buildRemoteUrls } from "./lib/remote";
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
import { useArtViewStore } from "./store/useArtViewStore";
import { useGuideViewStore } from "./store/useGuideViewStore";
import { useRemoteViewStore } from "./store/useRemoteViewStore";
import type {
  DisplaySettings,
  GuideChannel,
  GuideIndex,
  MediaDebugStats,
  PlayerMeta,
  ProgramSlot,
  AudioSettings,
  RemoteMessage,
  RemoteRegistration,
  ViewMode,
} from "./types/guide";

const log = createLogger("guide-app");

const REMOTE_CURSOR_HIDE_MS = 2200;
const REMOTE_MOUSE_SENSITIVITY = 1.25;

type RemoteCursorState = {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
};

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
  const galleryParam = params.get(PARAM_GALLERY);
  const pinnedChannelParam = getFirstParam(params, PARAM_GALLERY_CHANNEL_KEYS);
  const lockParam = getFirstParam(params, PARAM_LOCK_KEYS);
  const qrParam = getFirstParam(params, PARAM_QR_KEYS);
  const hudModeParam = params.get(PARAM_HUD_MODE);
  const hudSecParam = getFirstParam(params, PARAM_HUD_SEC_KEYS);
  const galleryEnabled = parseBooleanParam(galleryParam) === true;
  const playlistEnabled = parseBooleanParam(params.get(PARAM_PLAYLIST)) === true;
  const channelLocked =
    parseBooleanParam(lockParam) ?? (galleryEnabled ? true : false);
  const qrForced = parseBooleanParam(qrParam);
  // Default to hiding the Remote QR in gallery/kiosk installs unless explicitly enabled.
  const qrAllowed = qrForced === null ? (galleryEnabled ? false : true) : qrForced;
  const qrLockedOff = qrAllowed === false;

  const hudModeOverride = useMemo(() => {
    const raw = (hudModeParam ?? "").trim().toLowerCase();
    if (raw === "always" || raw === "start" || raw === "never") return raw;
    return null;
  }, [hudModeParam]);
  const hudShowSecOverride = useMemo(() => {
    if (!hudSecParam) return null;
    const n = Number(hudSecParam);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }, [hudSecParam]);
  const [, setScreenId] = useState(() =>
    screenParam ? screenParam : loadScreenId()
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() =>
    loadDisplaySettings()
  );
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => {
    const base = loadAudioSettings();
    const forcedMuted = parseBooleanParam(muteParam);
    if (forcedMuted !== null) return { ...base, muted: forcedMuted };
    // Default to muted in gallery/kiosk mode so autoplay works reliably
    // across Chromium builds and without user gestures.
    if (galleryEnabled) return { ...base, muted: true };
    return base;
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
  const pinnedChannel = useMemo(() => {
    const raw = (pinnedChannelParam ?? "").trim();
    if (!raw) return null;
    const maybeNumber = normalizeChannelNumber(raw);
    if (maybeNumber !== null) {
      return (
        allChannels.find(
          (channel) => normalizeChannelNumber(channel.number) === maybeNumber
        ) ?? null
      );
    }
    return allChannels.find((channel) => channel.id === raw) ?? null;
  }, [allChannels, pinnedChannelParam]);
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
  const [showQr, setShowQr] = useState(() => qrAllowed);
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
  const [remoteRegistrations, setRemoteRegistrations] = useState<
    RemoteRegistration[]
  >([]);
  const [remotePanel, setRemotePanel] = useState<"remote" | "app" | "input">(
    "remote"
  );
  const [remoteCursor, setRemoteCursor] = useState<RemoteCursorState>({
    x: 0.5,
    y: 0.5,
    visible: false,
    pressed: false,
  });
  const [micEnabled, setMicEnabled] = useState(false);
  const [micStatus, setMicStatus] = useState<
    "idle" | "requesting" | "connecting" | "live" | "error"
  >("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [micIncomingStatus, setMicIncomingStatus] = useState<
    "idle" | "connecting" | "live"
  >("idle");

  const setRemoteViewState = useRemoteViewStore(
    (state) => state.setRemoteViewState
  );
  const setRemoteViewHandlers = useRemoteViewStore(
    (state) => state.setRemoteViewHandlers
  );
  const setGuideViewState = useGuideViewStore(
    (state) => state.setGuideViewState
  );
  const setGuideViewHandlers = useGuideViewStore(
    (state) => state.setGuideViewHandlers
  );
  const setArtViewState = useArtViewStore((state) => state.setArtViewState);

  const pauseUntilRef = useRef(0);
  const didGalleryAutoplayRef = useRef(false);
  const galleryAutoplayTargetRef = useRef<string | null>(null);
  const pinWaitUntilRef = useRef<number | null>(null);
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
  const micRemotePeerRef = useRef<RTCPeerConnection | null>(null);
  const micRemoteStreamRef = useRef<MediaStream | null>(null);
  const micRemoteSessionRef = useRef<string | null>(null);
  const micGuidePeerRef = useRef<RTCPeerConnection | null>(null);
  const micGuideSessionRef = useRef<string | null>(null);
  const micGuideStreamRef = useRef<MediaStream | null>(null);
  const micAudioRef = useRef<HTMLAudioElement | null>(null);
  const playerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const playerUrlRef = useRef<string | null>(null);
  const hudHideTimerRef = useRef<number | null>(null);
  const remoteCursorRef = useRef<RemoteCursorState>(remoteCursor);
  const remoteCursorRafRef = useRef<number | null>(null);
  const remoteCursorHideRef = useRef<number | null>(null);
  const remoteCursorPressRef = useRef<number | null>(null);
  const remotePointerTargetRef = useRef<{
    target: HTMLElement | null;
    doc: Document | null;
  } | null>(null);

  useEffect(() => {
    playerUrlRef.current = playerUrl;
  }, [playerUrl]);

  useEffect(() => {
    // If a pinned channel was requested, wait briefly for the real index to load
    // instead of autoplaying fallback content (common in dev).
    const raw = (pinnedChannelParam ?? "").trim();
    const pinRequested = raw.length > 0;
    if (!galleryEnabled || !pinRequested) return;
    if (pinWaitUntilRef.current !== null) return;
    pinWaitUntilRef.current = Date.now() + 4000;
  }, [galleryEnabled, pinnedChannelParam]);

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
      if (channelLocked && viewMode === "guide") return;
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
    [channelLocked, channels, currentSlotIndex, selectedRow, viewMode]
  );

  const [isPaused, setIsPaused] = useState(false);
  useEffect(() => {
    const check = () => {
      setIsPaused(Date.now() < pauseUntilRef.current);
    };
    check();
    const interval = window.setInterval(check, 100);
    return () => window.clearInterval(interval);
  }, [channelLocked, galleryEnabled]);
  const activeRow = selectedRow;

  const selectedChannel = channels[activeRow];
  const selectedProgram =
    selectedChannel?.schedule.find(
      (slot) => selectedCol >= slot.start && selectedCol <= slot.end
    ) ??
    selectedChannel?.schedule[0] ??
    null;

  const galleryPlaylist = useMemo(() => {
    if (!galleryEnabled || !playlistEnabled) return [];
    const targetChannel = pinnedChannel ?? selectedChannel ?? channels[0] ?? null;
    if (!targetChannel) return [];
    const items = targetChannel.schedule.filter((slot) => Boolean(slot.url));
    const uniq: ProgramSlot[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.url) continue;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      uniq.push(item);
    }
    return uniq;
  }, [galleryEnabled, playlistEnabled, pinnedChannel, selectedChannel, channels]);

  const [galleryPlaylistIndex, setGalleryPlaylistIndex] = useState(0);
  const stashPrefetchRef = useRef<{ at: number; forUrl: string; nextUrl: string } | null>(null);
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
  const activeProgramRemoteControls = useMemo(
    () => (playerOpen ? selectedProgram?.remoteControls ?? [] : []),
    [playerOpen, selectedProgram]
  );
  const effectiveRemoteControls =
    viewMode === "remote" ? remoteRegistrations : activeProgramRemoteControls;
  const effectiveRemoteAppId =
    viewMode === "remote"
      ? requestedRemoteAppId || activeRemoteAppId
      : activeAppId;
  const hasKeyboardMouse = effectiveRemoteControls.includes("keyboard_mouse");
  const hasMicControls = effectiveRemoteControls.includes("mic");
  const hasAppControls =
    Boolean(effectiveRemoteAppId) &&
    (effectiveRemoteControls.includes("app") || Boolean(requestedRemoteAppId));
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
      if (hudHideTimerRef.current) {
        window.clearTimeout(hudHideTimerRef.current);
        hudHideTimerRef.current = null;
      }

      const rawHudShowSec = hudShowSecOverride ?? program.hudShowSec ?? 0;
      const hudShowSec =
        typeof rawHudShowSec === "number" && rawHudShowSec > 0
          ? rawHudShowSec
          : 0;
      const hudMode =
        hudModeOverride ??
        program.hudMode ??
        (hudShowSec > 0 ? "start" : null);

      if (hudMode === "always") {
        setShowPlayerHud(true);
      } else if (hudMode === "never") {
        setShowPlayerHud(false);
      } else if (hudMode === "start" && hudShowSec > 0) {
        setShowPlayerHud(true);
        const urlKey = programUrl;
        hudHideTimerRef.current = window.setTimeout(() => {
          if (playerUrlRef.current === urlKey) {
            setShowPlayerHud(false);
          }
        }, Math.round(hudShowSec * 1000));
      } else {
        setShowPlayerHud(false);
      }
      const channelIndex = channels.findIndex((item) => item.id === channel.id);
      setPlayerChannelIndex(channelIndex >= 0 ? channelIndex : activeRow);
      setPlayerMeta({
        title: program.infoTitle ?? program.title,
        subtitle: program.subtitle,
        artist: program.artist,
        description: program.description,
        hudShowSec,
        hudMode: hudMode ?? undefined,
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
    [decorateProgramUrl, playerUrl, channels, activeRow, hudModeOverride, hudShowSecOverride]
  );

  const handleChannelChange = useCallback(
    (dir: "up" | "down") => {
      if (channelLocked) return;
      if (!channels.length) return;
      if (showDebug) {
        setShowDebug(false);
      }
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
      channelLocked,
      channels,
      activeRow,
      currentSlotIndex,
      openProgram,
      getProgramForChannel,
      showDialOverlay,
      showDebug,
    ]
  );

  const handleTuneToNumber = useCallback(
    (value: string) => {
      if (channelLocked) return;
      const targetNumber = normalizeChannelNumber(value);
      if (targetNumber === null) return;
      if (targetNumber === normalizeChannelNumber(GODMODE_CHANNEL_NUMBER)) {
        setShowDebug(false);
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
      if (showDebug) {
        setShowDebug(false);
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
    [
      allChannels,
      channelLocked,
      channels,
      currentSlotIndex,
      getProgramForChannel,
      openProgram,
      showDebug,
    ]
  );

  const handleGodmodePick = useCallback(
    (program: ProgramSlot, channel: GuideChannel) => {
      if (channelLocked) return;
      const channelIndex = channels.findIndex((item) => item.id === channel.id);
      if (channelIndex >= 0) {
        setSelectedRow(channelIndex);
        setSelectedCol(program.start ?? currentSlotIndex);
      }
      openProgram(program, channel);
    },
    [channelLocked, channels, currentSlotIndex, openProgram]
  );

  const handleSelect = useCallback(() => {
    if (channelLocked) return;
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
  }, [channelLocked, selectedChannel, getProgramForChannel, openProgram]);

  const galleryAdvanceCooldownRef = useRef(0);
  const advanceGalleryPlaylist = useCallback(
    (reason: string) => {
      if (!galleryEnabled || !playlistEnabled) return;
      if (viewMode !== "guide") return;
      // Avoid tight error loops if the stash cache is cold or the NAS is down.
      // (Video elements can emit multiple errors very quickly for the same URL.)
      const nowMs = Date.now();
      const minGapMs = reason === "error" ? 750 : 150;
      if (nowMs - galleryAdvanceCooldownRef.current < minGapMs) return;
      galleryAdvanceCooldownRef.current = nowMs;
      const targetChannel = pinnedChannel ?? selectedChannel ?? channels[0] ?? null;
      if (!targetChannel) return;
      if (!galleryPlaylist.length) return;
      setGalleryPlaylistIndex((prev) => {
        const next = (prev + 1) % Math.max(1, galleryPlaylist.length);
        const program = galleryPlaylist[next];
        if (program?.url) {
          openProgram(program, targetChannel);
          log.info("gallery-playlist-advance", { reason, next, url: program.url });
        }
        return next;
      });
    },
    [
      galleryEnabled,
      playlistEnabled,
      viewMode,
      pinnedChannel,
      selectedChannel,
      channels,
      galleryPlaylist.length,
      openProgram,
    ]
  );

  useEffect(() => {
    if (!galleryEnabled) return;
    if (viewMode !== "guide") return;
    if (!channels.length) return;

    const pinRequested = (pinnedChannelParam ?? "").trim().length > 0;
    if (pinRequested && !pinnedChannel) {
      const waitUntil = pinWaitUntilRef.current;
      if (typeof waitUntil === "number" && Date.now() < waitUntil) {
        return;
      }
    }

    const targetChannel = pinnedChannel ?? selectedChannel ?? channels[0] ?? null;
    if (!targetChannel) return;

    // One-shot per target channel id (lets us retune when pinned channel
    // becomes available after the initial fallback index).
    if (galleryAutoplayTargetRef.current === targetChannel.id) return;
    galleryAutoplayTargetRef.current = targetChannel.id;

    didGalleryAutoplayRef.current = true;

    const visibleIndex = channels.findIndex(
      (channel) => channel.id === targetChannel.id
    );
    if (visibleIndex >= 0) {
      setSelectedRow(visibleIndex);
    }
    setSelectedCol(currentSlotIndex);
    pauseUntilRef.current = Date.now() + USER_PAUSE_MS;

    const program =
      playlistEnabled && galleryPlaylist.length
        ? galleryPlaylist[Math.max(0, galleryPlaylistIndex) % galleryPlaylist.length]
        : getProgramForChannel(targetChannel);
    if (program?.url) {
      openProgram(program, targetChannel);
    }
  }, [
    channels,
    currentSlotIndex,
    galleryEnabled,
    getProgramForChannel,
    openProgram,
    pinnedChannel,
    pinnedChannelParam,
    selectedChannel,
    viewMode,
    playlistEnabled,
    galleryPlaylist,
    galleryPlaylistIndex,
  ]);

  useEffect(() => {
    // Playlist lookahead: while one item is playing, warm the next stash item
    // so we don't stall/skip on cache misses.
    if (!galleryEnabled || !playlistEnabled) return;
    if (!playerOpen || !playerUrl) return;
    if (viewMode !== "guide") return;
    if (!galleryPlaylist.length) return;

    const currentIdx = galleryPlaylist.findIndex((slot) => {
      if (!slot.url) return false;
      const decorated = decorateProgramUrl(slot.url);
      return decorated === playerUrl;
    });
    const idx = currentIdx >= 0 ? currentIdx : 0;
    const next = galleryPlaylist[(idx + 1) % galleryPlaylist.length];
    if (!next?.url) return;

    const url = next.url;
    if (!url.startsWith("/stash/")) return;
    const joiner = url.includes("?") ? "&" : "?";
    const prefetchUrl = `${url}${joiner}fetch=1`;

    const nowMs = Date.now();
    const prev = stashPrefetchRef.current;
    if (prev && prev.nextUrl === prefetchUrl && nowMs - prev.at < 15_000) return;
    stashPrefetchRef.current = { at: nowMs, forUrl: playerUrl, nextUrl: prefetchUrl };

    // Fire-and-forget. Ignore errors; /stash may return 404 while warming.
    void fetch(prefetchUrl, { method: "GET" }).catch(() => {});
  }, [
    galleryEnabled,
    playlistEnabled,
    playerOpen,
    playerUrl,
    viewMode,
    galleryPlaylist,
    decorateProgramUrl,
  ]);

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

  const sendMic = useCallback((message: RemoteMessage) => {
    sendRef.current?.(message);
  }, []);

  const createMicSessionId = useCallback(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }, []);

  const stopRemoteMic = useCallback(
    (notify = true) => {
      const sessionId = micRemoteSessionRef.current;
      if (notify && sessionId) {
        sendMic({
          type: "mic",
          action: "stop",
          sessionId,
          from: "remote",
        });
      }
      const peer = micRemotePeerRef.current;
      if (peer) {
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.close();
      }
      micRemotePeerRef.current = null;
      micRemoteSessionRef.current = null;
      const stream = micRemoteStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      micRemoteStreamRef.current = null;
      setMicEnabled(false);
      setMicStatus("idle");
      setMicError(null);
    },
    [sendMic]
  );

  const startRemoteMic = useCallback(async () => {
    if (micRemotePeerRef.current) return;
    if (!sendRef.current) {
      setMicError("Remote not connected");
      setMicStatus("error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Mic not supported");
      setMicStatus("error");
      return;
    }
    if (!window.isSecureContext) {
      setMicError("Mic requires HTTPS");
      setMicStatus("error");
      return;
    }
    setMicStatus("requesting");
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const pc = new RTCPeerConnection();
      const sessionId = createMicSessionId();
      micRemotePeerRef.current = pc;
      micRemoteStreamRef.current = stream;
      micRemoteSessionRef.current = sessionId;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        sendMic({
          type: "mic",
          action: "ice",
          sessionId,
          candidate: event.candidate.toJSON(),
          from: "remote",
        });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setMicStatus("live");
          return;
        }
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          setMicStatus("error");
          setMicEnabled(false);
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendMic({
        type: "mic",
        action: "offer",
        sessionId,
        sdp: offer.sdp ?? "",
        from: "remote",
      });
      setMicEnabled(true);
      setMicStatus("connecting");
    } catch (error) {
      log.warn("mic-start-failed", error);
      setMicError("Mic access blocked");
      setMicStatus("error");
      setMicEnabled(false);
    }
  }, [createMicSessionId, sendMic]);

  const handleRemoteMicMessage = useCallback(
    async (msg: RemoteMessage) => {
      if (msg.type !== "mic") return;
      const sessionId = micRemoteSessionRef.current;
      if (!sessionId || msg.sessionId !== sessionId) return;
      const peer = micRemotePeerRef.current;
      if (!peer) return;
      if (msg.action === "answer" && msg.sdp) {
        try {
          await peer.setRemoteDescription({
            type: "answer",
            sdp: msg.sdp,
          });
        } catch (error) {
          log.warn("mic-answer-failed", error);
        }
      }
      if (msg.action === "ice" && msg.candidate) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (error) {
          log.warn("mic-ice-failed", error);
        }
      }
      if (msg.action === "stop") {
        stopRemoteMic(false);
      }
    },
    [stopRemoteMic]
  );

  const cleanupGuideMic = useCallback(() => {
    const peer = micGuidePeerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    micGuidePeerRef.current = null;
    micGuideSessionRef.current = null;
    const stream = micGuideStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    micGuideStreamRef.current = null;
    if (micAudioRef.current) {
      micAudioRef.current.srcObject = null;
    }
    setMicIncomingStatus("idle");
  }, []);

  const handleGuideMicMessage = useCallback(
    async (msg: RemoteMessage) => {
      if (msg.type !== "mic") return;
      if (msg.action === "stop") {
        if (msg.sessionId === micGuideSessionRef.current) {
          cleanupGuideMic();
        }
        return;
      }
      if (msg.action === "offer") {
        if (!msg.sdp) return;
        cleanupGuideMic();
        const pc = new RTCPeerConnection();
        micGuidePeerRef.current = pc;
        micGuideSessionRef.current = msg.sessionId;
        setMicIncomingStatus("connecting");
        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          sendMic({
            type: "mic",
            action: "ice",
            sessionId: msg.sessionId,
            candidate: event.candidate.toJSON(),
            from: "guide",
          });
        };
        pc.ontrack = (event) => {
          const stream = event.streams?.[0] ?? new MediaStream([event.track]);
          micGuideStreamRef.current = stream;
          const audio = micAudioRef.current;
          if (audio) {
            audio.srcObject = stream;
            audio.muted = false;
            audio.play().catch((error) => {
              log.warn("mic-play-failed", error);
            });
          }
          setMicIncomingStatus("live");
        };
        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === "failed" ||
            pc.connectionState === "closed"
          ) {
            setMicIncomingStatus("idle");
          }
        };
        try {
          await pc.setRemoteDescription({
            type: "offer",
            sdp: msg.sdp,
          });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendMic({
            type: "mic",
            action: "answer",
            sessionId: msg.sessionId,
            sdp: answer.sdp ?? "",
            from: "guide",
          });
        } catch (error) {
          log.warn("mic-offer-failed", error);
          cleanupGuideMic();
        }
        return;
      }
      if (msg.action === "ice" && msg.candidate) {
        if (msg.sessionId !== micGuideSessionRef.current) return;
        const peer = micGuidePeerRef.current;
        if (!peer) return;
        try {
          await peer.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (error) {
          log.warn("mic-ice-failed", error);
        }
      }
    },
    [cleanupGuideMic, sendMic]
  );

  const toggleMic = useCallback(() => {
    if (micEnabled) {
      stopRemoteMic(true);
    } else {
      void startRemoteMic();
    }
  }, [micEnabled, startRemoteMic, stopRemoteMic]);

  const commitRemoteCursor = useCallback(
    (next: RemoteCursorState) => {
      remoteCursorRef.current = next;
      const surface = playerSurfaceRef.current;
      if (surface) {
        surface.style.setProperty(
          "--remote-cursor-x",
          `${next.x * 100}%`
        );
        surface.style.setProperty(
          "--remote-cursor-y",
          `${next.y * 100}%`
        );
        surface.style.setProperty(
          "--remote-cursor-opacity",
          next.visible ? "1" : "0"
        );
      }
      if (remoteCursorRafRef.current !== null) return;
      remoteCursorRafRef.current = window.requestAnimationFrame(() => {
        remoteCursorRafRef.current = null;
        const current = remoteCursorRef.current;
        setRemoteCursor(current);
        setGuideViewState({ remoteCursor: current });
      });
    },
    [setGuideViewState]
  );

  const scheduleRemoteCursorHide = useCallback(() => {
    if (remoteCursorHideRef.current !== null) {
      window.clearTimeout(remoteCursorHideRef.current);
    }
    remoteCursorHideRef.current = window.setTimeout(() => {
      commitRemoteCursor({
        ...remoteCursorRef.current,
        visible: false,
        pressed: false,
      });
    }, REMOTE_CURSOR_HIDE_MS);
  }, [commitRemoteCursor]);

  const moveRemoteCursor = useCallback(
    (dx: number, dy: number) => {
      const next = {
        ...remoteCursorRef.current,
        x: clamp(
          remoteCursorRef.current.x + dx * REMOTE_MOUSE_SENSITIVITY,
          0,
          1
        ),
        y: clamp(
          remoteCursorRef.current.y + dy * REMOTE_MOUSE_SENSITIVITY,
          0,
          1
        ),
        visible: true,
      };
      commitRemoteCursor(next);
      scheduleRemoteCursorHide();
    },
    [commitRemoteCursor, scheduleRemoteCursorHide]
  );

  const getCursorClientPosition = useCallback(() => {
    const surface = playerSurfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const cursor = remoteCursorRef.current;
    return {
      rect,
      clientX: rect.left + cursor.x * rect.width,
      clientY: rect.top + cursor.y * rect.height,
    };
  }, []);

  const resolvePointerTarget = useCallback(
    (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY);
      if (!target) return null;
      if (target instanceof HTMLIFrameElement) {
        const frameRect = target.getBoundingClientRect();
        try {
          const doc = target.contentDocument;
          if (doc) {
            const innerTarget = doc.elementFromPoint(
              clientX - frameRect.left,
              clientY - frameRect.top
            );
            if (innerTarget) {
              return {
                target: innerTarget as HTMLElement,
                doc,
                clientX: clientX - frameRect.left,
                clientY: clientY - frameRect.top,
              };
            }
          }
        } catch {
          // cross-origin, fall back to iframe element
        }
      }
      const owner = target.ownerDocument ?? document;
      return { target: target as HTMLElement, doc: owner, clientX, clientY };
    },
    []
  );

  const dispatchMouseEvent = useCallback(
    (
      info: {
        target: HTMLElement;
        doc: Document;
        clientX: number;
        clientY: number;
      },
      type: "mousemove" | "mousedown" | "mouseup" | "click"
    ) => {
      const view = info.doc.defaultView ?? window;
      const event = new view.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: info.clientX,
        clientY: info.clientY,
        view,
        buttons: type === "mousedown" || type === "click" ? 1 : 0,
      });
      info.target.dispatchEvent(event);
    },
    []
  );

  const pressRemoteCursor = useCallback(
    (pressed: boolean) => {
      if (remoteCursorPressRef.current !== null) {
        window.clearTimeout(remoteCursorPressRef.current);
      }
      commitRemoteCursor({
        ...remoteCursorRef.current,
        pressed,
        visible: true,
      });
      if (pressed) {
        remoteCursorPressRef.current = window.setTimeout(() => {
          commitRemoteCursor({
            ...remoteCursorRef.current,
            pressed: false,
          });
          remoteCursorPressRef.current = null;
        }, 140);
      }
    },
    [commitRemoteCursor]
  );

  const clickRemotePointer = useCallback(() => {
    const position = getCursorClientPosition();
    if (!position) return;
    const info = resolvePointerTarget(position.clientX, position.clientY);
    if (!info || !info.target) return;
    if (info.target instanceof HTMLElement) {
      info.target.focus({ preventScroll: true });
    }
    remotePointerTargetRef.current = { target: info.target, doc: info.doc };
    dispatchMouseEvent(info, "mousemove");
    dispatchMouseEvent(info, "mousedown");
    dispatchMouseEvent(info, "mouseup");
    dispatchMouseEvent(info, "click");
    pressRemoteCursor(true);
    scheduleRemoteCursorHide();
  }, [
    dispatchMouseEvent,
    getCursorClientPosition,
    pressRemoteCursor,
    resolvePointerTarget,
    scheduleRemoteCursorHide,
  ]);

  const getKeyboardTarget = useCallback(() => {
    const last = remotePointerTargetRef.current;
    if (last?.target && last.target.isConnected) {
      return last;
    }
    const active = document.activeElement;
    if (active && active instanceof HTMLElement) {
      if (active instanceof HTMLIFrameElement) {
        try {
          const doc = active.contentDocument;
          const inner = doc?.activeElement;
          if (inner && inner instanceof HTMLElement) {
            return { target: inner, doc: doc ?? document };
          }
        } catch {
          return null;
        }
      }
      return { target: active, doc: active.ownerDocument ?? document };
    }
    const position = getCursorClientPosition();
    if (!position) return null;
    const info = resolvePointerTarget(position.clientX, position.clientY);
    if (!info || !info.target) return null;
    return { target: info.target, doc: info.doc };
  }, [getCursorClientPosition, resolvePointerTarget]);

  const applyRemoteText = useCallback(
    (target: HTMLElement, doc: Document, text: string) => {
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.setRangeText(text, start, end, "end");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (target.isContentEditable) {
        const view = doc.defaultView ?? window;
        if (view.document?.execCommand) {
          view.document.execCommand("insertText", false, text);
        } else {
          const selection = doc.getSelection();
          if (selection && selection.rangeCount) {
            selection.deleteFromDocument();
            selection.getRangeAt(0).insertNode(doc.createTextNode(text));
            selection.collapseToEnd();
          }
        }
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: text,
            inputType: "insertText",
          })
        );
      }
    },
    []
  );

  const applyRemoteBackspace = useCallback(
    (target: HTMLElement, count: number) => {
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        for (let i = 0; i < count; i += 1) {
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? target.value.length;
          if (start === end && start > 0) {
            target.setRangeText("", start - 1, end, "end");
          } else {
            target.setRangeText("", start, end, "end");
          }
        }
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (target.isContentEditable) {
        const view = target.ownerDocument?.defaultView ?? window;
        for (let i = 0; i < count; i += 1) {
          view.document?.execCommand?.("delete", false);
        }
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentBackward",
          })
        );
      }
    },
    []
  );

  const applyRemoteKey = useCallback(
    (target: HTMLElement, doc: Document, key: "Enter" | "Escape" | "Tab") => {
      const view = doc.defaultView ?? window;
      const down = new view.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      const up = new view.KeyboardEvent("keyup", { key, bubbles: true });
      target.dispatchEvent(down);
      if (key === "Enter") {
        if (target instanceof HTMLTextAreaElement) {
          applyRemoteText(target, doc, "\n");
        } else if (target instanceof HTMLInputElement) {
          target.form?.requestSubmit?.();
        }
      }
      target.dispatchEvent(up);
    },
    [applyRemoteText]
  );

  const handleRemoteMouse = useCallback(
    (msg: RemoteMessage) => {
      if (msg.type !== "mouse") return;
      if (viewMode !== "guide") return;
      if (msg.action === "move") {
        log.debug("remote-mouse", {
          action: msg.action,
          dx: msg.dx,
          dy: msg.dy,
          playerOpen,
          hasKeyboardMouse,
        });
      } else {
        log.debug("remote-mouse", {
          action: msg.action,
          playerOpen,
          hasKeyboardMouse,
        });
      }
      if (msg.action === "move") {
        moveRemoteCursor(msg.dx, msg.dy);
      }
      if (msg.action === "click") {
        if (!playerOpen || !hasKeyboardMouse) return;
        clickRemotePointer();
      }
    },
    [
      clickRemotePointer,
      moveRemoteCursor,
      viewMode,
      playerOpen,
      hasKeyboardMouse,
    ]
  );

  const handleRemoteKeyboard = useCallback(
    (msg: RemoteMessage) => {
      if (msg.type !== "keyboard") return;
      if (viewMode !== "guide") return;
      log.debug("remote-keyboard", {
        action: msg.action,
        key: msg.action === "key" ? msg.key : undefined,
        playerOpen,
        hasKeyboardMouse,
      });
      if (!playerOpen || !hasKeyboardMouse) return;
      const targetInfo = getKeyboardTarget();
      if (!targetInfo?.target || !targetInfo.doc) return;
      if (msg.action === "text") {
        applyRemoteText(targetInfo.target, targetInfo.doc, msg.text);
        return;
      }
      if (msg.action === "backspace") {
        applyRemoteBackspace(targetInfo.target, msg.count ?? 1);
        return;
      }
      if (msg.action === "key") {
        applyRemoteKey(targetInfo.target, targetInfo.doc, msg.key);
      }
    },
    [
      applyRemoteBackspace,
      applyRemoteKey,
      applyRemoteText,
      getKeyboardTarget,
      hasKeyboardMouse,
      playerOpen,
      viewMode,
    ]
  );

  const { send, status } = useRemoteSocket(
    (msg) => {
      const tuningLocked = channelLocked && viewMode === "guide";

      if (msg.type === "mic") {
        if (msg.from === "remote" && viewMode !== "remote") {
          void handleGuideMicMessage(msg);
        }
        if (msg.from === "guide" && viewMode === "remote") {
          void handleRemoteMicMessage(msg);
        }
        return;
      }
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
      if (msg.type === "mouse") {
        handleRemoteMouse(msg);
        return;
      }
      if (msg.type === "keyboard") {
        handleRemoteKeyboard(msg);
        return;
      }
      if (viewMode === "remote") {
        if (msg.type === "app") {
          const nextAppId = msg.appId ?? "";
          if (!requestedRemoteAppId) {
            setActiveRemoteAppId(nextAppId);
          }
          setRemoteRegistrations(msg.remoteControls ?? []);
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
          return;
        }
        return;
      }

      if (msg.type === "guide") {
        if (tuningLocked) return;
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
        if (tuningLocked) return;
        if (viewMode === "guide") {
          handleTuneToNumber(msg.number);
        }
        return;
      }
      if (msg.type === "godselect") {
        if (tuningLocked) return;
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
        if (tuningLocked) return;
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
        if (tuningLocked) return;
        moveSelection(msg.dir);
        return;
      }
      if (msg.type === "select") {
        if (viewMode === "art") {
          setArtPaused((prev) => !prev);
          return;
        }
        if (tuningLocked) return;
        handleSelect();
      }
    },
    { role: viewMode === "remote" ? "remote" : "guide" }
  );

  const appControlsAppId = hasAppControls ? effectiveRemoteAppId : "";
  const { remoteControls, remoteControlsStatus, handleRemoteControl } =
    useRemoteControls({
      viewMode,
      activeRemoteAppId: appControlsAppId ?? "",
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

  useEffect(() => {
    if (remotePanel === "app" && !hasAppControls) {
      setRemotePanel("remote");
    }
    if (remotePanel === "input" && !hasKeyboardMouse) {
      setRemotePanel("remote");
    }
  }, [hasAppControls, hasKeyboardMouse, remotePanel]);

  useEffect(() => {
    if (viewMode !== "remote") return;
    if (!hasMicControls && micEnabled) {
      stopRemoteMic(true);
      setMicEnabled(false);
      setMicStatus("idle");
      setMicError(null);
    }
  }, [hasMicControls, micEnabled, stopRemoteMic, viewMode]);

  useEffect(() => {
    if (!playerOpen) {
      remotePointerTargetRef.current = null;
      commitRemoteCursor({
        ...remoteCursorRef.current,
        visible: false,
        pressed: false,
      });
    }
  }, [commitRemoteCursor, playerOpen]);

  useEffect(() => {
    return () => {
      if (remoteCursorHideRef.current !== null) {
        window.clearTimeout(remoteCursorHideRef.current);
      }
      if (remoteCursorPressRef.current !== null) {
        window.clearTimeout(remoteCursorPressRef.current);
      }
      if (remoteCursorRafRef.current !== null) {
        window.cancelAnimationFrame(remoteCursorRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "remote") {
      stopRemoteMic(false);
      setMicEnabled(false);
      setMicStatus("idle");
      setMicError(null);
    }
  }, [viewMode, stopRemoteMic]);

  useEffect(() => {
    if (viewMode === "remote") {
      cleanupGuideMic();
    }
  }, [viewMode, cleanupGuideMic]);

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
    if (showSplash) {
      applyScrollOffset(0);
      autoHoldUntilRef.current = 0;
      autoResetPendingRef.current = false;
      lastFrameRef.current = null;
      return;
    }
    const bounds = getScrollBounds();
    if (!bounds || channels.length <= visibleRows || bounds.maxScroll <= 0) {
      applyScrollOffset(0);
      autoHoldUntilRef.current = 0;
      autoResetPendingRef.current = false;
      lastFrameRef.current = null;
      return;
    }
    const maxScroll = bounds.maxScroll;
    autoHoldUntilRef.current = 0;
    autoResetPendingRef.current = false;
    lastFrameRef.current = null;

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
  }, [
    showSplash,
    channels.length,
    visibleRows,
    getScrollBounds,
    applyScrollOffset,
  ]);

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
        if (qrLockedOff) return;
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
      if (
        viewMode === "guide" &&
        playerOpen &&
        !channelLocked &&
        (channelUp || channelDown)
      ) {
        event.preventDefault();
        handleChannelChange(channelUp ? "up" : "down");
        return;
      }
      if (
        viewMode === "guide" &&
        playerOpen &&
        !channelLocked &&
        (key === "Escape" || key === "Backspace")
      ) {
        setPlayerOpen(false);
        return;
      }
      if (viewMode === "guide" && !channelLocked) {
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
        if (viewMode === "guide" && channelLocked) return;
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
    channelLocked,
    qrLockedOff,
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
    wsUrl?: string;
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
    const applyRemote = (data: {
      baseUrl?: string;
      remoteUrl?: string;
      qrUrl?: string;
      wsUrl?: string;
    } | null) => {
      if (!alive || !data?.baseUrl || !data?.qrUrl) return;
      if (data.wsUrl) {
        try {
          window.localStorage.setItem("chiba:ws", data.wsUrl);
        } catch {
          // ignore storage errors
        }
      }
      let remoteUrl = (data.remoteUrl as string) ?? "";
      if (galleryEnabled) {
        remoteUrl = appendQueryParam(remoteUrl, PARAM_GALLERY, "1");
      }
      if (channelLocked) {
        remoteUrl = appendQueryParam(remoteUrl, "lock", "1");
      }
      const qrUrl = remoteUrl ? buildQrUrl(remoteUrl) : (data.qrUrl as string);
      setRemoteOverride({
        baseUrl: data.baseUrl as string,
        remoteUrl,
        qrUrl,
        wsUrl: data.wsUrl as string | undefined,
      });
    };
    const query = `guide_port=${guidePort}&scheme=${scheme}`;
    const primaryUrl = `/api/remote?${query}`;
    const fallbackOrigin = `${window.location.protocol}//${window.location.hostname}:8787`;
    const fallbackUrl = `${fallbackOrigin}/api/remote?${query}`;
    fetch(primaryUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.baseUrl && data?.qrUrl) {
          applyRemote(data);
          return;
        }
        return fetch(fallbackUrl)
          .then((res) => (res.ok ? res.json() : null))
          .then((fallbackData) => {
            applyRemote(fallbackData);
          })
          .catch(() => {});
      })
      .catch(() => {
        fetch(fallbackUrl)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            applyRemote(data);
          })
          .catch(() => {});
      });
    return () => {
      alive = false;
    };
  }, []);
  const fallbackRemote = buildRemoteUrls({
    hostOverride,
    forceHttps,
    metaRemote: remoteOverride?.baseUrl ?? metaRemote,
  });
  let fallbackRemoteUrl = fallbackRemote.remoteUrl;
  if (galleryEnabled) {
    fallbackRemoteUrl = appendQueryParam(fallbackRemoteUrl, PARAM_GALLERY, "1");
  }
  if (channelLocked) {
    fallbackRemoteUrl = appendQueryParam(fallbackRemoteUrl, "lock", "1");
  }
  const fallbackQrUrl = buildQrUrl(fallbackRemoteUrl);
  const qrImageUrl = remoteOverride?.qrUrl ?? fallbackQrUrl;

  useEffect(() => {
    if (viewMode !== "guide") return;
    const nextAppId = playerOpen ? activeAppId : null;
    const nextControls = playerOpen ? activeProgramRemoteControls : [];
    const nextKey = `${nextAppId ?? ""}|${nextControls.join(",")}`;
    if (lastAppMessageRef.current === nextKey) return;
    lastAppMessageRef.current = nextKey;
    send({ type: "app", appId: nextAppId, remoteControls: nextControls });
  }, [viewMode, playerOpen, activeAppId, activeProgramRemoteControls, send]);

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
  const showAppPanel = hasAppControls && remotePanel === "app";
  const showInputPanel = hasKeyboardMouse && remotePanel === "input";
  const hasSpecialControls = hasAppControls || hasKeyboardMouse;
  const showGodPanel = remoteGodmodeOpen;
  const micStatusLabel = micError
    ? micError
    : micStatus === "idle"
    ? "Off"
    : micStatus === "requesting"
    ? "Requesting mic…"
    : micStatus === "connecting"
    ? "Connecting…"
    : micStatus === "live"
    ? "Live"
    : "Error";
  const micToggleDisabled =
    status !== "open" || micStatus === "requesting" || !hasMicControls;
  const micIndicator =
    viewMode !== "remote" && micIncomingStatus !== "idle" ? (
      <div
        className={`mic-indicator ${
          micIncomingStatus === "live" ? "is-live" : ""
        }`}
      >
        <span className="mic-indicator-dot" />
        {micIncomingStatus === "live" ? "Mic Live" : "Mic Connecting"}
      </div>
    ) : null;
  const micAudioElement =
    viewMode !== "remote" ? (
      <audio ref={micAudioRef} className="mic-audio" autoPlay playsInline />
    ) : null;
  const isRemoteDebug =
    remoteNowChannel?.id === DEBUG_CHANNEL_ID ||
    normalizeChannelNumber(remoteNowChannel?.number ?? "") ===
      normalizeChannelNumber(DEBUG_CHANNEL_NUMBER);
  const handleToggleDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
  }, []);

  useEffect(() => {
    setRemoteViewState({
      status,
      uiScale,
      textScale,
      visibleHours,
      activeThemeId,
      isRemoteDebug,
      showGodPanel,
      filteredGodmodeItems,
      godmodeQuery,
      showAppPanel,
      showInputPanel,
      hasAppControls,
      hasKeyboardMouse,
      hasMicControls,
      hasSpecialControls,
      remoteControlsStatus,
      remoteControls,
      showDebug,
      memoryStats,
      mediaStats,
      dialOverlay,
      micEnabled,
      micStatusLabel,
      micToggleDisabled,
    });
  }, [
    status,
    uiScale,
    textScale,
    visibleHours,
    activeThemeId,
    isRemoteDebug,
    showGodPanel,
    filteredGodmodeItems,
    godmodeQuery,
    showAppPanel,
    showInputPanel,
    hasAppControls,
    hasKeyboardMouse,
    hasMicControls,
    hasSpecialControls,
    remoteControlsStatus,
    remoteControls,
    showDebug,
    memoryStats,
    mediaStats,
    dialOverlay,
    micEnabled,
    micStatusLabel,
    micToggleDisabled,
    setRemoteViewState,
  ]);

  useEffect(() => {
    setRemoteViewHandlers({
      onDisplayChange: handleDisplayChange,
      send,
      setRemoteGodmodeOpen,
      setGodmodeQuery,
      setDialBuffer,
      setRemotePanel,
      pushDialDigit,
      handleRemoteControl,
      onMicToggle: toggleMic,
    });
  }, [
    handleDisplayChange,
    send,
    setRemoteGodmodeOpen,
    setGodmodeQuery,
    setDialBuffer,
    setRemotePanel,
    pushDialDigit,
    handleRemoteControl,
    toggleMic,
    setRemoteViewHandlers,
  ]);
  useEffect(() => {
    setGuideViewState({
      gridStyle,
      now,
      galleryMode: galleryEnabled,
      channelLocked,
      selectedChannel,
      selectedProgram,
      playerOpen,
      playerReady,
      playerSurfaceRef,
      hasKeyboardMouse,
      hasPreviewMedia,
      posterImageReady,
      previewContainerRef,
      progressValue,
      indexData,
      visibleStartSlot,
      visibleSlotCount,
      slotCount,
      selectedCol,
      currentSlotIndex,
      channels,
      activeRow,
      isPaused,
      viewportRef,
      rowsRef,
      showQr,
      qrUrl: qrImageUrl,
      playerUrl,
      playerKind,
      playerMeta,
      showPlayerHud,
      loopVideo: !(galleryEnabled && playlistEnabled),
      ambientAudio,
      masterVolume,
      masterMuted,
      showVolumeHud,
      showDebug,
      memoryStats,
      mediaStats,
      dialOverlay,
    });
  }, [
    gridStyle,
    now,
    galleryEnabled,
    channelLocked,
    selectedChannel,
    selectedProgram,
    playerOpen,
    playerReady,
    playerSurfaceRef,
    hasPreviewMedia,
    posterImageReady,
    previewContainerRef,
    progressValue,
    indexData,
    visibleStartSlot,
    visibleSlotCount,
    slotCount,
    selectedCol,
    currentSlotIndex,
    channels,
    activeRow,
    isPaused,
    viewportRef,
    rowsRef,
    showQr,
    qrImageUrl,
    playerUrl,
    playerKind,
    playerMeta,
    showPlayerHud,
    galleryEnabled,
    playlistEnabled,
    ambientAudio,
    masterVolume,
    masterMuted,
    showVolumeHud,
    showDebug,
    memoryStats,
    mediaStats,
    dialOverlay,
    setGuideViewState,
  ]);

  useEffect(() => {
    setGuideViewHandlers({
      setPosterImageReady,
      onSelectRow: setSelectedRow,
      onSelectCol: setSelectedCol,
      onOpenProgram: openProgram,
      onToggleDebug: handleToggleDebug,
      setPlayerReady,
      onPlayerEnded: () => advanceGalleryPlaylist("ended"),
      onPlayerError: (_kind, _url) => advanceGalleryPlaylist("error"),
    });
  }, [
    setPosterImageReady,
    setSelectedRow,
    setSelectedCol,
    openProgram,
    handleToggleDebug,
    setPlayerReady,
    advanceGalleryPlaylist,
    setGuideViewHandlers,
  ]);

  useEffect(() => {
    setArtViewState({
      channels,
      channelId,
      artIndex,
      artPaused,
      showDebug,
      memoryStats,
      mediaStats,
      dialOverlay,
      masterVolume,
      masterMuted,
      showVolumeHud,
    });
  }, [
    channels,
    channelId,
    artIndex,
    artPaused,
    showDebug,
    memoryStats,
    mediaStats,
    dialOverlay,
    masterVolume,
    masterMuted,
    showVolumeHud,
    setArtViewState,
  ]);
  useEffect(() => {
    if (!showGodPanel) {
      setGodmodeQuery("");
    }
  }, [showGodPanel]);
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
    return <RemoteView />;
  }

  if (viewMode === "art") {
    return (
      <>
        <ArtView />
        {micIndicator}
        {micAudioElement}
        {displayTuningOverlay}
      </>
    );
  }

  return (
    <>
      <GuideView />
      {micIndicator}
      {micAudioElement}
      {displayTuningOverlay}
      {splashOverlay}
    </>
  );
}

export default App;
