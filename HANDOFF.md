# HANDOFF · 跨机器接力文档

> **这份文档的用途**：让在**另一台电脑**上的 AI Agent（或你本人）能无缝接续开发，无需重新摸索上下文。
>
> **维护约定（重要）**：
> - 每次「阶段性功能完成 → 提交代码」时，**必须同步更新本文档**，使其始终反映最新进度、未完成任务与后续规划。
> - 本文档随代码一起提交到 git 仓库。任何一台电脑上开发，都按此约定更新并提交。
> - 更新时重点维护：`## 当前进度`、`## 待办与路线图`、`## 最近一次会话小结`，并在顶部更新「最后更新」。

**最后更新**：2026-07-13 · 个人电脑（初始开发）· 分支 `main`

---

## 0. TL;DR（30 秒了解现状）

- **是什么**：Chrome MV3 扩展，把 Markdown 一键导入 X（Twitter）Articles 长文编辑器，全格式排版，不用官方 API。
- **现在到哪了**：**侧边栏 UI 全部完成并验证**（Phase A 脚手架+四主题 / Phase B 待发布 Tab / Phase C 记录+设置 Tab）。`pnpm build` 可出包并加载。
- **还没做**：真实的 Draft.js **注入引擎**——目前「写入 X」「预检」「连接文件夹」等都是 **mock 时序演示**，接口已预留，等 M1 替换。
- **下一步**：Phase D 最终 QA → M1 实现注入引擎（M0 探针已验证过关键假设，产物在 `docs/research/m0/`）。
- **怎么跑**：`pnpm install && pnpm build` → Chrome 加载 `.output/chrome-mv3`。详见 §7。

---

## 1. 项目背景与目标

用 Markdown 在本地起草长文，一键导入到 **X Articles 编辑器**（`x.com/compose/articles`），保留标题/粗斜删/链接/列表/引用/**代码块/表格/图片/分割线/推文嵌入**等排版。**纯浏览器层**完成（不走 X 官方付费 API），**永不自动发布**（发布留给用户）。

- 产品功能规格与注入方案的**事实基座**：[`docs/技术方案设计.md`](./docs/技术方案设计.md)（v1.2，含 §5 功能规格清单、§2–4 注入路线、§9 里程碑）。
- X Articles 编辑器 = **Draft.js**（官方 API 文档确认正文即 DraftJS ContentState）。关键实测：合成 `ClipboardEvent('paste')` 是唯一可靠富文本注入通道；`execCommand` 不进 Draft 状态；代码块=`MARKDOWN` entity、分割线=`DIVIDER`、推文=`TWEET`、图片=`MEDIA`（atomic）。

---

## 2. 技术栈与约定

- **WXT + React 18 + TypeScript（MV3）**，**pnpm**。
- **函数组件，禁用 class**（用户偏好）。ESM，命名导入优先。
- **主题 = CSS 变量**：四套主题是同一张变量表（`--p/--ink/--acc/--rEl/--btnBg…`）的不同取值，切主题 = 整套替换 `:root` 上的变量。所有组件用 `var(--x)` 内联样式；`:hover` 等伪类用 `global.css` 里的少量 `.mf-*` 工具类。
- **像素级还原设计稿**：所有尺寸/颜色/字号/圆角/动效均照抄设计稿，改动即偏离。
- **提交约定**：仅在用户要求时 commit/push；每次提交前更新本文档 + CHANGELOG。

---

## 3. 仓库结构与关键文件

```
entrypoints/
  background.ts                 # service worker：点击图标开侧边栏
  sidepanel/
    main.tsx                    # 入口：并行加载 prefs/opts/draft/history → 首帧前应用主题 → 挂 3 层 Provider
    App.tsx                     # 外壳：Header + StatusBar + Tabs + 按 tab 渲染 + Toast
    types.ts                    # Tab 类型
    styles/global.css           # reset / 关键帧 / 基础 token 兜底 / .mf-* hover 工具类
    components/
      Header.tsx StatusBar.tsx Tabs.tsx Toast.tsx
      draft/    DraftTab EditorCard DraftRow AssetsCard CapabilityPanel PreflightCard ReportCard OverwriteDialog Footer Celebration
      history/  HistoryTab
      settings/ SettingsTab
lib/
  theme/themes.ts               # ⭐四主题变量表（skinVars 移植）+ resolveDark + applyThemeVars + skinSwatch
  theme/useTheme.ts
  i18n/dict.ts                  # 中英字典（dict 移植）+ resolveLang
  i18n/useI18n.ts
  prefs/PrefsProvider.tsx       # 主题/语言状态 + 持久化 + 应用变量 + 跟随系统明暗
  settings/options.ts           # Options 模型 + defaultOptions
  settings/SettingsProvider.tsx # opts 状态 + 持久化
  settings/config.ts            # 九组设置的配置数据（settingsConfig 移植，双语）
  workspace/WorkspaceProvider.tsx  # ⭐草稿/记录/tab/导入·预检·报告等全部时序状态与动作
  workspace/importService.ts    # 导入分阶段时序（当前 mock，M1 替换实现，保持接口）
  markdown/Preview.tsx          # react-markdown + remark-gfm，components 映射对齐设计稿
  markdown/capability.ts        # 能力映射分析 capability() + images() + firstTitle()
  markdown/sample.ts            # 「载入示例」用 Markdown
  storage/store.ts              # chrome.storage.local 封装（回退 localStorage）
  storage/{prefs,optionsStore,draftStore,historyStore}.ts  # 各持久化切片
  bridge/useConnection.ts       # 与 X 页面连接状态（当前 mock，M1 接真实探针）
docs/
  技术方案设计.md               # 事实基座
  research/xposter-analysis.md  # 竞品 xPoster 源码深析（注入引擎实现范本）
  research/m0/                  # M0 探针产物（entity 渲染截图等）
  research/screenshots/         # X 编辑器实机勘察截图
```

## 4. 架构：状态与执行环境

**状态分三层 Provider**（`main.tsx` 中嵌套，均在首帧前从 storage 加载初值）：
1. `PrefsProvider` — skin / theme / accent / lang，负责应用 CSS 变量、跟随系统明暗。派生 `useTheme` / `useI18n`。
2. `SettingsProvider` — 全部导入选项 `Options`（`useSettings` 的 `opts` / `setOpt`）。
3. `WorkspaceProvider` — 草稿 `md`、`history`、当前 `tab`、以及导入/预检/报告/覆盖/庆祝/toast 等全部时序状态与动作（`useWorkspace`）。这是设计稿 `renderVals()` 的等价物。

**执行环境**：目前只有 `background`（开侧边栏）+ `sidepanel`（React 应用）。M1 会新增 `content.ts`(ISOLATED) 与 `injector.content.ts`(MAIN world) 两个 content script + background 图片代理（见 §6）。

---

## 5. 当前进度（已完成，均已浏览器验证）

- **Phase A · 脚手架 + 四主题**：WXT 工程、字体本地打包、四主题变量系统（极简/控制台/纸感/玻璃 × 明暗）、i18n、App 外壳（Header/状态条/Tabs）。✅ 四主题 × 中英逐屏核对。
- **Phase B · 「待发布」Tab**：编辑器卡片（工具栏/编辑·预览/三步空态/拖放）、素材卡、能力映射面板、预检、导入报告、覆盖确认、Footer（进度条/取消/庆祝/音效）。✅ 端到端跑通写入主流程：载入示例 → 覆盖确认 → 分阶段进度 → 报告 → 记录入账。
- **Phase C · 「记录」+「设置」Tab**：记录列表（搜索/载入/复制/删除/清空/空态）、设置页（主题四宫格 + 九组折叠 + 开关/下拉/动作控件）。✅ 浅色+英文交叉核对。

`tsc --noEmit` 全绿；`pnpm build` 正常出包（约 1MB，含字体）。

---

## 6. ⚠️ Mock 边界（M1 要替换的东西）

这些是**当前用 mock/演示实现、M1 要接真实注入引擎**的地方。**接口已设计好，替换时尽量不动 UI 组件**：

| 位置 | 现状（mock） | M1 目标 |
|---|---|---|
| `lib/bridge/useConnection.ts` | 恒返回 `connected: true` | 真实探针：向 content script 查询 X 页面/Draft 实例/上传通道是否就绪 |
| `lib/workspace/importService.ts` | `setTimeout` 分阶段假进度 | 真实管线：sidepanel → content(ISOLATED) → MAIN world 注入引擎，按真实阶段回报进度 |
| `WorkspaceProvider.finishImport()` | 用 `capability()` 正则估算 ok/deg 计数 | 用注入引擎返回的真实逐块结果 |
| 设置「本地图片文件夹」动作 | 仅切 `opts.folder` 布尔 + toast | File System Access API 选目录 + IndexedDB 持久化 handle |
| 「打开 X Articles」按钮 | toast 演示 | `chrome.tabs.create('https://x.com/compose/articles')` |
| 素材「更换」封面、备份/导出、诊断快照、快捷键跳转 | toast 演示 | 各自真实实现 |

**注入引擎本身（M1 新建）**参考 `docs/research/xposter-analysis.md`（已验证的可靠范式）：MAIN world 经 React fiber（`__reactFiber$*`）拿 Draft `props.editorState + onChange`，「借」页面构造器构造 ContentState 直写；图片调 X 内部 `onFilesAdded`；特殊块用 marker 占位→替换成 atomic entity（`MARKDOWN`/`DIVIDER`/`TWEET`）。正文可用合成 `paste` 兜底。选择器：`[data-testid="composer"]` / `.public-DraftEditor-content`。

---

## 7. 在新电脑上如何接续

```bash
git clone https://github.com/jiangding01/x-md-importer.git
cd x-md-importer
pnpm install            # 会构建 esbuild（pnpm-workspace.yaml 已 allowBuilds）
pnpm build              # → .output/chrome-mv3
# Chrome → chrome://extensions → 开发者模式 → 加载已解压 → 选 .output/chrome-mv3
```

- **纯 UI 快速预览**（不装扩展）：静态服务器托管 `.output/chrome-mv3` 打开 `sidepanel.html`，窗口宽 ~404px。资源用绝对路径（`/chunks`、`/assets`），服务器根须设在 `chrome-mv3` 目录。chrome.storage 不可用时自动回退 localStorage；可在控制台注入 `localStorage['markflow:prefs']` 切主题预览。
- **开发**：`pnpm dev`（WXT，HMR）。
- **类型检查**：`pnpm compile`（注意：用项目本地 `./node_modules/.bin/tsc`，别用可能存在的旧全局 tsc）。

---

## 8. 已知陷阱

- **pnpm 11 构建脚本**：esbuild 需在 `pnpm-workspace.yaml` 的 `allowBuilds` 放行（已配 `esbuild: true`），否则 vite 构建失败。
- **本地 tsc 版本**：`npx tsc` 可能选到旧全局版本报 moduleResolution 错；用 `./node_modules/.bin/tsc`。
- **CJK 字体**：为控体积只打包了拉丁字体（Space Grotesk / JetBrains Mono），中文用系统栈（PingFang / 宋体）。如需精确 Noto CJK，再加 `@fontsource/noto-*` 的 subset。
- **浏览器预览点击坐标**：在 404px 预览里用自动化点 Tab 有时坐标漂移，用 JS `button.click()` 更稳（真实 Chrome 侧边栏正常）。
- **竞品扩展冲突**：用户浏览器可能装有 `x-article-publisher` 类扩展（会在 X 页面注入「导入 Markdown」按钮）；将来开发注入引擎时先禁用它，避免 marker/按钮干扰。
- **`.output` / `.wxt` / `node_modules` 不提交**（已在 `.gitignore`）。

---

## 9. 待办与路线图

**近期**
- [ ] **Phase D**：在真实 Chrome 侧边栏做最终 QA（四主题 × 中英逐屏），修边角。
- [ ] **M1 · 注入引擎（核心）**：新建 `content.ts`(ISOLATED) + `injector.content.ts`(MAIN world) + background 图片代理；实现 fiber 直写 + 合成 paste + onFilesAdded + marker 事务；把 §6 的 mock 逐个换成真实实现。M0 探针已验证关键假设，产物见 `docs/research/m0/`。
- [ ] 把 `useConnection` / `importService` 接到真实 content script 消息。

**中期**（见技术方案 §9 里程碑 M2–M4）
- [ ] M2 图片管线（本地 FS Access / 远程 background 代理 / 压缩 / 封面 / alt→caption）。
- [ ] M3 特殊块（代码块/表格/分割线/推文的原生 entity 主路线 + 降级链）。
- [ ] M4 体验打磨（拖放导入完善、批量队列、诊断面板、备份导出、简繁/智能标点等真实实现）。

**远期**
- [ ] 文章 → Markdown 反向导出。

---

## 10. 关键参考资产

- **设计稿（权威来源）**：Claude Design 项目 `MarkFlow v3.dc.html`（`https://claude.ai/design/p/1ea663aa-fb44-4e1d-a934-bd09bb195595`）。四套主题变量、九组设置、双语文案均已落进代码（`lib/theme/themes.ts`、`lib/settings/config.ts`、`lib/i18n/dict.ts`），无需再回看设计稿即可开发；仅在调整视觉时参考。
- **技术方案**：`docs/技术方案设计.md`（功能规格 §5、注入路线 §2–4、里程碑 §9、决议 §11）。
- **注入引擎范本**：`docs/research/xposter-analysis.md`（MIT 竞品 xPoster 源码深析，M1 直接借鉴）。
- **M0 探针**：`docs/research/m0/`（原生 entity 渲染实测）。
- **X 编辑器实机勘察**：`docs/research/screenshots/` + web-access 站点经验 `~/.claude/skills/web-access/references/site-patterns/x.com-articles.md`（此文件在个人机上，未随仓库）。

---

## 11. 最近一次会话小结

**2026-07-13 · 个人电脑**：从零搭建工程，完成 Phase A/B/C 全部侧边栏 UI（四主题、待发布、记录、设置），逐屏验证，`tsc` 全绿、`build` 通过。补齐 README / CHANGELOG / HANDOFF 三份文档并首次提交推送。注入引擎仍为 mock，下一步 Phase D + M1。
