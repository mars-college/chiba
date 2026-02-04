import { chromium, type Browser, type Page } from 'playwright';

type CaptureOptions = {
  url: string;
  width: number;
  height: number;
  intervalMs: number;
  locationQuery: string;
  lat: number;
  lon: number;
};

type CaptureFrame = {
  buffer: Buffer;
  updatedAt: number;
};

const DEFAULT_LOCATION = 'Niland, CA, USA';
const DEFAULT_LAT = 33.2400366;
const DEFAULT_LON = -115.5188756;

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildWeatherstarUrl(locationQuery: string, lat: number, lon: number): string {
  const params = new URLSearchParams();
  params.set('hazards-checkbox', 'true');
  params.set('current-weather-checkbox', 'true');
  params.set('latest-observations-checkbox', 'true');
  params.set('hourly-checkbox', 'true');
  params.set('hourly-graph-checkbox', 'true');
  params.set('travel-checkbox', 'true');
  params.set('regional-forecast-checkbox', 'true');
  params.set('local-forecast-checkbox', 'true');
  params.set('extended-forecast-checkbox', 'true');
  params.set('almanac-checkbox', 'true');
  params.set('spc-outlook-checkbox', 'true');
  params.set('radar-checkbox', 'true');
  params.set('settings-wide-checkbox', 'true');
  params.set('settings-kiosk-checkbox', 'true');
  params.set('settings-scanLines-checkbox', 'false');
  params.set('settings-speed-select', '1.00');
  params.set('settings-units-select', 'us');
  params.set('settings-mediaPlaying-boolean', 'true');
  params.set('latLonQuery', locationQuery);
  params.set('latLon', JSON.stringify({ lat, lon }));
  params.set('kiosk', 'true');
  return `https://weatherstar.netbymatt.com/?${params.toString()}`;
}

async function dismissModal(page: Page) {
  try {
    const hadDialog = await page.evaluate(() => {
      const selectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '.modal',
        '.popup',
        '.overlay',
        '[data-modal]',
        '[data-overlay]',
      ];
      let found = false;
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        if (nodes.length) {
          found = true;
          for (const node of nodes) {
            if (node instanceof HTMLElement) {
              node.style.display = 'none';
              node.setAttribute('data-codex-hidden', 'true');
            }
          }
        }
      }
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return found;
    });

    if (hadDialog) {
      const candidates = await page.$$('button, [role="button"], a');
      for (const handle of candidates) {
        const meta = await handle.evaluate((el) => ({
          text: (el.textContent ?? '').trim().toLowerCase(),
          aria: (el.getAttribute('aria-label') ?? '').trim().toLowerCase(),
        }));
        if (
          meta.text === 'x' ||
          meta.text === '×' ||
          meta.text.includes('close') ||
          meta.text.includes('dismiss') ||
          meta.aria.includes('close') ||
          meta.aria.includes('dismiss')
        ) {
          await handle.click({ timeout: 500 }).catch(() => undefined);
          break;
        }
      }
    }
  } catch {
    // best-effort; ignore failures
  }
}

async function ensureLocation(page: Page, locationQuery: string) {
  try {
    const hasInput = await page.evaluate((query) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[type="search"], input[type="text"], input[placeholder*="location" i]'
      );
      if (!input) return false;
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, locationQuery);

    if (!hasInput) return;

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const goButton = buttons.find((button) => {
        const text = (button.textContent ?? '').trim().toLowerCase();
        return text === 'go' || text === 'search';
      });
      if (goButton instanceof HTMLElement) {
        goButton.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      await page.keyboard.press('Enter').catch(() => undefined);
    }
  } catch {
    // ignore failures
  }
}

async function maximizeViewport(page: Page) {
  try {
    await page.addStyleTag({
      content: `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100%;
          height: 100%;
          overflow: hidden !important;
          background: #000 !important;
        }
        #app, #root, .app, .app-root, .App {
          width: 100% !important;
          height: 100% !important;
        }
        canvas, video {
          width: 100% !important;
          height: 100% !important;
        }
      `,
    });
  } catch {
    // ignore failures
  }
}

export function createWeatherstarCapture(overrides: Partial<CaptureOptions> = {}) {
  const locationQuery =
    overrides.locationQuery ?? process.env.WEATHERSTAR_LOCATION ?? DEFAULT_LOCATION;
  const lat = overrides.lat ?? parseFloatNumber(process.env.WEATHERSTAR_LAT, DEFAULT_LAT);
  const lon = overrides.lon ?? parseFloatNumber(process.env.WEATHERSTAR_LON, DEFAULT_LON);
  const options: CaptureOptions = {
    url:
      overrides.url ??
      process.env.WEATHERSTAR_URL ??
      buildWeatherstarUrl(locationQuery, lat, lon),
    width: overrides.width ?? parseNumber(process.env.WEATHERSTAR_WIDTH, 1280),
    height: overrides.height ?? parseNumber(process.env.WEATHERSTAR_HEIGHT, 720),
    intervalMs:
      overrides.intervalMs ?? parseNumber(process.env.WEATHERSTAR_INTERVAL_MS, 1500),
    locationQuery,
    lat,
    lon,
  };

  let browser: Browser | null = null;
  let page: Page | null = null;
  let frame: CaptureFrame | null = null;
  let timer: NodeJS.Timeout | null = null;
  let starting: Promise<void> | null = null;

  const captureOnce = async () => {
    if (!page) return;
    await dismissModal(page);
    const buffer = await page.screenshot({ type: 'jpeg', quality: 80 });
    frame = { buffer, updatedAt: Date.now() };
  };

  const start = async () => {
    if (starting) return starting;
    starting = (async () => {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage({
        viewport: { width: options.width, height: options.height },
        deviceScaleFactor: 1,
      });
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => undefined);
      });
      await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2000);
      await maximizeViewport(page);
      if (!options.url.includes('latLon=')) {
        await ensureLocation(page, options.locationQuery);
      }
      await page.waitForTimeout(1200);
      await dismissModal(page);
      await captureOnce();
      timer = setInterval(() => {
        void captureOnce().catch((err) => {
          console.error('[weatherstar] capture failed', (err as Error).message);
        });
      }, options.intervalMs);
    })().catch((err) => {
      starting = null;
      console.error('[weatherstar] failed to start', (err as Error).message);
    });
    return starting;
  };

  const stop = async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (page) {
      await page.close().catch(() => undefined);
      page = null;
    }
    if (browser) {
      await browser.close().catch(() => undefined);
      browser = null;
    }
    starting = null;
  };

  return {
    options,
    start,
    stop,
    getFrame: () => frame,
  };
}
