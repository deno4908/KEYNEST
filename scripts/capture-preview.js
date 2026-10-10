import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(edge) ? { executablePath: edge } : {}),
});
try {
  mkdirSync(".data/qa", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: ".data/qa/home-desktop.png", fullPage: true });
  console.log(
    JSON.stringify({
      title: await page.title(),
      products: await page.locator(".product-card").count(),
      errors,
      brokenImages: await page
        .locator("img")
        .evaluateAll((a) =>
          a
            .filter((i) => !i.complete || i.naturalWidth === 0)
            .map((i) => i.src),
        ),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".data/qa/home-mobile.png", fullPage: true });
  console.log(
    "Mobile overflow: " +
      (await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
  );
} finally {
  await browser.close();
}
