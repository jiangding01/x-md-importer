# MarkFlow · X 文章 Markdown 导入器

> 把 Markdown 一键导入 **X（Twitter）Articles 长文编辑器**，全格式自动排版——标题、粗体/斜体/删除线、链接、列表、引用、**代码块、表格、图片、分割线、推文嵌入**。不使用官方付费 API，纯浏览器层完成。本地优先，无遥测。

Chrome 扩展（Manifest V3）· WXT + React 18 + TypeScript · 侧边栏工作台。

---

## 功能

- **Markdown → X 文章**：解析后写入 X 的 Draft.js 编辑器，尽可能保留原生排版。
- **四套界面主题**：极简 / 控制台 / 纸感 / 玻璃，每套再分明暗，一键切换。
- **能力映射预览** ⭐：写入前逐项告知每个 Markdown 元素会变成什么（原生 / 特殊块 / 图片 / 降级），不会「导入完才发现表格丢了」。
- **原生代码块 & 特殊块**：代码块走 X 的 `MARKDOWN` atomic entity（带语言）、分割线走 `DIVIDER`、推文走 `TWEET`，而非一律转图片。表格原生渲染在后续里程碑。
- **预检探针**：写入前检查目标页面 / 编辑器实例 / 上传通道是否就绪。
- **导入报告 + 记录**：逐项成功/降级/失败清单；历史记录可搜索、载入、复制、重导。
- **丰富设置**：导入行为、标题与封面、内容转换、图片与媒体、成功反馈、快捷键、高级项等九组（渐进披露，开箱即用）。
- **中英双语** · **永不自动发布**（发布按钮永远留给用户）。

> ⚠️ 当前状态：**侧边栏 UI + M1 注入引擎 + M2 标题设置已完成**——Markdown 正文可**真实写入** X 编辑器（标题/粗斜删/行内代码/链接/引用/列表/代码块/分割线/推文），标题自动填入。**图片上传与封面**在 M2 Phase 2 进行中。详见 [HANDOFF.md](./HANDOFF.md)。

## 快速开始

前置：Node ≥ 20、pnpm ≥ 9、Google Chrome。

```bash
pnpm install          # 首次安装会构建 esbuild（已在 pnpm-workspace.yaml 放行）
pnpm dev              # WXT 开发模式（HMR）
pnpm build            # 生产构建 → .output/chrome-mv3
pnpm compile          # 仅类型检查（tsc --noEmit）
```

加载扩展：Chrome → `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3`，点击工具栏图标即打开侧边栏。

**纯 UI 预览**（无需装扩展）：`pnpm build` 后用任意静态服务器托管 `.output/chrome-mv3`，浏览器打开 `sidepanel.html`（chrome.storage 不可用时自动回退 localStorage），窗口宽度调到约 404px 模拟侧边栏。

## 技术栈

| 方面 | 选择 |
|---|---|
| 扩展框架 | [WXT](https://wxt.dev)（MV3，多 world content script、Shadow DOM、HMR） |
| UI | React 18 + TypeScript（函数组件，无 class） |
| Markdown | react-markdown + remark-gfm |
| 主题 | CSS 变量驱动（四套主题 = 同一变量表的多组取值） |
| 字体 | @fontsource 本地打包（Space Grotesk / JetBrains Mono；CJK 用系统字体栈） |
| 持久化 | chrome.storage.local（非扩展环境回退 localStorage） |
| 包管理 | pnpm |

## 目录结构

```
x-md-importer/
├── entrypoints/
│   ├── background.ts              # MV3 service worker（打开侧边栏）
│   ├── content.ts                 # ISOLATED world：注入 injector + 握手 + 请求桥
│   ├── injector.ts                # MAIN world：fiber 探针 + Draft 直写 + 标题设置
│   └── sidepanel/                 # 侧边栏 React 应用
│       ├── main.tsx               # 入口：加载偏好/设置/草稿/记录 → 挂载 Provider
│       ├── App.tsx                # 外壳 + tab 路由
│       ├── styles/global.css      # reset / 关键帧 / 基础 token / hover 工具类
│       └── components/            # Header / StatusBar / Tabs / Toast / draft/ history/ settings/
├── lib/
│   ├── theme/                     # 四主题变量表（themes.ts）+ useTheme
│   ├── i18n/                      # 中英字典 + useI18n
│   ├── prefs/                     # PrefsProvider（主题/语言）
│   ├── settings/                  # Options 模型 + SettingsProvider + 九组配置
│   ├── workspace/                 # WorkspaceProvider（草稿/记录 + 真实导入流程）
│   ├── markdown/                  # 解析器 parser + 标题抽取 frontmatter + 预览 + 能力映射
│   ├── storage/                   # chrome.storage 持久化切片
│   └── bridge/                    # 三方通信协议 + 探针 + 写入/标题发送 + tab 定位
└── docs/                          # 技术方案设计、调研报告、M0 探针产物
```

## 文档

- [HANDOFF.md](./HANDOFF.md) — **跨机器接力文档**（上下文、进度、待办、规划），每次提交前更新。
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录。
- [docs/技术方案设计.md](./docs/技术方案设计.md) — 产品功能规格与注入引擎方案（事实基座）。
- [docs/research/](./docs/research/) — 调研报告（xPoster 源码分析等）与 M0 探针产物。

## 许可

私有项目，暂未开源。
