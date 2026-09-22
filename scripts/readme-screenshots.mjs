import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = new URL(process.env.KEEPPAGE_DEMO_URL ?? "http://127.0.0.1:5189/demo.html");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
  throw new Error("Screenshot generation requires a local demo server.");
}
base.searchParams.set("showcase", "1");
const output = path.join(root, "docs/assets");
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
const browser = await puppeteer.launch({ headless: true, executablePath });
const failures = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1040, deviceScaleFactor: 1.5 });
  await page.emulateTimezone("Asia/Shanghai");
  // Stable relative dates without changing timer behavior or the saved fixtures.
  await page.evaluateOnNewDocument(() => {
    const OriginalDate = Date;
    const instant = OriginalDate.parse("2026-03-21T04:00:00Z");
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [instant])); }
      static now() { return instant; }
    };
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    // No production API calls, external favicons, analytics, or real page loads.
    const local = url.origin === base.origin && !url.pathname.startsWith("/api/");
    if (local || ["data:", "blob:", "about:"].includes(url.protocol)) void request.continue();
    else void request.abort();
  });
  async function go(hash, selector) {
    const url = new URL(base);
    url.hash = hash;
    await page.goto(url.href, { waitUntil: "networkidle0" });
    await page.waitForSelector(selector, { visible: true });
    if (hash === "/" && !(await page.evaluate(() => document.body.innerText.includes("Alex Chen")))) {
      throw new Error("Expected the fictional showcase account, refusing to capture.");
    }
  }
  async function clickText(selector, text) {
    const candidates = await page.$$(selector);
    for (const candidate of candidates) {
      if ((await candidate.evaluate((element) => element.textContent?.trim())) === text) {
        await candidate.click();
        return;
      }
    }
    throw new Error(`Missing ${selector}: ${text}`);
  }
  async function capture(name, height = 1040) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await fs.mkdir(output, { recursive: true });
    const options = height === 1040 ? {} : { clip: { x: 0, y: 0, width: 1440, height } };
    await page.screenshot({ path: path.join(output, `${name}.png`), ...options });
    console.log(`Captured docs/assets/${name}.png`);
  }

  await go("/", 'button[aria-label="查看存档：用结构化输出连接你的应用"]');
  await capture("library");

  await go("/?folder=folder_design", 'button[aria-label="查看存档：Material 3 · 色彩系统"]');
  await clickText("button", "画廊");
  await capture("organize", 560);

  await go("/bookmarks/bm_ai_005", "iframe");
  const iframe = await page.$("iframe");
  const article = await iframe.contentFrame();
  await article.waitForSelector("article h1");
  async function expandVersions() {
    const infoButton = await page.$('button[title="展开信息栏"]');
    if (infoButton) await infoButton.click();
    for (const summary of await page.$$(".detail-collapsible summary")) {
      const shouldOpen = await summary.evaluate((element) =>
        element.textContent.includes("版本") && !element.closest("details").open);
      if (shouldOpen) await summary.click();
    }
  }
  await expandVersions();
  // Verify that changing versions changes the displayed archive, then restore v2.
  await page.locator(".version-item:nth-child(2)").click();
  await page.waitForSelector('iframe[title$="v1"]');
  await expandVersions();
  await page.locator(".version-item:first-child").click();
  await page.waitForSelector('iframe[title$="v2"]');
  await expandVersions();
  await (await (await page.$("iframe")).contentFrame()).waitForSelector("article h1");
  await capture("archive");

  await go("/imports/new", "textarea");
  await page.type('input[placeholder="例如：工作资料迁移"]', "周末阅读清单");
  await page.type("textarea", "https://react.dev/learn\nhttps://go.dev/doc/\nhttps://developer.mozilla.org/en-US/docs/Web/Performance/Lazy_loading\nhttps://react.dev/learn");
  await clickText("button", "预览导入结果");
  await page.waitForSelector(".import-preview tbody tr");
  await page.$eval(".import-preview", (element) => element.scrollIntoView({ block: "start" }));
  await capture("import");

  // Check the standard demo still uses the original regression fixtures.
  const normal = new URL(base);
  normal.searchParams.delete("showcase");
  await page.goto(normal.href, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Mock Curator"));
  if (failures.length) throw new Error(failures.join("\n"));
  console.log("Smoke checks passed: showcase library, folder filter, gallery, archive versions, import preview, standard demo.");
} finally {
  await browser.close();
}
