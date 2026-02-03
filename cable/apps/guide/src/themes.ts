export type ThemeProfile = {
  id: string;
  label: string;
  vars: Record<string, string>;
};

export const DEFAULT_THEME_ID = "nebula";

export const THEMES: ThemeProfile[] = [
  {
    id: "nebula",
    label: "Nebula",
    vars: {
      "--bg-0": "#0a1121",
      "--bg-1": "#121c33",
      "--panel": "rgba(12, 22, 40, 0.92)",
      "--line": "rgba(120, 170, 230, 0.32)",
      "--text-soft": "rgba(230, 240, 255, 0.7)",
      "--panel-header":
        "linear-gradient(160deg, rgba(20, 38, 68, 0.9), rgba(10, 18, 32, 0.94))",
      "--panel-header-right":
        "linear-gradient(150deg, rgba(16, 30, 54, 0.92), rgba(10, 18, 34, 0.96))",
      "--panel-time-label": "rgba(9, 16, 30, 0.75)",
      "--panel-time": "rgba(10, 18, 34, 0.75)",
      "--panel-viewport": "rgba(9, 15, 28, 0.55)",
      "--panel-cell": "rgba(12, 21, 38, 0.85)",
      "--panel-cell-active": "rgba(20, 36, 66, 0.95)",
      "--panel-card":
        "linear-gradient(160deg, rgba(18, 32, 58, 0.92), rgba(8, 16, 30, 0.96))",
      "--panel-card-active":
        "linear-gradient(160deg, rgba(36, 70, 120, 0.98), rgba(12, 22, 40, 0.98))",
      "--panel-border": "rgba(126, 215, 255, 0.2)",
      "--panel-border-strong": "rgba(196, 236, 255, 0.85)",
      "--panel-active-glow":
        "0 0 0 2px rgba(178, 230, 255, 0.25), 0 0 18px rgba(126, 215, 255, 0.35)",
      "--panel-card-glow":
        "0 0 0 2px rgba(178, 230, 255, 0.35), 0 0 28px rgba(126, 215, 255, 0.6)",
      "--progress-grad": "linear-gradient(90deg, #7ed7ff, #92ffdf)",
      "--progress-glow": "0 0 14px rgba(126, 215, 255, 0.7)",
      "--panel-footer-line": "rgba(126, 215, 255, 0.2)",
      "--qr-bg": "rgba(10, 18, 34, 0.88)",
    },
  },
  {
    id: "gallery",
    label: "Gallery",
    vars: {
      "--bg-0": "#0a0e18",
      "--bg-1": "#1b2a45",
      "--panel": "rgba(10, 18, 32, 0.94)",
      "--line": "rgba(150, 200, 255, 0.42)",
      "--text-soft": "rgba(235, 245, 255, 0.78)",
      "--panel-header":
        "linear-gradient(160deg, rgba(26, 52, 92, 0.96), rgba(10, 20, 36, 0.96))",
      "--panel-header-right":
        "linear-gradient(150deg, rgba(26, 50, 92, 0.96), rgba(12, 20, 36, 0.98))",
      "--panel-time-label": "rgba(12, 20, 36, 0.85)",
      "--panel-time": "rgba(12, 20, 36, 0.82)",
      "--panel-viewport": "rgba(10, 18, 32, 0.65)",
      "--panel-cell": "rgba(16, 28, 48, 0.92)",
      "--panel-cell-active": "rgba(28, 56, 96, 0.98)",
      "--panel-card":
        "linear-gradient(160deg, rgba(22, 42, 74, 0.96), rgba(12, 20, 36, 0.98))",
      "--panel-card-active":
        "linear-gradient(160deg, rgba(46, 86, 140, 0.98), rgba(18, 30, 50, 0.98))",
      "--panel-border": "rgba(150, 200, 255, 0.32)",
      "--panel-border-strong": "rgba(198, 232, 255, 0.95)",
      "--panel-active-glow":
        "0 0 0 2px rgba(180, 224, 255, 0.35), 0 0 22px rgba(140, 210, 255, 0.55)",
      "--panel-card-glow":
        "0 0 0 2px rgba(180, 224, 255, 0.45), 0 0 32px rgba(140, 210, 255, 0.65)",
      "--progress-grad": "linear-gradient(90deg, #8fe3ff, #b2ffe9)",
      "--progress-glow": "0 0 16px rgba(160, 225, 255, 0.8)",
      "--panel-footer-line": "rgba(150, 200, 255, 0.35)",
      "--qr-bg": "rgba(12, 20, 36, 0.9)",
    },
  },
  {
    id: "noir",
    label: "Noir",
    vars: {
      "--bg-0": "#07090f",
      "--bg-1": "#141b27",
      "--panel": "rgba(10, 14, 22, 0.94)",
      "--line": "rgba(120, 150, 190, 0.28)",
      "--text-soft": "rgba(210, 225, 245, 0.65)",
      "--panel-header":
        "linear-gradient(160deg, rgba(14, 20, 32, 0.96), rgba(8, 12, 20, 0.96))",
      "--panel-header-right":
        "linear-gradient(150deg, rgba(14, 20, 32, 0.96), rgba(8, 12, 20, 0.98))",
      "--panel-time-label": "rgba(10, 14, 22, 0.8)",
      "--panel-time": "rgba(10, 14, 22, 0.78)",
      "--panel-viewport": "rgba(8, 12, 20, 0.6)",
      "--panel-cell": "rgba(10, 16, 26, 0.85)",
      "--panel-cell-active": "rgba(18, 30, 48, 0.95)",
      "--panel-card":
        "linear-gradient(160deg, rgba(12, 20, 34, 0.92), rgba(8, 12, 20, 0.96))",
      "--panel-card-active":
        "linear-gradient(160deg, rgba(24, 40, 66, 0.96), rgba(12, 20, 34, 0.98))",
      "--panel-border": "rgba(120, 150, 190, 0.25)",
      "--panel-border-strong": "rgba(170, 200, 240, 0.7)",
      "--panel-active-glow":
        "0 0 0 2px rgba(140, 180, 220, 0.25), 0 0 18px rgba(110, 150, 200, 0.35)",
      "--panel-card-glow":
        "0 0 0 2px rgba(140, 180, 220, 0.3), 0 0 26px rgba(110, 150, 200, 0.45)",
      "--progress-grad": "linear-gradient(90deg, #6fb1ff, #7adac9)",
      "--progress-glow": "0 0 12px rgba(120, 170, 230, 0.6)",
      "--panel-footer-line": "rgba(120, 150, 190, 0.2)",
      "--qr-bg": "rgba(10, 14, 22, 0.9)",
    },
  },
];

export const THEME_ORDER = THEMES.map((theme) => theme.id);
export const THEME_MAP: Record<string, ThemeProfile> = Object.fromEntries(
  THEMES.map((theme) => [theme.id, theme])
);
