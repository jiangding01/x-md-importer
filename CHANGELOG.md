# 变更记录

本文件记录本项目的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
- **M2 Phase 2**：图片上传（onFilesAdded 桥 + MEDIA entity diff + mediaId 轮询 + marker 归位）+ 封面设置 + 本地文件夹（FS Access）。

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

[Unreleased]: https://github.com/jiangding01/x-md-importer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jiangding01/x-md-importer/releases/tag/v0.1.0
