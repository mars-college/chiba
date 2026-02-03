import { chromium, type Browser, type Page } from 'playwright';

type CaptureOptions = {
  url: string;
  width: number;
  height: number;
  intervalMs: number;
};

type CaptureFrame = {
  buffer: Buffer;
  updatedAt: number;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
      document.documentElement.style.overflow = 'auto';
      document.body.style.overflow = 'auto';
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

export function createVillageCapture(overrides: Partial<CaptureOptions> = {}) {
  const options: CaptureOptions = {
    url: overrides.url ?? process.env.VILLAGE_URL ?? 'https://theaidigest.org/village',
    width: overrides.width ?? parseNumber(process.env.VILLAGE_WIDTH, 1280),
    height: overrides.height ?? parseNumber(process.env.VILLAGE_HEIGHT, 720),
    intervalMs: overrides.intervalMs ?? parseNumber(process.env.VILLAGE_INTERVAL_MS, 1500),
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
      await page.waitForTimeout(1500);
      await dismissModal(page);
      await captureOnce();
      timer = setInterval(() => {
        void captureOnce().catch((err) => {
          console.error('[village] capture failed', (err as Error).message);
        });
      }, options.intervalMs);
    })().catch((err) => {
      starting = null;
      console.error('[village] failed to start', (err as Error).message);
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
