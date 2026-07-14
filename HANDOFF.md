# HANDOFF · 跨机器接力文档

> **这份文档的用途**：让在**另一台电脑**上的 AI Agent（或你本人）能无缝接续开发，无需重新摸索上下文。
>
> **维护约定（重要）**：
> - 每次「阶段性功能完成 → 提交代码」时，**必须同步更新本文档**，使其始终反映最新进度、未完成任务与后续规划。
> - 本文档随代码一起提交到 git 仓库。任何一台电脑上开发，都按此约定更新并提交。
> - 更新时重点维护：`## 5 当前进度`、`## 9 待办与路线图`、`## 11 最近一次会话小结`，并在顶部更新「最后更新」。
> - **工作流**：每批改动 **先 code review + 修复，再提交**；走 **feature 分支 → PR → 合并 main**，不直接推 main。

**最后更新**：2026-07-14 · 分支 `feat/open-x-inline-caption` · **「打开 X Articles」按钮接真实 `chrome.tabs.create` 跳转**；**`postMessage`→MessageChannel「私有通道」经实测验证在 MAIN world 架构下不可达成、已回退**(复盘见 §8 + §11)。下一步:alt→图注(caption,`sheetDialog` 已探清);行内代码 X 渲染待真机确认。

---

## 0. TL;DR（30 秒了解现状）

- **是什么**：Chrome MV3 扩展，把 Markdown 一键导入 X（Twitter）Articles 长文编辑器，全格式排版，不用官方 API。
- **现在到哪了**：
  - ✅ **侧边栏 UI 全部完成**（Phase A/B/C，四主题 + 中英）。
  - ✅ **M1 注入引擎全线打通**（PR #1）：三方通信 + fiber 探针（三灯）+ **Draft.js 直写**（标题/粗斜删/行内代码/链接/引用/列表/代码块/分割线/推文），真机验证 68 块文章写入成功。预检卡、写入按钮门控均接真实探针，**已无 mock**。
  - ✅ **M2 Phase 1 标题设置**（PR #2）：H1 / frontmatter title 抽取 → UI 打分写入 X 标题字段；frontmatter 不再泄入正文；并修掉 M1 code review 的探针/桥接层遗留。
  - ✅ **M2 Phase 2 图片上传 + 封面**（PR #4/#5，真机验证）：独占行 `![alt](src)` → 上传（远程走 background 代理 + dataURI 就地解析），marker 占位事务 + onFilesAdded + MEDIA 轮询 + 归位 + 失败降级；封面 `setCoverImage`（frontmatter cover / 正文首图）。
  - ✅ **M2 code review 16 条修复**（PR #6）：封面误点按钮、SSRF via DNS、上传失败误报成功、postMessage 收敛、AssetsCard 预览一致性等。
  - ✅ **原生表格 + marker 修复**（PR #7）：GFM 表格 → `MARKDOWN` atomic（与代码块同通道，X 原生渲染）；marker 清扫改通用前缀（清历史遗留残留）。
  - ✅ **本地图片 FS Access**（PR #9，真机验证）：`![](assets/x.png)` / Obsidian `![[y.png]]` → 从授权文件夹读取上传；handle 存 x.com IndexedDB、权限失效时 UI 校准不撒谎、size/MIME 上限对齐、授权浮层防卡屏/并发。
  - ✅ **本地图按需授权**（分支 `feat/session-vault-folder`，真机验证）：两级文件夹 `active`（素材板「本篇图片文件夹」）+ `persistent`（设置默认），读取优先级 active > persistent > 降级；素材板就地连接/更换/清除本篇专用文件夹；浏览器重启权限回落后「一键恢复」复用存量 handle（`requestPermission`，免重选文件夹）。
  - ✅ **探针自动重探**（分支 `feat/probe-auto-refresh`，真机验证）：监听标签页事件自动更新连接状态,免手动刷新;tab 定位改为跟随当前活动标签。
- **本次刚做**：「打开 X Articles」按钮接真实 `chrome.tabs.create` 跳转（待真机验证 URL）；**修复图片 `<>` 包裹路径解析**（含空格本地图曾全失败，真机 13/13，见 §11）。
- **还没做**：alt → 图注（`sheetDialog` 已探清）；备份/诊断/快捷键等演示项。（本地图**按需授权**已落地:素材板本篇文件夹 + 一键恢复;「导入时自动弹选文件夹」为可选进一步优化,暂不做。行内代码已确认 X 不支持、降级保留反引号。）
- **已排除（固有限制）**：`postMessage`→MessageChannel「私有通道」——MAIN world 下 File 对页面脚本不可隐藏，已验证不可达成并回退（见 §8）。
- **下一步**：alt→图注（caption，下一 PR）。
- **怎么跑**：`pnpm install && pnpm build` → Chrome 加载 `.output/chrome-mv3`。详见 §7。

---

## 1. 项目背景与目标

用 Markdown 在本地起草长文，一键导入到 **X Articles 编辑器**（`x.com/compose/articles`），保留标题/粗斜删/链接/列表/引用/**代码块/表格/图片/分割线/推文嵌入**等排版。**纯浏览器层**完成（不走 X 官方付费 API），**永不自动发布**（发布留给用户）。

- 产品功能规格与注入方案的**事实基座**：[`docs/技术方案设计.md`](./docs/技术方案设计.md)（含 §5 功能规格清单、§2–4 注入路线、§9 里程碑）。
- X Articles 编辑器 = **Draft.js**。M1 已实证：MAIN world 经 React fiber 拿 `props.editorState + onChange`，「借」页面 Immutable 构造器直写 blockMap 是**可靠主路径**（比合成 paste 更稳）；代码块=`MARKDOWN` entity、分割线=`DIVIDER`、推文=`TWEET`、图片=`MEDIA`（atomic）。

---

## 2. 技术栈与约定

- **WXT + React 18 + TypeScript（MV3）**，**pnpm**。
- **函数组件，禁用 class**（用户偏好）。ESM，命名导入优先。
- **主题 = CSS 变量**：四套主题是同一张变量表的不同取值，切主题 = 整套替换 `:root` 变量。组件用 `var(--x)` 内联样式；`:hover` 用 `global.css` 的 `.mf-*` 工具类。
- **UI 文案禁止竞品对比**（用户明确要求）：只中性陈述自身能力，不出现「竞品/超越/业界唯一」等字眼。
- **工作流**：每批改动先 code review（多角度查找 + 验证）并修复，再提交；feature 分支 → PR → 合并 main；提交前更新本文档 + CHANGELOG。git 校验用 `reflog`/`cat-file`/`ls-remote` 或直接看 GitHub（不要拿同一条命令输出自证）。

---

## 3. 仓库结构与关键文件

```
entrypoints/
  background.ts                 # service worker：点击图标开侧边栏
  content.ts                    # ⭐M1 ISOLATED world：injectScript 注入 injector + nonce 握手
                                #   + 通用请求桥（probe/import/set-title 三通道，单 Map + kind 校验）
  injector.ts                   # ⭐M1 MAIN world（defineUnlistedScript，经 injectScript 注入页面上下文）：
                                #   fiber 探针（三灯）+ Draft 直写引擎 runImport + 标题设置 setTitle
  sidepanel/
    main.tsx                    # 入口：加载 prefs/opts/draft/history → 挂 Provider（含 ProbeProvider）
    App.tsx / types.ts / styles/global.css
    components/
      Header StatusBar Tabs Toast
      draft/    DraftTab EditorCard DraftRow AssetsCard CapabilityPanel PreflightCard ReportCard OverwriteDialog Footer Celebration
      history/  HistoryTab
      settings/ SettingsTab
lib/
  bridge/protocol.ts            # ⭐三方通信单一事实来源：消息族（hello/probe/import/set-title）+
                                #   ImportBlock/ProbeResult/ImportResult/SetTitleResult + runtime 通道类型 + 守卫
  bridge/useProbe.ts            # ⭐ProbeProvider（面板级共享一次探测，五态机）+ useProbe()
  bridge/useConnection.ts       # 由探针派生 connected/route/hasContent（M1 起为真实，非 mock）
  bridge/importArticle.ts       # sidepanel→content 写入/标题发送入口（importToXTab / setTitleOnXTab）
  bridge/locateXTab.ts          # ⭐统一「定位目标 X 标签页」（useProbe 与 importArticle 共用）
  markdown/parser.ts            # ⭐Markdown → ImportBlock[]（递归下降行内解析，跳过 frontmatter）
  markdown/frontmatter.ts       # ⭐extractTitle（frontmatter title > 首个 H1，跳代码块）+ stripFirstH1
  markdown/capability.ts        # 能力映射分析 + firstTitle
  markdown/Preview.tsx / sample.ts
  workspace/WorkspaceProvider.tsx  # ⭐草稿/记录/tab + 真实导入流程（parseMarkdown → importToXTab → 标题 → 报告）
  theme/ i18n/ prefs/ settings/ storage/   # UI 基础设施（Phase A/B/C，稳定）
docs/
  技术方案设计.md               # 事实基座
  research/xposter-analysis.md  # 竞品 xPoster 源码深析（注入引擎实现范本，M2 图片上传直接参考 §3）
  research/m0/ research/screenshots/
  qa/                           # Phase D 设计稿↔实现对照测试
```

> 注：`lib/workspace/importService.ts`（旧 mock 假进度）已在 M1 删除。

## 4. 架构：状态与执行环境

**四个执行环境 + 两条通信通道**（M1 已全部落地）：

```
sidepanel（React）──chrome.runtime.sendMessage──▶ content.ts（ISOLATED world）
  │  importArticle / useProbe                        │  nonce 握手 + 通用请求桥（按 id+kind 匹配）
  │                                                  │  window.postMessage（source 区分 + event.source 守卫）
  ▼                                                  ▼
background（开侧栏）                          injector.ts（MAIN world，与 X 的 Draft.js 同上下文）
                                                     fiber 定位 editorState/onChange/onFilesAdded；直写 blockMap
```

**状态 Provider**（`main.tsx` 嵌套，首帧前从 storage 加载初值）：PrefsProvider（主题/语言）→ SettingsProvider（导入选项）→ **ProbeProvider**（面板级共享探针）→ WorkspaceProvider（草稿/记录/导入流程）。`useConnection` 由 ProbeProvider 派生真实连接状态。

---

## 5. 当前进度（已完成，均已真机验证）

- ✅ **Phase A/B/C · 侧边栏 UI**：四主题、待发布/记录/设置三 Tab、能力映射、预检、报告、覆盖确认等。
- ✅ **Phase D · 设计稿↔实现对照**：`docs/qa/`（13 组视图，还原度高）。
- ✅ **M1 · 注入引擎**（PR #1，`c8056cb`）：
  - 三方通信 + nonce 握手 + injectScript 注入；fiber 三灯探针（编辑器/Draft 实例/onFilesAdded）。
  - **Draft 直写**：借页面 Immutable 构造器逐块构造 blockMap → `EditorState.push` + `onChange`；replace/append 双模式；标题/粗/斜/删/行内代码/链接/引用/有序无序列表/代码块（MARKDOWN entity）/分割线（DIVIDER）/推文（TWEET）全部落地。
  - 预检卡、写入按钮门控、状态条三灯全部接真实探针，**无 mock**。
- ✅ **M2 Phase 1 · 标题设置 + 修复**（PR #2，`3d3f79d`）：
  - 标题：`extractTitle`（frontmatter title > 首个 H1，跳代码块）→ injector `setTitle` UI 打分写入标题字段（**仅 UI 通道**，GraphQL 留 TODO）；H1 去重在 md 文本层（`stripFirstH1`）。
  - parser 跳过文首 frontmatter（不再把 `title:`/`cover:` 当正文分割线写入）。
  - 修掉 M1 review 遗留：connected 去 articleId 要求（新建页可写）、editorHasContent 接真实探针、ImportResult 回传 effectiveMode、tab 定位统一（locateXTab）、content 抽通用请求桥。
- ✅ **M2 Phase 2 · 图片上传 + 封面**（PR #4/#5，真机验证）：远程图（background 代理 + SSRF 防护 + magic-byte + 16MB 上限）/ dataURI 上传；marker 占位事务 + onFilesAdded + MEDIA 轮询 + 归位 + 失败降级；封面 `setCoverImage`（frontmatter cover / 正文首图）。含 5 角度 review 的 16 条修复（PR #6）。
- ✅ **原生表格 + marker 修复**（PR #7，真机验证）：GFM 表格 → `MARKDOWN` atomic（实证 X 表格走此 entity，原生渲染）；图片 marker 残留清理改通用前缀。

`tsc --noEmit` 全绿；`pnpm build` 正常出包。

---

## 6. 仍未接真实实现的点（演示/未做）

| 位置 | 现状 | 目标里程碑 |
|---|---|---|
| **alt → 图注（caption）** | 未做；caption 是弹窗（`data-testid="sheetDialog"` + contenteditable + Save），需逐图 UI 自动化、跳过空/垃圾 alt | 下一个 |
| ~~本地图 File 字节经 `postMessage` 到 MAIN world~~ | 本地图/远程/封面 File 在 MAIN world 对页面脚本可读(与远程/dataURI 同面) | **固有限制,不可修**(见 §8;MessageChannel 已验证无效并回退) |
| ~~行内代码 X 渲染~~ | ✅ 真机确认 X 正文**不支持**行内代码 → 降级保留反引号 `code`（`capability` 文案订正） | 本次(第九次会话) |
| ~~「打开 X Articles」按钮~~ | ✅ 已接 `chrome.tabs.create`（待真机验证 URL 落点） | 本次(第九次会话) |
| 标题冲突 `titleConflict='ask'` | 暂按保守 `keep` 处理 | 补独立询问弹窗 |
| 备份/导出、诊断快照、快捷键跳转 | toast 演示 | M4 |

> 图片上传（远程/dataURI）、封面、原生表格均已完成并真机验证合并（PR #4/#5/#7）。

**M2 图片上传范本**见 `docs/research/xposter-analysis.md` §3：MAIN world 从 fiber 找 X 的 `onFilesAdded` 回调，把 `File` 交给它走 X 原生上传管线；轮询 blockMap 新增的 MEDIA entity 拿 mediaId；用 **marker 占位 → 上传 → 原位归位** 事务（M1 纯文本/atomic 单趟构造时特意没引入 marker，图片异步上传必须补上）。封面走 GraphQL `ArticleEntityUpdateCoverMedia`（queryId 硬编码脆弱，想好降级）。

---

## 7. 在新电脑上如何接续

```bash
git clone https://github.com/jiangding01/x-md-importer.git
cd x-md-importer
pnpm install            # 会构建 esbuild（pnpm-workspace.yaml 已 allowBuilds）
pnpm build              # → .output/chrome-mv3
# Chrome → chrome://extensions → 开发者模式 → 加载已解压 → 选 .output/chrome-mv3
```

- **真机验证注入功能**：必须在真实 Chrome + 登录 X + 打开文章编辑页（`x.com/compose/articles/edit/...`）。改了 content/injector 后 **务必刷新 X 页面**（扩展更新不会自动换掉已注入的旧 content script）。
- **纯 UI 预览**（不装扩展、测不了注入）：静态服务器托管 `.output/chrome-mv3` 打开 `sidepanel.html`，窗口宽 ~404px；chrome.storage 不可用时自动回退 localStorage。
- **开发**：`pnpm dev`（HMR）。**类型检查**：`pnpm compile`（用项目本地 `./node_modules/.bin/tsc`）。

---

## 8. 已知陷阱（含 M1/M2 踩坑）

- **Draft 直写（injector.ts）**——三条实战踩出来的硬约束，改动务必保留：
  1. 借页面 Immutable 构造集合**必须用实例方法** `clear()`+`push()`/`set()` 逐个填充，**不能** `constructor(数组)` 直造（对 Draft 内部子类会产出畸形集合，遍历时 `undefined.getText()` 崩）。
  2. 提交前必须借 `SelectionState` 构造**指向新块**的 selection + `forceSelection`——沿用旧 selection（旧块 key）会让 X 的 `onChange` 内部按 key 找块崩。
  3. `ContentBlock.merge` 要显式清空 `data`，防继承样本块的非空 data。
- **图片上传（M2 Phase 2a · injector `uploadOneImage` / marker 事务）**——改动务必保留：
  1. 图片异步上传：必须「marker 占位块 → 提交正文 → 逐图 `onFilesAdded` → 轮询新增 MEDIA entity + 挖 mediaId → 归位到 marker + 清 marker」，不能像文本那样单趟构造。
  2. **通道超时必须随图片数放大**（content `45s + 图数×40s`）+ injector 并发导入护栏（`importInFlight`）——否则慢图误判超时、用户重试→两个 `runImport` 并发写坏同一 Draft（review 揪出的最严重 bug）。
  3. `sweepMarkers` 删 marker 块时**不能把 blockMap 删空**（空 map + selection 指向已删块会崩）——删空时保留一个块并清空其文本。
  4. background 是持任意 host 权限的取数代理，SSRF 防护（IPv4-mapped IPv6 `::ffff:`、跟随重定向后复检 `resp.url` 落点、流式体积上限、magic-byte 真实类型）不可删。
  5. 远程图 host 权限用运行时 `permissions.request`，**必须是写入手势链上第一个 await**——不能先 `await permissions.contains`（会消耗用户手势导致 request 被拒）。
  6. 已知未做（真机验证后按 xposter §3.3 精修）：多图 relocate 的空分裂块清理、marker 被 X 插入破坏时的 fallback 顺序配对。
- **标题打分（setTitle）**：关键词（title/标题）是**硬门槛**，否则会误命中正文大 contenteditable，overwrite 时清空正文。别放宽。
- **frontmatter**：parser 跳过与 `extractTitle` 抽取的边界判定必须一致（都用**顶格 `^---`**）；H1 抽取/移除都要**跳过代码块**。
- **content script 更新不自动生效**：改 content/injector 后必须刷新 X 页面；症状①「三灯绿但写入报未连接」= 页面跑旧 content；症状②「正文写入了却报 `images undefined` 崩溃 / 图片不上传」= 新 injector + 旧 content（旧 content 注入新 injector 但自己不带 images 字段）。injector 已对 images 默认 `[]` 防御（崩溃→降级），但**真正上传图片必须刷新页面**加载新 content。
- **MAIN world 下 File 对页面脚本「不可隐藏」——固有限制，勿再尝试「私有通道」**：injector 在 MAIN world，与 x.com 页面 JS 共享同一个 window 与 JS 堆。图片上传靠**借页面的 `onFilesAdded` 回调**（只存在于 MAIN world），File 必须序列化进 MAIN world 才能喂给它——一旦进入，同 world 的页面脚本就能 hook `onFilesAdded` / `FileReader` 读到，**换任何传输通道都藏不住**。曾试图用 MessageChannel 把 content↔injector 通信私有化（分支 `feat/messagechannel-private`），**已验证不可达成并回退**：`window.postMessage(hello, origin, [port2])` 派发的是**单个**事件，MAIN world 里所有监听器（injector + 页面脚本）拿到的是**同一个** `e.ports[0]`；页面脚本 `addEventListener('message', e => e.ports[0].onmessage = leak)` 即可在握手期抓到 port、读走后续所有 File（已实测确认）。MessageChannel 仅能挡「被动 `window.onmessage` 监听」，挡不住任何主动页面脚本，收益不足以支撑「私有」表述。**结论**：这是「借 `onFilesAdded` 上传」架构的固有代价，除非改上传路径（如 GraphQL 上传 API——技术方案明确避开的脆弱/付费路径）。**教训**：动隔离/安全边界前，先写清威胁模型（对手是谁、能力边界）+ 查证 API 确切语义（文档/实测），确认目标**理论可达**再动手，别凭「感觉更私密」下手。
- **pnpm 11 构建脚本**：esbuild 需在 `pnpm-workspace.yaml` `allowBuilds` 放行。
- **CJK 字体**：只打包拉丁字体，中文用系统栈。
- **`.output`/`.wxt`/`node_modules` 不提交**（已 gitignore）。

---

## 9. 待办与路线图

**已完成**：✅ Phase A/B/C UI · ✅ Phase D 对照 · ✅ M1 注入引擎（PR #1）· ✅ M2 Phase 1 标题（PR #2）· 🚧 M2 Phase 2a 图片上传（远程 + dataURI，分支 `feat/m2-media-cover`，待真机验证合并）

**当前正在进行：M2 Phase 2a 真机验证**
- [ ] 真机测远程图 / dataURI 上传（登录 X + 文章编辑页 + **刷新页面**后测）；按实际 X 插入行为精修：多图 relocate 空分裂块清理、marker 被破坏的 fallback 顺序配对。

**下一步：M2 Phase 2b · 本地文件夹 + 封面**
- [ ] 本地图片：File System Access 文件夹授权 UI + IndexedDB 存 handle，`prepareOneImage` 的 local 分支接真实读取。
- [ ] 封面：frontmatter cover / 正文首图 → 上传得 mediaId → 走 X 封面 fileInput（非 GraphQL，技术方案 §11 定 GraphQL 默认关）。
- [x] 顺手：「打开 X Articles」按钮 `tabs.create`（第九次会话已做，待真机验证 URL）。
- [ ] 顺手：标题 `ask` 独立询问弹窗。

**M2 小遗留**（可在 Phase 2 顺带）：标题 `ask` 独立询问弹窗；tab 彻底锁定（Check→写入同一 tab，参考 xposter target-lock）。

**中期**（技术方案 §9 M3–M4）
- [ ] M3 特殊块降级链完善（表格原生 entity / 兜底转图）。
- [ ] M4 体验打磨（批量队列、诊断面板、备份导出、简繁/智能标点、快捷键等真实实现）。

**远期**：文章 → Markdown 反向导出（xposter 有范本，§8.1 导出器）。

---

## 10. 关键参考资产

- **技术方案**：`docs/技术方案设计.md`（功能规格 §5、注入路线 §2–4、里程碑 §9）。
- **注入引擎范本**：`docs/research/xposter-analysis.md`（MIT 竞品 xPoster 源码深析）——M1 直写照它 §1，**M2 图片上传照 §3、封面照 §3.4–3.5**。
- **M0 探针**：`docs/research/m0/`。
- **对照测试**：`docs/qa/comparison.html`。
- **设计稿**：四主题变量、九组设置、双语文案已全部落进代码，无需回看即可开发。

---

## 11. 最近一次会话小结

**2026-07-13 · 首次会话**：从零搭建工程，完成 Phase A/B/C 侧边栏 UI，`tsc`/`build` 通过，补齐 README/CHANGELOG/HANDOFF。

**2026-07-13 · 第二次会话**：Phase D 设计稿↔实现像素级对照，产出 `docs/qa/`；未改产品代码。

**2026-07-13 · 第三次会话（本次，M1 + M2 Phase 1）**：
- **M1 注入引擎全线打通**并合并（PR #1）：握手地基 → fiber 三灯探针 → 探针闭环（状态条/预检卡真实化）→ Draft 直写引擎。真机验证 68 块文章写入成功（标题/粗斜删码/链接/引用/列表/代码块/分割线/推文）。踩坑三修见 §8（Immutable 构造、selection、data）。
- **M2 Phase 1 标题设置**并合并（PR #2）：标题抽取 + UI 打分写入、frontmatter 跳过；并修 M1 review 遗留（connected/tab/桥抽象等）。
- **两轮 code review**（多角度并行 + 验证）各修 8~10 条，其中标题打分误命中（可清空正文）、二次写入静默覆盖、frontmatter 双实现不一致等是真机测不出的边界风险——确立「先 review 再提交」流程。
- **环境教训**：本机曾有 rtk（token 压缩 hook）伪造 git 命令输出，导致一度误以为提交成功；已删除。git 校验改用 reflog/cat-file/ls-remote 或直接看 GitHub 为准。

**2026-07-13 · 第四次会话（本次，M2 Phase 2a 图片上传）· 分支 `feat/m2-media-cover`**：
- 实现远程 + dataURI 图片上传：parser 产出 ImageBlock；injector marker 占位事务（onFilesAdded + MEDIA 轮询 + 归位 + 清 marker + 失败降级）；background 远程代理（SSRF/流式/magic-byte）；`optional_host_permissions` 运行时申请；协议扩展 imageOk/imageFail。改 8 文件、约 600+ 行。
- **两轮并行 code review**（注入正确性 + 数据流/安全）共揪出并修 7 条阻断/安全问题：**通道超时不随图片数放大**（慢图误判超时→重试并发写坏文章，最严重）、`sweepMarkers` 删空崩、**权限 `contains` 预检打断手势链**（远程图权限首次永远申请不到）、SSRF IPv4-mapped/重定向绕过、体积上限读完才判致内存耗尽、dataURI 参数误伤等。修后 tsc/build 绿。
- **本机无法真机验证注入**（无登录 X 环境）→ 走 PR 交由有登录态的机器真机测。MEDIUM 级差异（多图空块/fallback 配对）作为已知项记入本文档 §8/§9，真机验证后精修。

**2026-07-14 · 第五次会话（本次）· Phase 2a 真机验证合并 + Phase 2b 封面**：
- **Phase 2a 真机验证通过并合并（PR #4）**：9 图干净落位——审查担心的多图空分裂块/错位在真实 X 上未发生，relocate 工作良好。真机迭代修了两个真机才暴露的 bug：injector 对缺失 images 默认 `[]`（旧 content 未刷新页面时不崩）、parser 支持**带链接图片** `[![](img)](link)`（推文转 md 常见,原只认裸图）。
- **Phase 2b 封面**（分支 `feat/m2-cover`）：frontmatter cover / 正文首图 → injector `setCoverImage` 塞 X 封面 fileInput。一轮 review 修了确定性 bug（首图封面源改用 blocks 首个 ImageBlock，与移除同源）+ 收紧 fileInput 选择（去通用兜底防误伤正文媒体）。tsc/build 绿,**待真机验证**。
- **caption 弹窗已探清**（`sheetDialog` + contenteditable + Save），下一个做 alt→图注 UI 自动化(跳过垃圾/空 alt)。

**2026-07-14 · 第六次会话（本次）· M2 收尾 + 原生表格**：
- **真机验证并合并封面**（PR #5）：收窄后的 Apply 文案仍命中 X 裁剪弹窗，封面正常落地。
- **对已合并的 M2 Phase 2 做 5 角度并行 code review** → 16 条修复合并（PR #6）：封面误点不可逆按钮、SSRF via DNS（词法黑名单挡不住公网 DNS→内网）、上传失败误报成功、`postMessage('*')` 广播本地图字节、并发下载 OOM、AssetsCard 预览虚报等。**教训**：并行修复 agent 在共享工作区做 `git stash` 造成文件竞争——主控用 node 直读逐文件核实 15/15 修复标记在位才提交（不信 agent 自述）。
- **原生表格 + marker 修复**（PR #7）：console 勘察实证 **X 表格 = `MARKDOWN` entity**（data.markdown 存 GFM 原文，与代码块同一通道）→ parser 一处识别即可，injector/协议**零改动**；顺带修图片 marker 历史残留（sweep 改用通用前缀 `__MARKFLOW_IMG_`，清掉反复导入的旧 prefix 残留）。均真机验证通过。
- **文档同步 + 文案订正**（本 PR）：HANDOFF/CHANGELOG 更新到 M2 全完成 + 表格；`capability.ts` 表格文案由「按文本写入」订正为「原生表格·MARKDOWN entity」。

**2026-07-14 · 第七次会话（本次）· 本地图片 FS Access**：
- **实现本地图片上传**（`feat/m2-local-images`）：parser 补 Obsidian `![[x]]` 识别;新建 `lib/bridge/localVault.ts`(IndexedDB 存 handle + `parseLocalImagePath` 路径安全器 + vault 首段剥离);content 授权流程(X 页临时浮层产生手势 → `showDirectoryPicker` → 存 x.com IndexedDB)+ `prepareOneImage` local 分支读取;协议 `connect-folder`/`clear-folder`;设置 UI「连接/清除」+ AssetsCard 状态。
- **走完整流程**（本地 review → 真机 → 文档 → PR):2 角度 review + 我自审 + Codex 共修 5 条——folder 状态校准(权限失效不撒谎)、本地图 size/MIME 上限、授权浮层清理/超时/防并发、错误码 i18n。真机 1-7 全过(连接/上传/双手势/vault 剥离/权限校准/降级)。**A2 隐私(postMessage 广播本地图字节)记 TODO,单独 PR 做 MessageChannel**。
- 决策:**每篇独立文件夹**的场景要每次选文件夹(浏览器拿不到 md 绝对路径,无法自动),已和用户对齐——后续做「导入时按需授权(同文件夹不重复问)」优化。
- 草稿丢失是误报(用户自己清空的,chrome.storage 持久正常)。

**2026-07-14 · 第八次会话（本次）· 探针自动重探**：
- **自动重探**（`feat/probe-auto-refresh`）：ProbeProvider 监听 `tabs.onActivated`（切标签）+ `onUpdated`（当前活动 X 标签内 SPA 导航），400ms 防抖后 refresh，免手动点刷新。
- **tab 定位语义改变**：`resolveTargetXTab` 从「找任意打开的 X 标签(优先 active)」改为「**只认当前活动标签**，它是 X 才连、否则未连接」——用户选择「侧边栏跟随当前标签」(切到非 X 立即未连接、写入禁用)。探针 + 写入 + 标题 + 封面 + 文件夹全部共用此定位，一致。真机 1-5 全过（切标签自动更新 + 写入等回归无损）。

**2026-07-14 · 第九次会话（本次）· 「打开 X」按钮 + postMessage 私有化复盘（回退）· 分支 `feat/open-x-inline-caption`**：
- **验证并回退 PR-A（MessageChannel 私有化）**：目标是让图片/封面 File 不被 x.com 页面脚本读取。已实现 content↔injector 全通信改走 MessageChannel port（tsc/build 绿），两轮并行 code review 结论分歧（可合并 vs 不可合并），但对**事实**一致、且第二方**实测确认**：`window.postMessage(hello, origin, [port2])` 的 port 对同 window 所有监听器（含页面脚本）可见，页面能在握手期抓 port 读走后续 File；更根本的是**借 `onFilesAdded` 上传 → File 必进 MAIN world → 与页面同堆无法隐藏**。判定隐私目标在此架构**不可达成 → 回退**，写入 §8 已知陷阱。**设计疏漏复盘**：① 误解 transfer port 经 window 广播对所有监听器可见的语义；② 未先定威胁模型，把「架构固有、不可解」当「可修 bug」，还在方案/注释里用了「读不到」的绝对表述。教训：动隔离/安全边界前先定威胁模型 + 查证 API 语义、确认理论可达再动手。
- **C · 「打开 X Articles」按钮**：`DraftTab` 未连接提示里的按钮从演示 toast 改为 `chrome.tabs.create`（预览环境降级 `window.open`）。
- **修复 · 图片 `<>` 包裹路径解析（真机暴露）**：用户真机测本地图**全失败**（`imageOk:0 / imageFail:13`）。根因：路径含空格时用 CommonMark 标准的尖括号包裹 `![](<images/a b.png>)`，parser 未剥尖括号 → `source` 带字面 `<>` → 本地读取找不到文件。修复 `parser.ts`：`matchImageLine` 感知 `<>`（内部 `)` 不误判闭合）+ `normalizeImageSrc` 剥括号**保留路径空格**（图片不能像行内链接那样截到第一个空白）；裸图 / 带链接图皆适用。8 用例 node 实跑全过。**又一次「用户写法合法、parser 有缺口」**（同 `[![](x)](y)`）——parser 对 CommonMark 边界仍需按真实文档补齐。
- **修复 · 封面裁剪弹窗点 Apply 后未关闭（真机暴露）**：真机 `coverSet:true` 但「Edit media」弹窗残留。根因：`setCoverImage` 裸 `.click()` 点 Apply，对 X React 裁剪按钮偶发不触发回调（点了却没关、还谎报成功）。修 `injector.ts`：新增 `realClick`（派发 pointer/mouse down→up→click 完整序列）+ `findApplyButton` 优先用稳定 `data-testid="applyButton"` 定位 + **轮询确认弹窗真关闭才返回 true**（没关重点，最多 5 轮），`coverSet` 不谎报。用户提供了 Apply 按钮 DOM（`data-testid="applyButton"` + 内嵌 `<span>Apply</span>`）。
- **修复 · 清空 / 换稿后过期状态卡片残留（用户反馈）**：清空 md 后旧「预检结果」「导入报告」卡片仍在。改为在 `setMd`（所有内容替换的唯一入口）统一收起 `checkVisible`/`checkStep`/`reportVisible`——清空 / 载入示例 / 读文件 / 载入历史 / 编辑输入全覆盖。确认 `startImport` 不经 `setMd`，不会误清刚出的报告。
- **修复 · 代码块语言标签 `plain&#x20;text`（真机暴露）**：源 md 代码围栏 info 带 HTML 实体（`&#x20;`，用户的 md 来自 HTML 导出）→ X 渲染出 `plain&#x20;text` 难看标签。parser 归一 info（`normalizeCodeInfo`：解码数字实体 + 取第一词作语言），`plain&#x20;text` → `plain`。6 用例实跑。
- **修复 · 行内代码降级（已确认 X 不支持）**：用户查 X 快捷键/工具栏确认 X Articles 正文**无行内代码功能**（仅 Bold/Italic/Underline/Strikethrough/链接/列表/引用 + 块级 Code）。parser 产出的 `CODE` inline style 正确但 X 不渲染（表格内生效的是 X 自渲染 markdown）。经用户选定，降级为**原样保留反引号纯文本** `` `code` ``（读者可辨识，不虚报样式）；`capability.ts` 文案订正、`protocol.ts` `CODE` 枚举保留兼容。3 断言实跑（不产 CODE / 反引号保留 / 粗斜不受影响）。**附带发现**：X 支持 Underline（⌘U，markdown 无标准语法故未用）、Insert 菜单有 LaTeX 块（未来 `$$` 数学块可接）。
- **待你真机确认**：① 本地图 `<>` 路径（**已确认 197 成功**）；② 封面弹窗自动关闭（**已确认好了**）；③ 打开 X 按钮 URL 落点；④ 代码块语言标签是否变干净（`plain`）；⑤ 行内代码是否变成保留反引号的纯文本。

> 下一步接续：**alt→图注**(`sheetDialog` 已探清，逐图 UI 自动化，下一 PR)/ **本地图按需授权**(导入时自动弹选文件夹、同文件夹不重复问——体验优化)。`docs/research/xposter-analysis.md` §3.5 标题/封面 GraphQL、§7 FS Access 实证。~~postMessage 隐私 A2(MessageChannel)~~ 已验证不可达成并放弃(见 §8)。
