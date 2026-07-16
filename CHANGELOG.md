# 变更记录

本文件记录本项目的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复 · 真机回归两处「UI 撒谎」（QA T2/T5）
v0.2.0 发布前按 `docs/qa/真机回归测试-v0.2.0加固批.md` 做全量真机回归（14 用例），确认并修复 2 处：

- **T2 · 本地图导入后文件夹状态不刷新**：B5 加固让 content 在涉本地图的导入结束后清 vault handle，但 sidepanel 的 `opts.activeFolder/folder` 缓存只在组件挂载时校准——导入完成后素材板/设置仍显示「已连接」「就绪」，切页面才刷新。修：`WorkspaceProvider` 新增 `recalibrateFolders`，涉本地图的导入成功收尾时立即向 content 重新查询两级文件夹状态并回写 `opts`；并在成功 toast 里明确告知「文件夹已安全断开,下篇导入需重新连接」（此前 B5 记录的 UX 待办一并补上）。
- **T5 · 导入报告虚报计数**：报告的「成功」数此前拿 `capability(md)` 的**格式**计数凑数——纯文本段落任何格式类目都不计，「frontmatter + 普通段落」实际写入成功、报告却是 `0 成功`；大文档也虚高（192 vs 实际 174 块）。修：`finishImport` 改用注入引擎回传的真实 `blockCount`（减图片失败数，失败图已降级为文本块不双计）；「降级」保持格式降级项口径。报告卡与历史记录同源跟随。
- 回归中另证实两项为误报/偶发：历史载入确认弹窗正常（上次 FAIL 是「载入内容与草稿全等 → 按设计静默载入」）；append 的 1 个图片失败未复现（标记偶发，后续给报告补失败明细时再观察）。

### 待办（QA 引出）
- 导入报告失败明细：目前失败只有 `imageFail` 汇总数，无图片序号/URL/失败阶段/原因。

## [0.2.0] - 2026-07-16

> 首个真正可用的完整版本（`0.1.0` 为注入引擎尚是 mock 的演示版）。M1–M3 全格式导入落地 + 图片/封面/表格 + 本地图 FS Access + 设置面板诚实化 + 标题冲突询问 + 发布前 4 专项审计加固。

### 修复 · 发布前加固（审计 4 专项 + 交叉验证，13 项）
上线前对注入引擎 / UI 状态机 / 安全合规 / 解析层做了深度审计并修复。分 4 域并行修复后与标题 ask 功能整合。

- **注入 · 标题写进别人那篇文章（P0）**：正文通道已钉死 tabId，但标题阶段每次重解析「当前活动标签」——多图导入 / ask 弹窗挂起期间用户切到另一篇 X 草稿 → 标题静默覆盖那篇。修：`startImport` 开头 `resolveTargetXTab()` 一次钉 `pinnedTabId`，正文 + 标题三处 `setTitleOnXTab` 全部复用。
- **UI · 坏备份砖化面板（P0）**：`importBackup` 裸断言不校验字段，非法 `skin`/缺 `title` → bootstrap 崩且无 ErrorBoundary → 白屏、设置页不可达。修：逐字段白名单校验（枚举回落默认、history 项校验）+ `main.tsx` bootstrap try/catch + 新增 `ErrorBoundary` 兜底恢复 UI。
- **UI · 载入历史/导入 .md 无确认灭当前草稿（P1）**：直接 `setMd` 立即覆盖 storage 不可逆。修：当前草稿非空时弹 `LoadConfirmDialog` 确认。
- **注入 · `importInFlight` 护栏永久卡死（P1）**：置位后的 `blocks.filter` 在 try 外，页面伪造无 blocks 消息抛错跳过 finally → 该页导入永远报 already-in-progress。修：会抛错的语句挪进 try。
- **注入 · verify 失败残留脏 token（P1）**：`return` 不走 catch 兜底 sweep，marker 占位留在草稿；且 X 异步 commit 下单次读易误报。修：失败前重读一轮 + `await sweepMarkers`。
- **安全 · FS handle 暴露整文件夹（P1）**：handle 存 x.com origin IndexedDB，页面脚本可免手势遍历读用户整个文件夹。修：涉及本地图的导入结束后 `clearVaultHandle`，暴露窗口压到单次导入（代价：每篇导入重选文件夹）。
- **UI · 陈旧探针覆盖 X 手打内容（P1）**：`writeX` 用陈旧 `hasContent` 快照决定 ask/replace，可静默 replace 掉用户在 X 编辑器刚打的字。修：`writeX` 决定前即时探测。
- **UI · 弹窗在非草稿 Tab 隐形挂起（P1）**：覆盖/标题冲突/载入确认弹窗只挂 DraftTab，导入期切 Tab 则弹窗随 DraftTab 卸载、importing 卡住。修：三个弹窗提升到 App 层，任何 Tab 可见。
- **解析 · 递归栈溢出白屏（P1）**：深嵌套链接 `[[[…` 让 `walkInline` 栈溢出，`AssetsCard` 渲染体内裸调 parseMarkdown → 白屏。修：`walkInline` 加 depth 上限（100，超限按纯文本）+ 消费方 `useMemo` + ErrorBoundary 兜底。
- **解析 · 文首装饰 `---` 吞正文（P1）**：`---\n\n正文\n\n---` 被误判 frontmatter 静默吞掉正文。修：闭合 `---` 须在首个空行前，parser 与 frontmatter.ts 判定对齐。
- **解析 · 三处 fence 状态机漂移（P1）**：frontmatter/stripFirstImageLine 各写一份简化 fence 追踪 → 代码块内 `# x` 被误取标题、`h1Handle=remove` 破坏代码块。修：抽 `forEachContentLine` 统一三处严格围栏判定。
- **解析 · capability 计数系统性错误 + 「alt 写入图注」虚假宣称（P1）**：独立正则误计表格/H3/删除线/推文；且仍宣称已搁置的自动 ALT 功能。修：计数改为基于 `parseMarkdown` blocks，订正图片项文案（去掉「alt→caption」）。
- **解析 · `javascript:` URL 未过滤（P1）**：`normalizeUrl` 不校验 scheme。修：白名单 http/https/mailto + 相对路径，其余降级纯文本；顺带修 `<>` 包裹截断。
- **安全 · SSRF 尾点绕过（P2）**：`localhost.` 等带尾点 FQDN 绕过黑名单。修：`isBlockedHost` 判定前剥主机名尾点（IPv6 字面量除外）。

### 新增 · 标题冲突 `ask` 询问弹窗
- **`titleConflict='ask'` 接真实实现**：编辑器已有标题时弹窗让用户决定覆盖/保留（此前 `ask` 保守降级为 `keep`）。机制：标题在正文写入后设置，`ask` 模式先以 `keep` 探测——编辑器本无标题则顺便设好（无冲突不打扰）、已有标题则被跳过（`applied=false`）后弹出 `TitleConflictDialog`（显示待写入的新标题 + 覆盖/保留），用户选覆盖才二次 `overwrite`。弹窗经 Promise 化 resolver 暂停/恢复 `startImport` 的 async 流程。仅在**真冲突**时打扰，无冲突静默设置。
- 把设置面板里剩余 3 个「演示 toast」的 action 接上真实功能(纯前端,静态预览验证)：
  - **快捷键**「前往设置」→ `chrome.tabs.create('chrome://extensions/shortcuts')`(纯 UI 预览无 chrome.tabs 时提示地址);
  - **诊断面板**「导出快照」→ 收集探针状态/结果 + 全部设置 + 环境(扩展版本 / UA / 时间)→ 下载 JSON,报障用;
  - **备份与恢复**→ 新模块 `lib/storage/backup.ts`:导出 `prefs + options + history + draft` 为 JSON;恢复校验来源(`app==='markflow'`)后**宽松写回**各切片(缺字段由 `loadX` 合并默认值兜底)、reload 生效,无效文件拒绝。`backup` 行特殊渲染「导出 + 恢复」双按钮(恢复走隐藏 file input)。

### 新增 · 图片压缩（批次 C）+ 修复 · 探针「需刷新」文案区分
- **图片压缩**：新模块 `lib/image/compress.ts`（canvas 缩放 + JPEG 重编码）。**只压 `image/jpeg` 照片**——PNG(截图/文字/UI 图,转 JPEG 会糊 + 缩放让文字变小)、WebP(已压)、GIF(动图)一律保持原样,保护清晰度（实测「截图压完糊掉」后的取舍）;`>150KB` 才压、`maxEdge` 等比缩放(orig=不缩)、**压完更大/异常退回原图**(绝不抛错)。`compress/maxEdge/quality` 经 import 消息传到 content,统一处理所有来源(远程/本地/dataURI)的 File + 封面,并打 console 日志(原体积→压后体积)便于验证。
- **修复 · 探针「需刷新」文案**：当前活动标签**是** X 编辑页但 content 不应答(扩展更新后没刷新等)时,原「未连接:请打开 X 文章编辑页」是误导。新增 `ProbeStatus 'needs-refresh'`(拿到 X 标签但 sendMessage 无应答/抛错)→ StatusBar/PreflightCard/DraftTab 显示「请刷新此 X 页面以启用插件」;当前非 X 页仍「请打开编辑页」。静态预览验证。

### 新增 · scrollTop 接真实实现（批次 B2）+ 修复 · stale-closure / 探针刷新重探
- **scrollTop「完成后滚动到顶部」**：`opts.scrollTop` 经 import 消息传到 content(ISOLATED world 与页面共享 DOM),写入成功后把 X 编辑器滚回文章开头(先滚 window,再沿正文 contenteditable 向上找最近可滚动祖先滚顶)。best-effort、try/catch,失败不影响写入结论;向后兼容。真机验证。
- **修复 · stale-closure**：`startImport` 的 useCallback 依赖逐字段列举、漏了新读的 `opts.scrollTop`/`obsidianImg`/`wikilink` → 「切开关后不改 markdown 直接点写入」读到旧值(关掉 scrollTop 仍滚、B1 的 obsidian/wikilink 切换不生效)。改为**依赖整个 `opts` 对象**,任一设置切换都重建回调,一次修好且防以后再漏。
- **修复 · 探针刷新后自动重探**：`onUpdated` 原只在 `changeInfo.url` 存在时重探,但整页刷新(⌘R)/首次进入时 URL 不变、只有 `status` → 收不到信号,导致「刷新后连不上、要手动点刷新」。改为 `status==='complete'` 时也重探(仍限当前活动 X 标签),刷新/进入编辑页自动连上。

### 新增 · Obsidian 图片 / Wikilink 开关接真实实现（批次 B1）
- **obsidianImg**：关时 `![[x]]` 不再识别为内嵌图片、按普通文本处理(默认开,行为不变)。
- **wikilink**：行内 `[[目标]]` / `[[目标|别名]]` → 纯文本(别名优先);**默认开**(此前是不转的字面保留),关时保持字面 `[[x]]`。
- parser 新增 `parseMarkdown(md, opts)` 参数——用模块级标志在入口设置(parser 同步执行、不重入,免逐层穿参);`WorkspaceProvider`(写入)、`AssetsCard`(图片计数)传 opts,计数与写入一致。8 条 node 用例验证(转纯文本/字面/段落不破/不误吞普通链接图片)。

### 变更 · 设置面板诚实化 · 精简 + 装饰开关置灰（批次 A）
- 盘点发现设置里近三分之二开关「改了不生效」。本批整顿设置面板、不再撒谎(「UI 不撒谎」原则)：
  - **删除 14 个无意义/不可行的项**(选择是假的或功能永远做不了):`altCaption`(ALT 实证不可行)、`graphql`(明确不碰私有接口)、`tableStrategy`/`h4Plus`/`inlineCode`/`tweetUrl`/`divider`(X 平台限制下只有一种合理行为)、`imgFail`、`strict`/`pace`/`htmlBlock`/`footnote`(伪需求/ROI 低)、`codeLang`/`concurrency`(高级微调、受众窄)。config 行 + `options` 字段一并移除;能力仍由「能力映射」卡片体现。
  - **保留但置灰**未接实现的装饰开关(`codeStrategy`/`taskList`/`punct`/`zhConvert`/`retries`)→ desc 标「规划中」/「当前固定」;`SettingsTab` 新增 disabled 渲染(toggle/select 灰化不可交互),置灰控件固定展示「生效档」不读可能过期的存储值。
- 批次 B(低成本接实现:`scrollTop`/`wikilink`/`obsidianImg`)、批次 C(图片压缩)随后。

### 修复 · 图片 marker 残留清理不彻底（多图 fallbackIndex + 异步 commit）
- **正文残留 `__MARKFLOW_IMG_xxx_N__`**：多图导入时某张图走 `relocateMediaByFallbackIndex` 兜底路径（精确 relocate 失败 → 只确认 MEDIA 存在、不删 marker 块，留给 `sweepMarkers` 收尾）后，`sweepMarkers` **单次**清扫因 X 的 `onChange` 异步 commit、读到 fiber 中间态而漏删 → 正文留下 marker 脏 token（真机见最后一张图 `_4_` 残留）。改 `sweepMarkers` 为**多轮重试**（每轮留时间让 X commit、读最新 state 删残留，直到某轮无残留或达 4 轮上限）。

### 新增 · 「打开 X Articles」按钮 · 修复 · 图片 `<>` 路径 / 封面弹窗未关 / 清空状态残留 · 记录 · postMessage 私有化回退
- **修复 · 图片路径 `<>` 包裹（含空格）解析失败**：CommonMark 规定 destination 含空格时须用尖括号包裹（`![](<images/a b.png>)`）——原 parser 未剥尖括号，`source` 带字面 `<>` 导致**本地图读取全失败**（真机 `imageFail` 13/13）。修复：`matchImageLine` 感知 `<>`（尖括号内的 `)` 不再误判为 destination 闭合）+ 新增 `normalizeImageSrc` 剥括号并**保留路径空格**（不像行内链接那样截到第一个空白）；裸图 `![](<x>)` 与带链接图 `[![](<x>)](y)` 均适用。8 条用例实跑覆盖（含空格/含 `)`/尾随 title/多图/空 src/回归）。
- **修复 · 封面裁剪弹窗点 Apply 后未关闭**：`setCoverImage` 原用裸 `.click()` 点弹窗内 Apply，对 X 的 React 裁剪按钮偶发不触发（点了、`coverSet` 谎报 `true`、弹窗却残留）。改用 `realClick` 派发**完整鼠标事件序列**（pointer/mouse down→up→click）+ 用稳定 `data-testid="applyButton"` 定位 + **轮询确认弹窗真的关闭才算成功**（没关就重点，最多 5 轮）；`coverSet` 不再谎报。
- **修复 · 清空 / 换稿后过期状态卡片残留**：清空 markdown（及载入示例 / 读文件 / 载入历史 / 编辑输入）后，旧的「预检结果」「导入报告」卡片仍展示旧内容的结果。改为在 `setMd`（所有「内容替换」的唯一入口）统一收起预检（`checkVisible`/`checkStep`）与报告（`reportVisible`），过期结果不再残留。
- **修复 · 代码块语言标签 `plain&#x20;text`（HTML 实体 / 含空格 info）**：源 md 的代码围栏 info string 带 HTML 数字实体（`&#x20;`，常见于 HTML 导出的 md）或空格时，X 把它当成含空格的语言名、渲染出 `plain&#x20;text` 难看标签。parser 归一 info：**解码数字实体 + 只取第一词作语言**（CommonMark），`plain&#x20;text` / `plain text` → `plain`，正常语言不变、无语言块保持无语言；代码内容与闭合围栏原样保留。6 用例实跑覆盖。
- **修复 · 行内代码降级（X 正文不支持）**：真机确认 X Articles 正文**不支持行内代码**（快捷键/工具栏仅 Bold/Italic/Underline/Strikethrough/链接/列表/引用 + 块级 Code，无行内代码），原写 `CODE` inline style 不渲染。改为 parser 降级：**原样保留反引号纯文本**（`` `code` ``）——读者可辨识代码/字面量（尤其 `<占位符>`）、不虚报样式；能力映射文案订正为「X 不支持·保留反引号 `code`」。粗体/斜体/删除线不受影响，`protocol.ts` 的 `CODE` 枚举保留兼容（injector 仍能处理，若 X 日后支持可快速恢复）。
- **「打开 X Articles」按钮接真实跳转**：待发布页「未连接」提示里的按钮从演示 toast 改为 `chrome.tabs.create` 打开 X Articles 编辑器入口（`x.com/compose/articles`）；纯 UI 预览无 `chrome.tabs` 时降级 `window.open`，不崩。
- **记录 · `postMessage`→MessageChannel「私有通道」验证不可达成并回退**：曾试图把 content↔injector 通信私有化，以对 x.com 页面脚本隐藏图片/封面 File 字节（分支 `feat/messagechannel-private`）。经两轮并行 code review + 实测确认不可行并**回退**：injector 在 MAIN world 与页面共享 window + JS 堆，借 `onFilesAdded` 上传时 File 必进 MAIN world 即被同 world 页面脚本可读；且 `window.postMessage(hello, origin, [port2])` 的 port 对**所有** window 监听器（含页面脚本）可见，MessageChannel 仅挡被动 `window.onmessage` 监听、挡不住主动脚本。**MAIN world 架构固有限制，不可修**，详见 HANDOFF §8。

### 新增 · 本地图按需授权（两级文件夹 + 一键恢复）
- **两级文件夹**：本地图读取新增 `active`（素材板「本篇图片文件夹」）与 `persistent`（设置默认文件夹）两个作用域，各存独立 IndexedDB key（persistent 复用旧 `vault_root`，升级不丢已连接的设置文件夹）。导入读取**逐文件兜底** active > persistent > 降级（`resolveLocalImageAcrossScopes`）：active 里没有某张图时才去 persistent 找，active 只是优先来源、不整体架空兜底文件夹。
- **素材板入口**：含本地图时，素材卡片出现「本篇图片文件夹」行，可就地连接/更换/清除本篇专用文件夹——素材与文章对应，换文章即换文件夹，免去每次进设置。就绪判定认 active∥persistent 任一已连。
- **一键恢复**：浏览器重启后 FS Access 读权限回落（安全策略),但 handle 仍在 IndexedDB。此时素材板/设置显示「需重新授权」+「恢复」按钮，点击直接对存量 handle `requestPermission`（只弹一次「允许读取 <文件夹名>」），**免去重新翻找并重选文件夹**；「更换」（`forcePick`）才走完整 `showDirectoryPicker`。
- **协议**：`VaultScope` 作为共享契约类型；`connect/clear/folder-status` 请求带 `scope`，connect 带 `forcePick`；content 侧 `messageScope` 归一（旧消息缺字段回落 persistent，不裸信任）。

### 新增 · 探针自动重探 + tab 定位跟随当前标签
- **自动重探**：ProbeProvider 监听 `browser.tabs.onActivated`（切换标签）+ `onUpdated`（当前活动 X 标签内 SPA 导航，如切换文章），400ms 防抖后自动 refresh——打开/切到/离开 X 编辑页时连接状态自动更新，免手动点刷新。手动刷新按钮保留。
- **tab 定位改为跟随当前活动标签**：`resolveTargetXTab` 从「找任意打开的 X 标签」改为「只认当前活动标签，是 X 才连、否则未连接」。探针 + 写入 + 标题 + 封面 + 文件夹共用此定位，始终一致（不会探 A 写 B）；切到非 X 标签即显示未连接、写入禁用。

### 新增 · 本地图片（File System Access）
- **本地图上传**：`![](assets/x.png)` 相对路径、Obsidian `![[y.png]]` 内链 → 从用户授权的文件夹读取上传。parser 新增 `![[x]]` 图片块识别。
- **授权与持久**：content 在 X 页弹一次性浮层（页面手势）调 `showDirectoryPicker` → `FileSystemDirectoryHandle` 存 x.com origin 的 IndexedDB（`lib/bridge/localVault.ts`），跨会话 `queryPermission` 复活。
- **路径安全器** `parseLocalImagePath`：拒绝 `..` 逃逸/绝对路径/盘符，`%20` 解码，子目录逐级 `getDirectoryHandle`；「路径首段 == 文件夹名」时剥离首段（先原路径、失败再剥）。
- **健壮性**（本地 review + Codex 修）：folder 状态门控读权限（浏览器重启权限失效时 UI 显示未连接、不撒谎）+ 设置挂载校准；本地图 16MB + MIME 白名单（与远程/dataURI 对齐）；授权浮层 `onInvalidated` 清理 + 180s 超时 + 防并发浮层；错误码本地化。
- **已知项**：本地图 File 字节经 `postMessage` 到 MAIN world，x.com 页面脚本理论可读（与远程/dataURI 同面）；根治 MessageChannel 留单独 PR。

### 新增 · 原生表格 + 修复 · 图片 marker 残留（PR #7）
- **原生表格**：GFM 表格（表头行 + 紧跟分隔行 `| --- |`）→ `MARKDOWN` atomic block。console 勘察**实证 X 的表格与代码块共用 `MARKDOWN` entity**（`data.markdown` 存 GFM 原文），故 parser 一处识别即可、injector/协议**零改动**，X 原生渲染成表格。段落紧跟表格正确分离；纯 `---` 分割线、含 `|` 普通文本不误判（分隔行须含 `|` 与 `-`）。能力映射「原生表格」名副其实。
- **修复 · 图片 marker 残留**：`sweepMarkers` 改用通用前缀 `__MARKFLOW_IMG_`（原只清本次随机 prefix），清掉走 fallbackIndex 未删的本次残留 + 同一草稿反复导入的历史遗留 marker（如 `__MARKFLOW_IMG_ngvm6j_2__`）。

### 修复 · M2 Phase 2 code review（PR #6，16 条）
- **P0**：封面「按文案猜按钮」误点不可逆动作（限裁剪弹窗内 + 收窄文案）；上传失败误报成功（照 xposter §3.2 加 pending 稳定性判定 + fallbackIndex 归位）；SSRF 前缀误伤合法域名 `fc2.com`（fc/fd 仅 IPv6 字面量判）；`postMessage('*')` 广播本地图 File 字节（收敛 targetOrigin）。
- **P1**：SSRF via DNS（wildcard-DNS 后缀黑名单 + 残留风险标注）；background sender 校验；图片行手写括号配对（多图不损坏 source）；协议相对 URL → remote；下载并发池（限 3）；双击同步锁。
- **P2**：AssetsCard 预览按块级图口径（行内图不虚报、本地图「暂不支持」、封面来源一致）；extractCover 支持 `[[x]]`；coverSet 契约对齐。

### 新增 · M2 Phase 2b — 文章封面（已合并 PR #5，真机验证）
- **封面设置**：来源 frontmatter `cover:`（支持 `![[x]]` / `![](x)` 包裹剥壳）> 正文首图，gated by 设置「设置文章封面」（默认关）。content 准备封面 File → injector 在 MAIN world 把 File 塞进 X 的封面 `fileInput`（`input.files = DataTransfer.files` + dispatch change）→ X 弹出「Edit media」裁剪弹窗 → **自动点 Apply 落地**（真机验证:fileInput 定位/上传都对,只差 Apply 这一步）。`coverSet` 仅在点到 Apply 时为 true,不谎报。
- **首图去重**：`coverKeep=remove` 且封面取自正文首图时，从正文移除首个独占图片行（`stripFirstImageLine`，裸图/带链接图皆可，跳过代码块）。
- 远程封面 host 权限连同正文远程图在写入手势内一并申请；封面结果计入 toast（`· 封面`）。封面失败不影响正文成功结论。

### 新增 · M2 Phase 2 — 图片上传：远程 + dataURI（已合并 PR #4）
- **图片上传引擎**：独占一行的 `![alt](src)` 及**带链接图片** `[![alt](img)](link)`（推文转 md 常见，取内层图片 URL 上传、丢外层链接）→ `ImageBlock`；injector 走「marker 占位 → `onFilesAdded` 交 File → 轮询新增 MEDIA entity + 递归挖 mediaId → 归位到 marker 处 → 清 marker」异步事务；上传失败降级写回原文，不静默丢内容。遵守 M1 三条 Draft 直写硬约束。
- **远程图片**：background service worker 代理下载，含 SSRF 防护（私网/回环/链路本地 + IPv4-mapped IPv6 黑名单 + 跟随重定向后复检最终落点）、流式读取 + 16MB 体积上限、magic-byte 真实类型嗅探（响应头/扩展名不可信）；`optional_host_permissions` 在写入手势内按图片 origin 运行时申请。
- **dataURI**：content 就地解析（白名单图片 MIME，容忍 charset 等参数）。
- **健壮性**：injector 并发导入护栏（防重试并发写坏 Draft）；content→injector 通道超时随图片数放大（`45s + 图数×40s`，防慢图/多图误判超时并丢弃成功结果）；图片上传结果如实计入 toast 与历史记录。
- **两轮 code review**（注入正确性 + 跨 world 数据流/安全）修复 7 条阻断/安全问题：超时不放大、`sweepMarkers` 删空导致空 blockMap 崩、权限申请 `contains` 预检打断手势链、SSRF IPv4-mapped/重定向绕过、体积上限读完才判导致内存耗尽、dataURI 参数误伤等。
- **已知差异（待真机验证后精修）**：多图 relocate 未清理 X 原子插入产生的空分裂块（正文可能多空行）；marker 被 X 插入破坏时无 fallback 顺序配对（多图可能错位）。
- **暂未做**：本地图片文件夹（FS Access 授权）、封面设置（走 X 封面 fileInput）——留待下一 PR。

### 新增 · M2 Phase 1 — 标题设置（PR #2）
- **文章标题自动设置**（仅 UI 通道）：`extractTitle` 抽取（frontmatter `title` > 正文首个 H1，跳过代码块），injector `setTitle` 打分定位标题输入框写入；`h1Handle=remove` 时在 md 文本层去重首个 H1（`stripFirstH1`）。GraphQL 通道（queryId 易随 X 发版失效）留 TODO。
- **frontmatter 不再泄入正文**：parser 跳过文首 `---…---` 块（此前会被当「分割线+文本+分割线」写入正文）。

### 修复 · M1 code review 遗留（PR #2）
- `connected` 去掉 articleId 要求 → 新建文章页（URL 无 `/edit/数字`）也可写。
- `editorHasContent` 接真实探针 `hasContent`（不再恒 true）；写入成功后重探，避免二次写入静默覆盖。
- `ImportResult` 回传 `effectiveMode`：append 被降级为 replace 时明确提示。
- `locateXTab` 统一 tab 定位；`content.ts` 抽通用请求桥（probe/import/set-title 三通道复用，含 kind 校验防串扰）。
- 标题打分加关键词硬门槛 + 排除正文编辑器（防误命中清空正文）；标题冲突 `ask` 暂按保守 `keep`。

### 新增 · M1 — 注入引擎（PR #1）
- **三方通信架构**：`content.ts`(ISOLATED) + `injector.ts`(MAIN world，injectScript 注入) + `lib/bridge/protocol.ts` 类型化消息协议，nonce 握手 + 并发中转。
- **fiber 探针（三灯）**：定位正文编辑器 / Draft 实例（`editorState`+`onChange`）/ `onFilesAdded` 上传回调，算法照搬 xposter 实证；状态条、预检卡、写入按钮门控全部接真实探针。
- **Draft.js 直写引擎**：借页面 Immutable 构造器逐块构造 blockMap → `EditorState.push` + `onChange`；replace/append 双模式；支持标题、粗/斜/删/行内代码、链接（LINK entity）、有序无序列表、引用、代码块（MARKDOWN entity）、分割线（DIVIDER）、推文（TWEET）。
- **Markdown 解析器** `lib/markdown/parser.ts`：递归下降行内解析（offset 精确），块级映射按技术方案 §4.2。
- **品牌图标**：3a 方案（M 造型 + 蓝点），16/32/48/128。
- 移除 UI 文案中的竞品对比表述（改为中性描述）。
- 删除旧 mock 假进度服务 `lib/workspace/importService.ts`。

### 新增 · Phase D — 设计稿↔实现对照（已随 M1 合并）
- `docs/qa/`：`comparison.html`（13 组视图双图并排 + 结论）、`README.md`、`shots/`（26 张基准截图）。结论：四主题 × 中英还原度整体很高。

### 待办
- **M2 Phase 2 收尾**：本地图片文件夹（FS Access 授权 + IndexedDB 存 handle）、封面设置（X 封面 fileInput）；真机验证后精修多图 relocate 的空块清理与 fallback 配对。

## [0.1.0] - 2026-07-13

首个可加载版本：完整的 Side Panel UI（注入引擎暂为 mock 时序演示）。

### 新增
- **项目脚手架**：WXT + React 18 + TypeScript（MV3），pnpm，本地打包字体。
- **四套界面主题**：极简 / 控制台 / 纸感 / 玻璃，各含明暗档位，CSS 变量驱动、首帧前同步应用避免闪烁；单模式主题（控制台/纸感）自动隐藏明暗切换。
- **应用外壳**：Header（品牌 / 中英切换 / 主题切换）、探针状态条、三 Tab 导航、全局 Toast。
- **「待发布」Tab**：Markdown 编辑器（工具栏语法插入 / 编辑·预览切换 / react-markdown 预览 / 三步空态 / 拖放导入）、素材卡（封面来源 + 图片清单及本地图/远程/dataURI 状态）、能力映射面板、预检结果（序贯揭示）、导入报告、覆盖确认弹层、Footer（统计 + 预检 + 写入 / 分阶段进度条 + 取消 / 庆祝动画 + 完成音效）。
- **「记录」Tab**：导入历史列表、搜索、载入 / 复制 / 删除、清空全部（二次确认）、空态。
- **「设置」Tab**：主题四宫格 + 九组折叠设置（界面 / 导入行为 / 标题与封面 / 内容转换 / 图片与媒体 / 成功反馈 / 记录与数据 / 快捷键 / 高级），开关 / 下拉 / 动作三型控件，全部按《技术方案设计.md》§5.2.4 落地。
- **状态与持久化**：PrefsProvider（主题/语言）、SettingsProvider（导入选项）、WorkspaceProvider（草稿/记录/导入时序），经 chrome.storage.local 持久化（非扩展环境回退 localStorage）。
- **中英双语**全 UI。

### 说明
- 「写入 X 文章」、预检、连接文件夹等为 **mock 时序演示**（`lib/workspace/importService.ts`、`lib/bridge/useConnection.ts` 等），真实注入引擎待 M1 接入。
- 设计稿「演示专用」内容（模拟 X 编辑页、setTimeout 时序）未照搬进产品。

[Unreleased]: https://github.com/jiangding01/x-md-importer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jiangding01/x-md-importer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jiangding01/x-md-importer/releases/tag/v0.1.0
