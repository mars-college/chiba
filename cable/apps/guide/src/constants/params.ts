export const PARAM_RETURN_ROW = "r";
export const PARAM_REMOTE_APP_KEYS = ["app", "appId"] as const;
export const PARAM_SCALE = "scale";
export const PARAM_TEXT_SCALE_KEYS = ["text", "textScale"] as const;
export const PARAM_HOURS = "hours";
export const PARAM_THEME = "theme";
export const PARAM_SPLASH = "splash";
export const PARAM_NO_SPLASH = "nosplash";
export const PARAM_MUTE_KEYS = ["muted", "mute", "audioMuted", "audio"] as const;
export const PARAM_SCREEN_KEYS = ["screen", "screenId"] as const;
export const PARAM_ART_INDEX = "i";
export const PARAM_REMOTE_HOST = "host";
export const PARAM_REMOTE_HTTPS = "https";
export const PARAM_LOG_LEVEL = "log";
export const PARAM_WS = "ws";
export const PARAM_EMBED_DEBUG = "embed_debug";

// Gallery / kiosk launch options
// - `gallery=1` enables single-channel autoplay behavior suitable for installations.
// - `channel=<id|number>` picks the pinned channel (id or numeric channel number).
// - `lock=1` disables tuning/navigation while allowing volume + app controls.
// - `qr=0` hides the QR entirely (cannot be toggled back on with the keyboard).
export const PARAM_GALLERY = "gallery";
export const PARAM_GALLERY_CHANNEL_KEYS = ["channel", "ch", "channelId"] as const;
export const PARAM_PLAYLIST = "playlist";
export const PARAM_LOCK_KEYS = ["lock", "locked"] as const;
export const PARAM_QR_KEYS = ["qr", "showQr", "showQR"] as const;

// Player info card (HUD)
// - `hud=always|start|never`
// - `hudSec=<number>` (used when hud=start)
export const PARAM_HUD_MODE = "hud";
export const PARAM_HUD_SEC_KEYS = ["hudSec", "hud_sec"] as const;
