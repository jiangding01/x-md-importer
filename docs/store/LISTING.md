# Chrome 应用商店上架资料

开发者后台各栏要填的内容，按后台页面顺序排列。代码块里的文字可以直接复制；商店的详细说明不渲染 Markdown，所以用纯文本。

改了权限、功能或数据处理方式时，同步改这里和 [docs/privacy-policy.md](../privacy-policy.md)，再到后台更新。

> 首次上架用 v0.5.1 及以后的版本：界面支持英文（默认）和简体中文，跟随浏览器语言。
> 名称里的「X」只用来说明用途（导入到 X 文章）。商标风险的处理与 x-gif-saver 一致：介绍和隐私政策都写明「与 X Corp. 无关」；图标不用 X 的 logo；名称和介绍里不出现「官方」之类的字眼。
> 仓库目前公开，但 README 写的是「私有项目，暂未开源」、没有 LICENSE 文件，所以介绍里不写「开源」，只给 GitHub 反馈地址。以后加了许可证再补。

## 1. 商品详情（Store listing）

### 名称与简短说明（从安装包读取，不在后台填）

商店列表页的名称和副标题取自 manifest，文案在 `public/_locales/{en,zh_CN}/messages.json` 的 `extName`、`extDesc`，改这里要同步改那里：

```text
MarkFlow — X 文章 Markdown 导入器
把 Markdown 一键导入 X 文章编辑器，全格式自动排版。本地优先，无遥测，不向开发者服务器发送任何数据。
```

```text
MarkFlow — Markdown to X Articles
Import Markdown into X articles, formatting preserved. Local-first, no telemetry, nothing sent to developer servers.
```

### 详细说明 · 简体中文

```text
在 X（Twitter）上写长文章，最麻烦的是排版：从编辑器或笔记软件复制过去，标题、代码块、表格、图片常常变形或丢失。MarkFlow 在浏览器侧边栏里放了一个 Markdown 工作台，写好或粘贴进来，点一下「导入到 X」，就按 X 文章编辑器自己的格式写进去。

【主要功能】
• 全格式导入：标题、粗体 / 斜体 / 删除线、链接、有序 / 无序列表、引用、分割线，以及 X 原生的代码块、表格和 LaTeX 公式块
• 图片自动上传：网络图片、data URI，以及本地文件夹里的图片（含 Obsidian 的 ![[图片]] 写法）都会上传到文章里；可选上传前压缩
• 标题与封面：frontmatter 的 title / 正文第一个一级标题设为文章标题，frontmatter 的 cover / 正文首图设为封面
• 推文嵌入：单独一行的推文链接变成推文卡片
• 导入前先看清楚：「能力映射」逐项列出每种 Markdown 元素会变成什么；X 不支持的写法（脚注、HTML、行内公式等）会明确标出并保留原文，不会悄悄丢掉
• 预检：导入前检查当前页面、编辑器和上传通道是否就绪，切换标签或刷新页面后自动重新检查
• 导入报告：每处成功、降级、失败都列出来，图片失败会说明原因
• 草稿与记录：草稿自动保存在本机，导入记录可以搜索、载入、复制、重新导入
• 四套界面主题（极简 / 控制台 / 纸感 / 玻璃，可切深浅色），中英文界面

【不会做的事】
• 永不自动发布：只写进你打开的编辑页，发布按钮永远由你来点
• 不使用 X 的付费 API，不读取你的 X 账号信息

【隐私】
草稿、导入记录和设置只保存在你的浏览器里，没有统计、广告或账号，不向开发者或任何第三方服务器发送数据。只有导入的文章里有网络图片时，才会在你确认后访问图片所在的网站下载图片，不携带 cookie。

【使用前提】
需要能使用 X 文章（Articles）功能的账号，并在电脑版 Chrome 116 及以上打开 X 文章编辑页。

问题与建议：https://github.com/jiangding01/x-md-importer/issues

本扩展为独立开发，与 X Corp. 无关，也未获其认可。
```

### 详细说明 · English

```text
Writing long-form articles on X (Twitter) usually means fighting the formatting: paste from a Markdown editor or a notes app and headings, code blocks, tables and images get mangled or lost. MarkFlow puts a Markdown workspace in the browser side panel. Write or paste your draft, click "Import to X", and it is written into the X article editor using the editor's own formatting.

FEATURES
• Full formatting: headings, bold / italic / strikethrough, links, ordered and bulleted lists, quotes, dividers, plus X's native code blocks, tables and LaTeX blocks
• Images uploaded for you: web images, data URIs and images from a local folder (including Obsidian's ![[image]] embeds) are uploaded into the article, with optional compression
• Title and cover: the frontmatter title or the first H1 becomes the article title; the frontmatter cover or the first image becomes the cover
• Post embeds: a post link on its own line becomes an embedded post card
• Know before you import: the Capability Map shows what each Markdown element will turn into. Syntax X can't show (footnotes, HTML, inline math and so on) is listed and kept as plain text, never silently dropped
• Preflight: checks that the page, the editor and the upload channel are ready, and re-checks automatically when you switch tabs or reload
• Import report: every success, fallback and failure is listed, with the reason for any failed image
• Drafts and history: your draft is saved locally; past imports can be searched, loaded, copied and imported again
• Four interface themes (Minimal, Console, Paper, Glass, with light and dark modes), English and Simplified Chinese

WHAT IT NEVER DOES
• Never publishes: it only writes into the editor page you have open. Publishing is always up to you
• Doesn't use X's paid API and doesn't read your X account

PRIVACY
Drafts, import history and settings stay in your browser. No analytics, ads or accounts, and nothing is sent to the developer or any third-party server. Only when an article contains web images does the extension, after you approve, fetch those images from the sites that host them, without cookies.

REQUIREMENTS
An X account that can use the Articles feature, and the X article editor open in desktop Chrome 116 or later.

Bug reports and ideas: https://github.com/jiangding01/x-md-importer/issues

MarkFlow is an independent project. Not affiliated with or endorsed by X Corp.
```

### 其他字段

| 字段     | 填写                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 类别     | 工具（Tools）                                                                                                               |
| 语言     | English（默认，由 manifest 的 `default_locale` 决定）和简体中文，各填对应语言的介绍；名称和简短说明从安装包读取，不在后台填 |
| 官方网址 | 不填（需要先在 Search Console 验证域名）                                                                                    |
| 主页网址 | `https://github.com/jiangding01/x-md-importer`                                                                              |
| 支持网址 | `https://github.com/jiangding01/x-md-importer/issues`                                                                       |
| 成人内容 | 否                                                                                                                          |

## 2. 隐私权（Privacy practices）

后台审核员看的是英文，下面各项用英文填。

### 单一用途（Single purpose）

```text
Import Markdown into the X (Twitter) article editor. The user writes or pastes Markdown in the extension's side panel; the extension converts it and writes it, with its images, into the X article editor page the user has open. It never publishes.
```

### 权限理由（Permission justification）

`storage`

```text
Saves the user's Markdown draft, import history and settings in chrome.storage.local so they survive closing the side panel or restarting the browser. Nothing is synced or sent anywhere.
```

`unlimitedStorage`

```text
The draft and the import history keep full article text, and long articles with many past imports can exceed the default 10 MB chrome.storage.local quota. Without this permission the draft could silently fail to save. Data stays on the user's device.
```

`sidePanel`

```text
The extension's whole interface (Markdown editor, preview, capability map, import report, history and settings) is shown in the browser side panel next to the X article editor, so the user can see both at once.
```

主机权限（Host permission）

```text
x.com and twitter.com: a content script detects whether the current tab is an X article editor, and injects a bridge script into that page to write the converted content and upload the article's images through the editor itself. No other sites are accessed by default.

Optional host permission *://*/*: not granted at install. Only when an article contains web images (![](https://...)), the extension asks, in one Chrome prompt per import, for access to just the sites hosting those images, then downloads the images (without cookies) so they can be uploaded to the article. If the user declines, those images are kept as plain text.
```

### 远程代码（Remote code）

选「否，我未使用远程代码」：所有 JS 都打在包内；注入 X 页面的 `injector.js` 也是包内文件（`web_accessible_resources`）。从网上下载的只有文章引用的图片数据，不执行。包里没有 `eval`、`new Function`、`importScripts`。

### 数据使用（Data usage）

- 收集的用户数据类型：**全部不勾选**。草稿、导入记录和设置只在本机保存；本地图片文件夹只在用户主动选择后读取文章引用的图片；这些都不传出设备，按商店的定义不算「收集」。图片上传是用户主动把内容写进自己的 X 文章，由 X 页面完成
- 三条声明全部勾选：
  - 不出于已获批准的用途之外的目的向第三方出售或转移用户数据
  - 不出于与商品的单一用途无关的目的使用或转移用户数据
  - 不为确定信用度或用于贷款目的而使用或转移用户数据

### 隐私权政策网址

```text
https://github.com/jiangding01/x-md-importer/blob/main/docs/privacy-policy.md
```

## 3. 分发（Distribution）

| 字段     | 填写                                                     |
| -------- | -------------------------------------------------------- |
| 付费     | 免费                                                     |
| 可见范围 | 首发选「不公开」（Unlisted），自己装一遍验收后改「公开」 |
| 地区     | 所有地区                                                 |

提交时勾选「通过审核后自动发布」：可见范围是「不公开」，自动发布后也只有拿到链接的人能装。不勾选的话，审核通过后要在 30 天内手动发布，否则过期。

## 3.1 测试说明（Test instructions）

左侧「访问权限 → 测试说明」。X 的文章编辑器只对部分账号开放（目前需要 X Premium 订阅），审核员很可能进不去，这是最容易被拒的地方，所以写清楚两条路径：没有文章权限时能验证的部分，和有权限时的完整流程。

````text
How to test:

Without X Articles access (most of the extension can still be checked):
1. Click the MarkFlow toolbar icon to open the side panel. Any page works.
2. Paste the sample Markdown below into the editor. The live preview, the Capability Map (what each element becomes in X) and the asset list update as you type.
3. Click Preview to see how the article will look in X. Settings, History and the four themes are all usable without an X account.
4. The status bar will say no X article editor is detected and the Import button stays disabled. That is expected: the extension only writes into an open X article editor.

With X Articles access (X Premium account):
5. Open https://x.com/compose/articles and create a new article, then open the MarkFlow side panel. The status bar shows the editor is connected.
6. Click "Import to X". The headings, list, quote, code block, table and image appear in the X editor. A report lists what was imported. The article is NOT published; publishing is always left to the user.

Sample Markdown:
# Hello from MarkFlow

Some **bold**, *italic* and a [link](https://example.com).

- First item
- Second item

> A quote

```js
console.log('code block');
```

| Name | Value |
| ---- | ----- |
| A    | 1     |

![Sample image](https://pbs.twimg.com/media/HOAmor3boAAvXUp?format=png&name=small)

The image is hosted on X's own media server. When importing, Chrome asks once for permission to access it; this optional permission is requested only for sites that host images in the article.

No account, API key or server is needed by the extension itself.
````

> 示例图片用的是作者自己发在 X 上的图（`pbs.twimg.com/media/HOAmor3boAAvXUp`），审核期间不要删除。换图时选一张公开、稳定的图片地址，并用上面的文本同步替换。

## 3.2 开发者账号设置

账号级设置已在 x-gif-saver 上架时完成（联系邮箱已验证、非交易者、地址不填、商品支持关闭、审核通知开启），本扩展沿用，无需重新设置。

## 4. 素材

| 素材     | 规格                        | 状态                                                                                                                                                                                     |
| -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 商店图标 | 128×128 PNG                 | 已有 `public/icon-128.png`                                                                                                                                                               |
| 截图     | 1280×800 或 640×400，1–5 张 | `docs/store/screenshots/{1..5}-*-{en,zh}.png`，按序号顺序上传：「以当地语言显示的屏幕截图」中英文列表各传对应语言的 5 张；「全球通用的屏幕截图」是必填项，传英文 5 张                  |
| 小宣传图 | 440×280                     | 全语言共用，不能按语言分别上传，只做英文版 `docs/store/promo/small-tile.png`                                                                                                             |
| 大宣传图 | 1400×560                    | 可选，不做                                                                                                                                                                               |

小宣传图和截图都用 HTML 排版后导出 PNG（不带透明通道，符合商店要求），运行 `node scripts/render-promo.mjs` 一次导出全部。为了不给项目加依赖，脚本用的 Playwright 不在本仓库里，需要指向一份已安装的 `playwright-core`（或 `@playwright/test`）：

```bash
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.mjs node scripts/render-promo.mjs
```

- 小宣传图：`docs/store/promo/small-tile.html`
- 截图：`docs/store/screenshots/screenshot.html` 负责左侧标题和说明（文案写在文件里），右侧放 `src/<图名>-<lang>.png` 界面截图；图名为 `write`、`map`、`import`、`report`、`themes`。界面改版后重拍对应截图，替换 `src/` 里的文件再导出
- 侧边栏界面截图的采集方式见 [docs/qa/README.md](../qa/README.md)「采集口径」；`import` 一张是真实 X 文章编辑页加侧边栏，在作者自己的账号下截取

截图里出现的账号是作者自己的（`@jiangding01`）；换用别人的内容时，头像、用户名要打码。
