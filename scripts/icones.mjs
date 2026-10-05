import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const svg = readFileSync("apps/caisse/public/icone.svg", "utf8");
const b = await chromium.launch();
const p = await b.newPage();
for (const t of [180, 192, 512]) {
  await p.setViewportSize({ width: t, height: t });
  await p.setContent(`<html><body style="margin:0">${svg.replace("<svg ", `<svg width="${t}" height="${t}" `)}</body></html>`);
  await p.screenshot({ path: `apps/caisse/public/icone-${t}.png`, omitBackground: true });
}
await b.close();
