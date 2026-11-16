// 导出 Chrome 应用商店素材（PNG，不带透明通道）：
//   - 小宣传图 440×280：docs/store/promo/small-tile.html → small-tile.png（全语言共用，只做英文）
//   - 截图 1280×800：docs/store/screenshots/screenshot.html + src/<图名>-<lang>.png → <序号>-<图名>-<lang>.png
//     只导出 src/ 里界面截图齐全的组合
// 用法：PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.mjs node scripts/render-promo.mjs
//   本仓库不把 Playwright 列为依赖，指向任意一份已安装的 playwright-core / @playwright/test 即可
//   （需已有对应版本的 Chromium：npx playwright install chromium）。
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mod = process.env.PLAYWRIGHT_MODULE;
if (!mod) {
  console.error('缺少 PLAYWRIGHT_MODULE：指向 playwright-core 的 index.mjs');
  process.exit(1);
}
const { chromium } = await import(mod.startsWith('/') ? pathToFileURL(mod).href : mod);

const LANGS = ['en', 'zh'];
// 顺序即商店里的展示顺序；值为该张用到的 src/ 截图
const SHOTS = {
  write: ['write'],
  map: ['map'],
  import: ['import'],
  report: ['report'],
  themes: ['themes-a', 'themes-b'],
};

const store = fileURLToPath(new URL('../docs/store/', import.meta.url));

const render = async (browser, { html, width, height, jobs }) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  for (const { query, out } of jobs) {
    await page.goto(`${pathToFileURL(html).href}?${query}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    await page.screenshot({ path: out });
    console.log(out);
  }
  await page.close();
};

const browser = await chromium.launch();
await render(browser, {
  html: `${store}promo/small-tile.html`,
  width: 440,
  height: 280,
  jobs: [{ query: '', out: `${store}promo/small-tile.png` }],
});
await render(browser, {
  html: `${store}screenshots/screenshot.html`,
  width: 1280,
  height: 800,
  jobs: LANGS.flatMap((lang) =>
    Object.entries(SHOTS).flatMap(([shot, imgs], i) =>
      imgs.every((name) => existsSync(`${store}screenshots/src/${name}-${lang}.png`))
        ? [{ query: `shot=${shot}&lang=${lang}`, out: `${store}screenshots/${i + 1}-${shot}-${lang}.png` }]
        : [],
    ),
  ),
});
await browser.close();
