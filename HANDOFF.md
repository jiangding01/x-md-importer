# HANDOFF · 跨机器接力文档

> **这份文档的用途**：让在**另一台电脑**上的 AI Agent（或你本人）能无缝接续开发，无需重新摸索上下文。
>
> **维护约定（重要）**：
> - 每次「阶段性功能完成 → 提交代码」时，**必须同步更新本文档**，使其始终反映最新进度、未完成任务与后续规划。
> - 本文档随代码一起提交到 git 仓库。任何一台电脑上开发，都按此约定更新并提交。
> - 更新时重点维护：`## 5 当前进度`、`## 9 待办与路线图`、`## 11 最近一次会话小结`，并在顶部更新「最后更新」。
> - **工作流**：每批改动 **先 code review + 修复，再提交**；走 **feature 分支 → PR → 合并 main**，不直接推 main。

**最后更新**：2026-07-25 · 分支 `feat/math-latex-block`（基于 v0.3.0）· **数学块 `$$` → X 原生 LaTeX**——真机 dump 确认 X 有原生 `LATEX` atomic 块（`entityType:'LATEX'`、`data:{}`、公式本体在块 `text`、逐字符挂同一 entity key，与前三种 atomic「数据在 entity、文本恒单空格」相反）。parser 新增块级 `$$…$$` 识别（单行 `$$ x $$` / 多行 / 未闭合回退 / `$$100` 假阳性防线 / 围栏内不误判），injector atomic 分支支持 LATEX 真实文本 + 逐字符挂 entity，能力面板「数学公式」从 warn「未接」改 native「原生 LaTeX 块」+ 新增「未闭合公式」warn 条目。行内 `$…$` 本批不做（X 无行内原生承载）。单测 293→307，tsc/build 全绿。**待真机验证**：导入带 `$$` 公式的 md，确认 X 渲染出 LaTeX。〔历史 v0.3.0〕**列表语义补齐 + 能力面板诚实化 + Toast 溢出修复**——嵌套列表接 Draft 原生 `depth`（栈式换算，此前缩进项掉进段落、正文留字面量 `  - 二级`）；任务列表 `- [ ]` 接通被置灰的 `taskList` 设置（☐/☑ 符号，加前缀时整体平移 offset）；能力面板补 7 类此前静默/撒谎的语法告知（任务列表原被标绿「原生列表」）+ 修 `capability()` 不透传解析开关的既存隐患；Toast 长文案不再溢出侧边栏；**setext 标题**（`标题\n===`）从「完全不识别」到解析 + 标题抽取全通。单测 225→293，tsc/build 全绿。**整批已真机验证通过**（setext 标题 / 任务列表 ☐☑ / 全角空格列表项 / emoji 后加粗 offset / 图片上传 / 封面 / 推文嵌入 / 表格 / 代码块逐项确认）。**真机同时确认：X 忽略 Draft `depth`、嵌套列表渲染为扁平**（有序列表还会连续重编号）——能力面板已如实标 warn「已扁平化(内容不丢)」;depth 仍照写(语义正确、零成本,X 日后支持即生效)。即便扁平也远好于改动前:那时缩进项根本不是列表项,而是带字面量 `- x` 的段落。〔历史〕**批次三:导入报告失败明细(v0.2.2)**——失败图给出序号/来源/阶段/原因(生产端强类型码表 `IMAGE_FAIL_REASONS`,封面 index=-1 哨兵,coverKeep=remove 序号 +1 还原);8 角度 code review 修 8 条;真机暴露并修复 **sweepMarkers「假干净」**(一次陈旧的干净读取即终止清扫 → 连续两轮 clean 才收工,残留审计以 `marker-residue` 上报不再静默)。T6 ×6 零残留、偶发超时被如实报「图 2 · 上传超时」。〔历史〕上一轮 · **全量真机回归(14 用例,QA 文档 `docs/qa/真机回归测试-v0.2.0加固批.md`)+ 修 2 处 UI 撒谎**:T2 本地图导入后文件夹状态不刷新(`recalibrateFolders` 就地校准 + 断开提示 toast,补上 B5 的 UX 待办)、T5 导入报告虚报计数(改用引擎回传真实 `blockCount`)。历史载入弹窗 FAIL 证实为误报(内容全等静默载入是设计行为);append 1 图片失败未复现记偶发。修复已真机复测通过(1 成功/0 降级 · 大文档 174 成功 · 文件夹即时未连接)。〔历史〕上一轮 · **发布前全面审计 + 13 项加固**（4 专项审查：注入/UI/安全/解析；P0×2：标题写错文章 pinnedTabId、坏备份砖化 ErrorBoundary）。**并修复跨机器分支分叉**：标题 ask 弹窗（PR #21）内容曾掉出 main，已 rebase 整合回来（见 §11）。tsc/build/zip 全绿，**待真机回归**。〔历史〕上一轮 · 标题冲突 `ask` 询问弹窗（`TitleConflictDialog` + Promise 化 resolver：编辑器已有标题时弹「覆盖/保留」，真冲突才弹、无冲突静默设，待真机验证）。上一轮:**设置 action 接真实实现(A 组)**：快捷键跳转 `chrome://extensions/shortcuts`、诊断快照导出 JSON、备份/恢复(新模块 `lib/storage/backup.ts`,导出 prefs+options+history+draft、恢复宽松写回)。纯前端,静态预览验证(tabs.create URL / 诊断备份 JSON 结构 / 恢复写回 4 key、无效拒绝)。剩:标题 `ask` 弹窗(B 组,需真机)。上一轮:**批次 C:图片压缩（智能保护 PNG）+ 探针「需刷新」文案（真机验证）**——设置面板诚实化(批次 A/B/C)收官。图片压缩**只压 JPEG 照片**、PNG 截图/文字图保持原样清晰（实测截图压完糊掉后的取舍),压缩打 console 日志;探针 `needs-refresh` 态(当前是 X 页但 content 不应答→提示刷新页面)。上一轮:**全面刷新 README + HANDOFF 文档**（此前停在 M2 早期,严重落后）。上一轮:**批次 B2:scrollTop 接真实实现 + 修 stale-closure / 探针刷新重探**(真机验证):`startImport` useCallback 依赖改为整个 `opts`;探针 `onUpdated` 加 `status==='complete'`。上一轮:**批次 B1:Obsidian 图片 / Wikilink 开关接真实实现**：parser 加 `parseMarkdown(md, opts)`(模块级标志);`obsidianImg` 关时 `![[x]]` 不当图片、`wikilink` 开时行内 `[[x]]`→纯文本(默认开)。8 条 node 用例验证。批次 B 剩 scrollTop(B2,需真机)。设置精简 PR #15 已合并。上一轮:**设置面板诚实化(精简 + 置灰,批次 A,PR #15)**：盘点发现设置里近 2/3 开关「改了不生效」。批次 A **删除 14 个无意义/不可行的项**(altCaption/graphql/tableStrategy/h4Plus/inlineCode/tweetUrl/divider/imgFail/strict/pace/htmlBlock/footnote/codeLang/concurrency,config 行+options 字段一并移除)+ **置灰保留**未接的(codeStrategy/taskList/punct/zhConvert/retries,标「规划中」/「当前固定」);`SettingsTab` 加 disabled 渲染。纯 UI,静态预览验证(删除项消失、保留项置灰、批次 B/C 项保持可交互)。批次 B(低成本接:scrollTop/wikilink/obsidianImg)、批次 C(图片压缩)随后。上一轮:自动填图片 ALT 尝试后搁置(三路皆不通,代码已回退)。PR #10~#14 已合并 main。

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
  - ✅ **探针自动重探**（PR #10，真机验证）：监听标签页事件自动更新连接状态,免手动刷新;tab 定位改为跟随当前活动标签。
  - ✅ **设置面板诚实化**（PR #15/#16/#17，批次 A/B）：盘点发现近 2/3 开关「改了不生效」→ 删 14 个无意义/不可行项 + 置灰未接项;`obsidianImg`/`wikilink`/`scrollTop` 接真实实现;修 stale-closure（切开关不改 md 即时生效）+ 探针刷新后自动重探。
- **本次刚做**：**数学块 `$$` → X 原生 LaTeX**——真机 dump 确认 X 有原生 `LATEX` atomic 块（`data:{}`、公式在块 `text`、逐字符挂同一 entity key）。① parser 新增块级 `$$…$$` 识别（`matchMathOpen`：单行 `$$ x $$` / 多行 `$$\n…\n$$` / 未闭合回退当文本 / `$$100` 行内双美元假阳性防线 / 围栏内不误判 / 空公式回退）；② injector atomic 分支支持 LATEX 真实文本 + 逐字符挂 entity（与 LINK entity 逐字符挂法同理）；③ 能力面板「数学公式」从 warn「未接」改 **native「原生 LaTeX 块」**，新增「未闭合公式」warn 条目（收窄 `RE_MATH_RESIDUE` 只认裸 `$$` 行，消除 `$$100` 假阳性）。行内 `$…$` 本批不做（X 无行内原生承载，与行内代码/图片同策略）。单测 293→307。〔上一轮 v0.3.0〕**列表语义补齐 + 能力面板诚实化 + Toast 溢出修复**——① **嵌套列表**接 Draft 原生 `depth`；② **任务列表** `- [ ]` 接通 `taskList` 设置；③ **能力面板补 7 类语法告知**；④ Toast 溢出修复；⑤ **setext 标题**解析 + 标题抽取全通。
- **还没做**：QA 未跑项 T3 砖化兜底(手动写坏 `chrome.storage`);行内数学 `$…$` / 行内图片(需 Draft 行内 atomic,成本较高,已在能力面板如实告知)。
- **真机验证(本轮,已通过)**：setext 标题两种下划线均成标题且不多出分割线 · 任务列表 ☐/☑ 正确、加粗精确落在文字上未被符号带偏 · `[x]无空格` 原样保留 · 全角空格列表项正常 · emoji/CJK 后的加粗 offset 精确 · 远程图上传 + 封面设置成功（含带查询参数的 `pbs.twimg.com` URL）· 推文嵌入 / 表格 / 代码块 / 分割线均原生。
  - 期间一次图片上传失败经排查为**该 Wikimedia URL 本身不可达**，非代码问题；降级链路如实把 markdown 原文写回正文、未丢内容，行为符合设计。样例已改用 `pbs.twimg.com`。
- **真机结论(本轮)**：**X 忽略 Draft `ContentBlock.depth`**——嵌套列表渲染成扁平列表,有序列表还会被连续重编号。能力面板「多级列表」据此从暂定的 `special` 落为 `warn`、文案改为确定的「X 不支持列表层级 · 已扁平化(内容不丢)」。**depth 保留照写**:语义正确、零成本,X 日后支持即自动生效。
- **已排除（固有限制）**：`postMessage`→MessageChannel「私有通道」（MAIN world 下 File 对页面脚本不可隐藏，见 §8）；**自动填图片 ALT/Description**——实测 ALT 不在 Draft MEDIA entity data（`data` 只有 `mediaItems`）、走 X 后端 `media/edit`,无法「借 Draft 直写」;程序化打开「Edit media」弹窗永久 loading(内部元素不渲染)、Save 只回 Crop tab 不关窗。三路(直写/UI 弹窗/私有接口)皆不通,**自动 alt 已搁置**、代码已回退(分支 `feat/image-alt-text`),`altCaption` 开关为演示占位。详见 §11。
- **下一步**：远期「文章 → Markdown 反向导出」;或按需迭代。
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
- ✅ **本地图片 FS Access**（PR #9，真机验证）：`![](assets/x.png)` / Obsidian `![[y.png]]` → 从授权文件夹读取上传；handle 存 x.com IndexedDB、权限失效时 UI 校准不撒谎、size/MIME 上限、授权浮层防卡屏。
- ✅ **探针自动重探 + tab 跟随当前标签**（PR #10）：监听 `tabs.onActivated`/`onUpdated` 自动更新连接状态；`resolveTargetXTab` 改为只认当前活动 X 标签（探针 + 写入一致）。
- ✅ **本地图按需授权**（PR #11，真机验证）：素材板「本篇图片文件夹」(active) + 设置默认文件夹 (persistent) 两级、**逐文件兜底**（`resolveLocalImageAcrossScopes`）；浏览器重启权限回落后**一键恢复**复用存量 handle。
- ✅ **图片 `<>` 路径 / 封面弹窗 Apply / 代码块语言标签 / 行内代码降级 / 打开 X 跳转**（PR #12）+ **图片 marker 残留多轮重试**（PR #13）。
- ✅ **设置面板诚实化**（PR #15/#16/#17，批次 A/B）：盘点发现近 2/3 开关「改了不生效」→ **删 14 个无意义/不可行项 + 置灰未接项**（批次 A）；`obsidianImg`/`wikilink` 接真实实现（B1）；`scrollTop` 接实现 + 修 stale-closure + 探针刷新重探（B2）。
- ✅ **图片压缩 + 探针「需刷新」文案**（批次 C，真机验证）：**智能保护 PNG**——只压 `image/jpeg` 照片,PNG（截图/文字/UI 图）/ WebP / GIF 保持原样、不转不缩（实测「截图压完糊掉」后的取舍);压缩打 console 日志（原体积→压后体积)。探针新增 `needs-refresh` 态（当前是 X 页但 content 不应答 → 提示「请刷新此 X 页面」而非「打开编辑页」）。

- ✅ **列表语义补齐 + 能力面板诚实化**（本轮，纯离线验证）：
  - **嵌套列表**：`TextBlock.depth` → Draft 原生 `ContentBlock.depth`；缩进→层级走**栈式**换算（`listDepth`），2 空格 / 4 空格 / Tab / 混合缩进都正确，有序无序共用一个栈；上限 4。`depth` 为可选字段且仅 > 0 时写入 → 顶层项产出形状零变化、旧 injector 读不到只退化为扁平（向后兼容）。
  - **任务列表**：接通 `taskList` 设置（`symbol` 转 ☐/☑、`plain` 剥标记），`TextBlock.task` 记勾选态；加前缀时 `shiftInline` 整体平移 offset。设置页该项取消置灰。
  - **能力面板**：补 7 类此前**静默或撒谎**的语法告知（任务列表此前被标绿「原生列表」但正文实际留着 `[ ]` 字面量）；并给 `capability()` 加 `parseOpts` 透传，修掉「面板按默认开关计数、与实际写入不一致」的既存隐患。
  - **Toast 溢出**：长文案限宽换行，图标防压扁；圆角 99→18 在单行下渲染逐字节相同（截图比对验证）。

`tsc --noEmit` 全绿；`pnpm build` 正常出包。

---

## 6. 仍未接真实实现的点（演示/未做）

| 位置 | 现状 | 目标里程碑 |
|---|---|---|
| ~~alt → ALT/Description~~ | ❌ **已搁置**:ALT 不在 Draft MEDIA entity data(`data` 仅 `mediaItems`)、走 X 后端 `media/edit`,无法直写;程序开「Edit media」弹窗永久 loading、Save 不关窗。三路皆不通,代码已回退(见 §11) | **搁置**(第十一次会话) |
| ~~本地图 File 字节经 `postMessage` 到 MAIN world~~ | 本地图/远程/封面 File 在 MAIN world 对页面脚本可读(与远程/dataURI 同面) | **固有限制,不可修**(见 §8;MessageChannel 已验证无效并回退) |
| ~~行内代码 X 渲染~~ | ✅ 真机确认 X 正文**不支持**行内代码 → 降级保留反引号 `code`（`capability` 文案订正） | 本次(第九次会话) |
| ~~「打开 X Articles」按钮~~ | ✅ 已接 `chrome.tabs.create`（待真机验证 URL 落点） | 本次(第九次会话) |
| ~~标题冲突 `titleConflict='ask'`~~ | ✅ 已接询问弹窗（`TitleConflictDialog`，真冲突时问覆盖/保留），真机验证 | 第十二/十三次会话 |
| ~~备份/导出、诊断快照、快捷键跳转~~ | ✅ 已接真实实现（PR #20 `lib/storage/backup.ts` 等），备份往返/非法拒绝真机验证 | 第十二次会话 |
| ~~导入报告失败明细~~ | ✅ 已实现（v0.2.2:序号/来源/阶段/原因,`IMAGE_FAIL_REASONS` 码表,封面哨兵,QA T7 真机验证） | 第十五次会话 |
| ~~嵌套列表~~ | ✅ 已接 Draft 原生 `depth`（栈式换算,上限 4）。**X 的缩进渲染待真机确认**——最坏扁平化,仍优于此前的字面量段落 | 第十六次会话（本轮） |
| ~~任务列表 `- [ ]`~~ | ✅ 已接通 `taskList` 设置（☐/☑ 符号 / 纯文本）,设置项取消置灰 | 第十六次会话（本轮） |
| ~~setext 标题（`标题\n===`）~~ | ✅ 已支持:整段升格 header-one;`extractTitle` 认 setext 一级标题、`stripFirstH1` 按行数删两行。能力面板告警条目已随之移除 | 第十六次会话（本轮） |
| ~~数学块 `$$`~~ | ✅ 已接 X 原生 `LATEX` atomic（真机 dump 实证 shape:`data:{}`、公式在块 `text`、逐字符挂 entity）。块级 `$$…$$` 单行/多行/未闭合回退/围栏内不误判/`$$100` 假阳性防线。**待真机验证渲染** | 第十七次会话（本轮） |
| **行内数学 `$…$`** | ⚠️ 按纯文本写入（X 的 LaTeX 是块级 Insert,无行内原生承载,与行内代码/图片同策略）。**能力面板已如实告知** | 暂缓 |
| **行内图片**（段落中的 `![](x)`） | ⚠️ 保留 markdown 原文（仅独占一行的图片会上传）。需 Draft 行内 atomic,成本较高。**能力面板已如实告知** | 暂缓 |
| 脚注 `[^1]` / 内嵌 HTML | ⚠️ 保留原文（X 均不支持）。**能力面板已如实告知** | 不计划 |
| `punct` / `zhConvert` / `retries` / `codeStrategy` 设置项 | 仍置灰「规划中 / 当前固定」（诚实占位,非撒谎） | 未定 |

> 图片上传（远程/dataURI）、封面、原生表格均已完成并真机验证合并（PR #4/#5/#7）。
>
> **§6 与 §0 是最容易漏更新的两处**（第十四次会话的明确教训）——每轮改动后务必连同 §5/§9/§11 一起过一遍。

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
  3. `sweepMarkers` 删 marker 块时**不能把 blockMap 删空**（空 map + selection 指向已删块会崩）——删空时保留一个块并清空其文本。**退出条件必须是「连续两轮读到干净」**:X 的 onChange 异步 commit 下单次"干净"读取可能是陈旧中间态(真机实测写入后 ~24s 仍有 marker 未 commit),信单次读会假干净收工、残留静默(v0.2.2 修复,勿回退);清扫仍未确认时走残留审计 `marker-residue` 上报。
  4. background 是持任意 host 权限的取数代理，SSRF 防护（IPv4-mapped IPv6 `::ffff:`、跟随重定向后复检 `resp.url` 落点、流式体积上限、magic-byte 真实类型）不可删。
  5. 远程图 host 权限用运行时 `permissions.request`，**必须是写入手势链上第一个 await**——不能先 `await permissions.contains`（会消耗用户手势导致 request 被拒）。
  6. 已知未做（真机验证后按 xposter §3.3 精修）：多图 relocate 的空分裂块清理、marker 被 X 插入破坏时的 fallback 顺序配对。
- **列表正则的两组空白语义不同，别"统一"掉**（`RE_UL`/`RE_OL`/`RE_TASK_MARK`）：
  1. **缩进组**（组1）必须是 `[ \t]*`——只有空格/Tab 有确定列宽，`indentWidth` 才能换算 depth。
  2. **标记后的分隔符**必须保持 `\s+`。`\s` 覆盖**全角空格 `　`(U+3000)** 与 NBSP，中文输入法下 `-　项目` / `- [x]　完成` 极常见；收窄成 `[ \t]` 会让它们掉进段落分支、正文留下字面量 `-　项目`——正是本轮要消灭的那类内容错乱。**本轮自查时我一度收窄过，已回退并加了会真失败的回归测试**（把正则改回收窄版跑测试可复现红灯）。
- **列表 depth 用栈式换算，不要改成「缩进 ÷ 固定单位」**：除法必须假定每级固定 2 或 4 空格，遇到另一种缩进或 Tab/空格混用就整体算错层级；栈式（`listDepth`）只看相对深浅，2 空格 / 4 空格 / Tab / 混合都正确。上限 4 —— Draft 默认样式表只到 `public-DraftStyleDefault-depth4`。injector 侧的 clamp 要**先过 `Number.isFinite`**：单纯 `Math.max/min` 挡不住 NaN（遇 NaN 一路返回 NaN），NaN 进 Draft 数值字段会让列表渲染出难查的怪状态。
- **凡「扫原始 md」的统计,必须和 `parseMarkdown` 用同一套跳过口径**：`forEachContentLine` 只跳**围栏**、**不跳 frontmatter**。capability 的 setext 计数曾直接扫原文，把「frontmatter 体末行 + 闭合 `---`」当成 setext 标题，**任何带 frontmatter 的文档**都凭空多一条假告警。frontmatter 判定已抽成 `frontmatterBodyStart()` 导出、两处共用——再有新的"扫原文"需求一律复用它，别另写一套（本项目已在 frontmatter/围栏判定上栽过两次"第二套实现漂移"）。
- **列表缩进有门槛,别去掉**（`canBeListItem`）：已在列表 run 中 → 任意缩进算嵌套项；不在列表中 → 仅 ≤3 列才起列表（CommonMark 规则，≥4 列属缩进代码块领域）。去掉门槛后，正文里**粘贴的 4 空格缩进代码/日志**中的 `- x` 会被拆成列表项、丢掉原始缩进语境。
- **给块文本加前缀必须整体平移 offset**（任务列表 ☐/☑ 前缀，见 `shiftInline`）：`inlineStyleRanges`/`links` 的 offset 是相对「加前缀之前的文本」算的，直接字符串拼接会让 `- [ ] **粗体**` 的加粗区间砸到前缀符号上。offset 单位是 UTF-16 码元（见下条）。
- **标题打分（setTitle）**：关键词（title/标题）是**硬门槛**，否则会误命中正文大 contenteditable，overwrite 时清空正文。别放宽。
- **frontmatter**：parser 跳过与 `extractTitle` 抽取的边界判定必须一致（都用**顶格 `^---`**）；H1 抽取/移除都要**跳过代码块**。
- **content script 更新不自动生效**：改 content/injector 后必须刷新 X 页面；症状①「三灯绿但写入报未连接」= 页面跑旧 content；症状②「正文写入了却报 `images undefined` 崩溃 / 图片不上传」= 新 injector + 旧 content（旧 content 注入新 injector 但自己不带 images 字段）。injector 已对 images 默认 `[]` 防御（崩溃→降级），但**真正上传图片必须刷新页面**加载新 content。
- **MAIN world 下 File 对页面脚本「不可隐藏」——固有限制，勿再尝试「私有通道」**：injector 在 MAIN world，与 x.com 页面 JS 共享同一个 window 与 JS 堆。图片上传靠**借页面的 `onFilesAdded` 回调**（只存在于 MAIN world），File 必须序列化进 MAIN world 才能喂给它——一旦进入，同 world 的页面脚本就能 hook `onFilesAdded` / `FileReader` 读到，**换任何传输通道都藏不住**。曾试图用 MessageChannel 把 content↔injector 通信私有化（分支 `feat/messagechannel-private`），**已验证不可达成并回退**：`window.postMessage(hello, origin, [port2])` 派发的是**单个**事件，MAIN world 里所有监听器（injector + 页面脚本）拿到的是**同一个** `e.ports[0]`；页面脚本 `addEventListener('message', e => e.ports[0].onmessage = leak)` 即可在握手期抓到 port、读走后续所有 File（已实测确认）。MessageChannel 仅能挡「被动 `window.onmessage` 监听」，挡不住任何主动页面脚本，收益不足以支撑「私有」表述。**结论**：这是「借 `onFilesAdded` 上传」架构的固有代价，除非改上传路径（如 GraphQL 上传 API——技术方案明确避开的脆弱/付费路径）。**教训**：动隔离/安全边界前，先写清威胁模型（对手是谁、能力边界）+ 查证 API 确切语义（文档/实测），确认目标**理论可达**再动手，别凭「感觉更私密」下手。
- **FS 文件夹 handle 对 x.com 页面脚本可读（固有残留，已缓解）**：`FileSystemDirectoryHandle` 因 FS Access origin 绑定**只能**存 x.com origin 的 IndexedDB（sidepanel 扩展 origin 用不了它，搬不走）。而 content script 与 x.com 页面**共享同源 IndexedDB**——页面脚本 / XSS 可 `indexedDB.open('markflow_local_assets')` 取出 handle、免手势 `getFile()` 遍历读用户**整个已连文件夹**（比「MAIN world File 不可隐藏」严重：那只暴露正在导入的单张图，这暴露整文件夹、持久）。**已缓解**（发布前加固）：涉及本地图的导入结束后 `clearVaultHandle(active+persistent)`，把暴露窗口从「整个会话」压到「单次导入」；代价是每篇导入需重选文件夹。**残留**：「连接后从未导入」的窗口仍暴露（content 侧无自然清理时机），用户可手动「清除」；将 x.com XSS 视为威胁模型内则此为固有面。
- **`InlineStyleRange.offset` 单位 = UTF-16 码元，禁止直接喂 `convertFromRaw`**：parser 用 `string.length`（码元）计 offset，injector 按 `block.text.length` 逐**码元**构造 characterList 直接 merge 进 Draft ContentBlock——全链路统一码元，emoji/CJK 扩展字符（代理对）后的样式区间精确对齐。**雷区**：Draft 的 raw 格式（`convertFromRaw`/`encodeInlineStyleRanges`）按**码点**计——将来若有人改走 rawToContentState，所有代理对之后的区间会整体错位。保持直写 characterList 路径。
- **pnpm 11 构建脚本**：esbuild 需在 `pnpm-workspace.yaml` `allowBuilds` 放行。
- **CJK 字体**：只打包拉丁字体，中文用系统栈。
- **`.output`/`.wxt`/`node_modules` 不提交**（已 gitignore）。

---

## 9. 待办与路线图

**已完成**（均已合并 main 并真机验证）：✅ Phase A/B/C UI · ✅ M1 注入引擎（正文全格式直写）· ✅ M2 标题 / 图片上传（远程 + dataURI）/ 封面 / 原生表格 · ✅ 本地图 FS Access + **按需授权（两级文件夹 + 一键恢复）** · ✅ 探针自动重探 · ✅ **设置面板诚实化（批次 A/B/C：精简 + 置灰 + obsidianImg/wikilink/scrollTop/图片压缩接实现）** · ✅ 探针「需刷新页面」文案区分。详见 §5 与 CHANGELOG。

**设置面板诚实化（批次 A/B/C）已收官**——每个能点的开关都真实生效。图片压缩为「智能保护 PNG」：只压 JPEG 照片、PNG 截图保持清晰（批次 C，`feat/batch-c-compress`，真机验证，待提 PR）。

**待办（体验/数据类，任选）**
- [x] ~~标题冲突 `titleConflict='ask'` 独立询问弹窗~~ ✅ 已实现并真机验证（QA T1 五子用例全过，含 pinnedTabId 挂起切标签场景）。
- [x] ~~备份导出 / 恢复、诊断面板、快捷键跳转~~ ✅ 已接真实实现并真机验证（QA T3:合法往返 + 3 类非法文件拒绝）。
- [x] ~~B5 清 handle 后的断开提示 toast~~ ✅ 已补（真机回归 T2 修复的一部分）。
- [x] ~~**导入报告失败明细**（QA T6 引出）~~ ✅ 已实现并真机验证(v0.2.2,QA T7;含 marker 残留审计上报)。
- [x] ~~**嵌套列表 / 任务列表 / 能力面板静默降级**~~ ✅ 本轮实现（离线单测验证）。
- [x] ~~**真机确认 X 对 Draft `depth` 的缩进渲染**~~ ✅ **已确认：X 忽略 Draft `depth`，嵌套列表渲染为扁平**（有序列表还会被连续重编号），层级确实丢失。能力面板「多级列表」据此保持 `warn`、文案定为「X 不支持列表层级 · 已扁平化(内容不丢)」。`depth` 仍照写（语义正确、零成本，X 日后支持即自动生效）。即便扁平也远优于此前的字面量 `- 二级` 段落。
- [ ] QA 未跑项:T3 砖化兜底(手动 `chrome.storage.local.set({markflow_prefs:"corrupted"})` 后面板不白屏)。

**下一批候选（本轮盘点发现、已在能力面板如实告知但尚未支持）**
- [x] ~~**数学块 `$$`**~~ ✅ 本轮实现：真机 dump 确认 X 原生 `LATEX` atomic 块（`data:{}`、公式在块 `text`、逐字符挂 entity），parser 识别块级 `$$…$$` → injector 直写 → 能力面板标 native。**待真机验证渲染**。
- [ ] 行内数学 `$…$`：X 的 LaTeX 是块级 Insert 项，无行内原生承载，暂只如实告知（与行内代码/行内图片同策略）。
- [ ] 行内图片（段落中的 `![](x)`）：需要 Draft 行内 atomic，成本较高，暂只如实告知。

**远期**：文章 → Markdown 反向导出（xposter 有范本，§8.1 导出器）。

**已排除（固有限制 / 搁置，勿再尝试）**：自动填图片 ALT（不在 Draft entity、走后端、UI 弹窗卡死，见 §6/§11）；`postMessage`→MessageChannel 私有化（MAIN world 下 File 对页面脚本不可隐藏，见 §8）。

---

## 10. 关键参考资产

- **技术方案**：`docs/技术方案设计.md`（功能规格 §5、注入路线 §2–4、里程碑 §9）。
- **注入引擎范本**：`docs/research/xposter-analysis.md`（MIT 竞品 xPoster 源码深析）——M1 直写照它 §1，**M2 图片上传照 §3、封面照 §3.4–3.5**。
- **M0 探针**：`docs/research/m0/`。
- **对照测试**：`docs/qa/comparison.html`。
- **设计稿**：四主题变量、九组设置、双语文案已全部落进代码，无需回看即可开发。

---

## 11. 最近一次会话小结

**2026-07-25 · 第十七次会话（本次）· 数学块 `$$` → X 原生 LaTeX**：
- **先真机 dump 定 entity shape,再动手**：X 的 LaTeX 块 entity 形状是本项目 M0 探针清单里一直没做的一项(DIVIDER/MARKDOWN/TWEET 都有源码/dump 实证,唯独 LATEX 没有)。开发前先写 Console dump 脚本(照 injector 的 fiber 定位路径)交用户真机跑,拿到确切 shape:`entityType="LATEX"` / `mutability=IMMUTABLE` / `data={}`(空) / **公式本体在块 `text`** / **每个字符都挂同一 LATEX entity key**。**教训延续**:entity 形状绝不臆造(捏错 X 直接不渲染),先 dump 实证再写。
- **LATEX 与前三种 atomic 的形状相反**:DIVIDER/MARKDOWN/TWEET 的数据在 entity `data`、块文本恒单空格(injector 硬编码);LATEX 反过来——`data` 空、公式在 `text`。故 protocol 给 LATEX 变体独有 `text` 字段;injector atomic 分支按 `entityType==='LATEX'` 分流:公式文本逐字符挂同一 entityKey(与既有 LINK entity 逐字符挂法同理),其余三种保持单空格。
- **parser 块级 `$$` 识别**(`matchMathOpen`):单行 `$$ x $$` 就地成块、多行 `$$\n…\n$$` 找裸 `$$` 闭合行、未闭合回退当文本(与未闭合围栏一致)、空公式回退。**假阳性主防线**:`$$100 涨到` 这类行内双美元其后非空 → 判 null 不进块判定、也不当段落边界(沿用本项目「`$$` 须行首」口径)。放在围栏之后(围栏内 `$$` 已被吃掉)、其余 atomic 之前。
- **能力面板诚实化**:「数学公式」从 warn「未接」改 **native「原生 LaTeX 块」**;新增「未闭合公式」warn 条目。计数从产出块取(LATEX atomic → native),文本残留的裸 `$$` 起行 → warn;`RE_MATH_RESIDUE` 收窄到**只认裸 `$$` 行**,替换旧 `/^\$\$/m` 的宽松匹配,消除 `$$100` 假阳性(沿用本项目「计数从 parseMarkdown 产出取,不另起正则」doctrine)。
- **自查 + 独立 review 各揪一条,均反证钉住**:① 自查发现单行分支 `line.slice(2,-2)` 未先 `trimEnd`,`$$ x $$ `(尾随空格)会切出 `x $$` 脏结果——修为先 trimEnd 再切,补回归测试(bug 版跑测试确实红);② review agent 揪出 multi 分支「起行 `$$` 后带内容」是**死代码**(`matchMathOpen` 对 `$$x` 判 null,永远进不来)且注释虚假宣称支持——复现确认后删死代码 + 订正注释。两条都自己复现/反证后才动手,不采信 agent 自述。
- **行内 `$…$` 不做**:X 的 LaTeX 是块级 Insert 项,无行内原生承载,如实告知降级(与行内代码/行内图片同策略)。
- 单测 293→307(块级 $$ 多行/单行/未闭合/空公式/围栏内/缩进/尾随空格/`$$100` 假阳性 + capability native/warn 拆分)。tsc/build 全绿。**唯一待真机项:X 对 LATEX atomic 的渲染**(无登录态无法验证)。
- **顺带**:订正 §9 里「真机确认 X 对 depth 渲染」的遗留 checkbox(顶部结论早已写明确认扁平、面板已落 warn,但 §9 checkbox 未同步勾掉)。

**2026-07-25 · 第十六次会话· 列表语义补齐 + 能力面板诚实化 + Toast 溢出**：
- **起点是一次主动盘点**：文档当时只剩 QA T3 一项待办，但直接把常见 Markdown 喂给 `parseMarkdown` 实跑后，发现一批**文档未记录**的缺口。最要命的两条是**内容错乱而非降级**：嵌套列表的二级项掉进段落分支、正文留字面量 `  - 二级`；任务列表正文留 `[ ]` 字面量，而**能力面板还把它标绿「原生列表」**——面板在撒谎，直接违背 README 的核心承诺。**教训：文档记的待办 ≠ 真实欠账，隔几轮该拿真实输入实跑一遍核心纯函数。**
- **嵌套列表**：`TextBlock.depth` → Draft 原生 `ContentBlock.depth`。缩进→层级用**栈式**换算而非除法（除法必须假定固定 2 或 4 空格，混用就整体错）；有序无序共用一个栈；上限 4。`depth` 可选且仅 > 0 时写入 → 顶层项产出零变化、旧 injector 读不到只退化为扁平。
- **任务列表**：接通早已存在却被置灰的 `taskList` 设置；`shiftInline` 在加 ☐/☑ 前缀时整体平移 offset（否则 `- [ ] **粗体**` 的加粗区间会砸到前缀上）。
- **能力面板诚实化**：补 7 类此前静默/撒谎的语法告知；并给 `capability()` 加 `parseOpts` 透传，修掉「面板按默认开关计数、与实际写入不一致」的既存隐患。
- **Toast 溢出**：限宽换行 + 图标 `flexShrink:0`；圆角 99→18 经截图逐字节比对确认单行零视觉回归。
- **自查揪出自己引入的回归**：我把列表分隔符从 `\s` 收窄成了 `[ \t]`，会让中文输入法的**全角空格** `-　项目` 掉进段落——正是本轮要消灭的那类 bug。已回退并补了**会真失败**的回归测试（改回收窄版跑测试确实红灯，证明非空转断言）；同类问题在任务标记 `RE_TASK_MARK` 上一并修掉。见 §8。
- **独立 code review 揪出 3 条并修**（都自己复现确认后才动手）：**frontmatter 闭合 `---` 被误计为 setext 标题**（假告警，命中绝大多数真实文档 —— 已抽 `frontmatterBodyStart()` 与 parser 共用口径）；**放开缩进匹配后 4 空格缩进的粘贴代码被拆成列表项**（按 CommonMark 加 `canBeListItem` 门槛）；`$$` 行中假阳性（改判行首）。四处修复**全部用「回退代码→测试必须变红」反证过**，确认不是空转断言。
- **分工**：Toast / 任务列表 / 能力面板交 subagent（Sonnet）按详细规格实现，嵌套列表 + injector（§8 硬约束所在）由主控自己做；三者都改 `parser.ts`/`capability.ts` 故**串行**执行，只有 Toast 与嵌套列表并行（文件集不重叠）。**agent 自述一律不采信**，逐个 `git diff` 核对后才收（沿用第六次会话的教训）——本轮 review agent 报的 3 条也是自己复现后才认。
- **setext 标题**(同批补做):解析升格 header-one + `extractTitle`/`stripFirstH1` 跟进(占两行,按 `lineCount` 删,只删一行会把 `===` 留在正文);判定复用 parser 导出的 `setextUnderlineLevel`/`isParagraphLine` 不另写一套;能力面板的告警条目随之移除。
- 单测 225 → 293（嵌套 depth / 任务列表 / 能力面板 / setext 四组 + review 修复的回归）。tsc/build 全绿。**唯一待真机项：X 对 `depth` 的缩进渲染**（无登录态无法验证，最坏扁平化仍优于现状，不阻断）。

**2026-07-16 · 第十五次会话 · 批次三:导入报告失败明细(v0.2.2)**：
- **失败明细链路**:`prepareOneImage` 失败分支带原因码(远程透传 background error);`uploadOneImage` 改回 `{ok, reason, detail}`——8 条互异失败路径各有其码(此前调用点靠 `uploadErr===null` 猜成「超时」,「已上传但归位失败」与「超时」排查方向完全相反);封面失败 content 通道层补记(index=-1 哨兵,prepare/set 均覆盖);`coverKeep=remove` 场景引擎序号 +1 还原用户文档顺序。
- **单一事实来源**:`protocol.ts` `IMAGE_FAIL_REASONS` as const 联合——生产端强类型、消费端 string 宽松(备份恢复兼容);`truncateForReport`(代理对安全)三处共用;备份白名单 index 须 ≥ -1 整数、source/detail 恢复边界重截。
- **8 角度 code review 修 8 条**(5 finder 并行 + 验证):序号错位/封面丢原因/upload 猜码/旧脚本误报('prepare-missing')/detail 不截断/备份校验弱/码表无类型/双份手工账(imageFail 从明细派生)。
- **真机暴露 sweepMarkers「假干净」并修复**:旧退出条件「某轮没读到残留就收工」,X 异步 commit 下一次陈旧读取即终止清扫(实测写入后 ~24s 仍有 4 个 marker 未 commit,躲过全部 4 轮)→ 连续两轮 clean 才收工(上限 6 轮)+ 'no-node' 不当干净 + 收尾残留审计 `marker-residue` 进明细(不计 imageFail,图已落地)。
- **QA T7 全过**:T6 replace/append 各 ×3 零残留;偶发远程超时被如实报「图 2 · 上传超时」——功能目标实战兑现。QA 文档补 T7 + 三条「已知非 bug」(needs-refresh 闸门先拦旧脚本场景等)。
- 遗留:QA T3 砖化兜底未跑。

**2026-07-16 · 第十四次会话 · 全量真机回归 + 修 2 处 UI 撒谎**：
- **QA 文档化回归**：产出 `docs/qa/真机回归测试-v0.2.0加固批.md`（T1 标题 ask ×5 / T2 handle 清除 / T3 备份 / T4 载入确认 / T5 解析加固 / T6 全格式冒烟,含「已知非 bug 勿误报」清单）,交自动化测试 Agent 真机执行,14 用例覆盖发布前加固全部改动。
- **T2 修复（UI 撒谎）**：B5 清 handle 后素材板/设置仍显示「已连接」直到组件重新挂载。`WorkspaceProvider` 新增 `recalibrateFolders`(涉本地图导入成功收尾时向 content 重查两级文件夹状态、回写 opts)+ 成功 toast 追加「文件夹已安全断开,下篇导入需重新连接」(补上第十三次会话记的 UX 待办)。谓词 `usesLocalImage` 与 content 侧完全一致(blocks local 图或本地路径封面)。
- **T5 修复（报告撒谎）**：`finishImport` 的「成功」数从 `capability(md)` 格式计数改为引擎回传真实 `blockCount - imageFail`(纯文本段落此前 0 成功、大文档虚高 192 vs 174);「降级」保持格式降级项口径(单位「处」,与块数不同单位,已注释说明)。
- **两项悬案定向复测**：T4 历史载入弹窗——上次 FAIL 为误报,根因是「载入内容与当前草稿全等 → 按设计静默载入」,哨兵文本复测弹窗正常;「载入示例」按钮只在空草稿引导态渲染,天然无需闸门。T6 append 的 1 图片失败干净基线未复现 → 记偶发,待报告失败明细落地后再观察。
- **文档漂移修正**：§0/§6 仍把标题 ask、备份/诊断/快捷键标「还没做/toast 演示」(第十三次会话只更新了 §5/§9/§11)——本次一并订正。**教训重申**:每轮改动 §0 TL;DR 和 §6 表格也要过一遍,不只 §5/§9/§11。
- **环境附带**（与仓库无关,本机）:`packageManager` pin 曾致本机 pnpm 全崩(npmmirror 镜像 pnpm 元数据缺 `dist` 字段 × pnpm 自管版本切换),已用 corepack shim 接管 `/usr/local/bin/pnpm` 解决,pin 保留。
- 待办:导入报告失败明细(批次三);QA 未跑项 T3 砖化兜底。

**2026-07-16 · 第十三次会话 · 发布前全面审计 + 加固（4 专项）+ 分支分叉修复**：
- **4 专项深度审计**：注入引擎 / UI 状态机 / 安全合规 / 解析层并行审查 + 交叉验证，产出 6 阻断 + 7 强烈建议 + ~25 跟进 + 3 商店合规。综合就绪度 6.8→修完必修/强烈建议批。
- **13 项修复（4 域并行 subAgent，文件集不重叠免冲突）**：见 CHANGELOG「发布前加固」。P0 两个：标题写进别人那篇（`pinnedTabId` 钉死）、坏备份砖化（白名单校验 + `ErrorBoundary`）。
- **⚠️ 跨机器分支分叉修复（重要教训）**：标题 ask 弹窗（PR #21，本机真机验证过）虽 `gh` 标 MERGED，但**内容不在 origin/main**——另一台电脑把 main 推进到 4a9c24b（PR #14-#20）时把它顶掉了，孤悬在 `feat/title-ask-dialog`（`a666f9c`）。审计发现 fix 分支（从 main 建）缺标题 ask。**处理**：fix 分支 `git rebase --onto feat/title-ask-dialog 4a9c24b`，手工整合标题阶段冲突（ask 逻辑 × B1 pinnedTabId：三处 setTitle 全复用 pinnedTabId）+ 把 TitleConflictDialog 也提升到 App 层。最终 main 拿到标题 ask + 13 加固。**教训**：跨机器多分支并行时，`gh` 的 MERGED 状态 ≠ 内容在当前 main；合并前必须 `git merge-base --is-ancestor` 验证功能 commit 真在 main。
- ~~**安全 UX 待补**：涉及本地图的导入后文件夹变「未连接」、下篇需重选（B5 清 handle 的既定代价）——建议加一句 toast 提示，暂记待办~~ ✅ 第十四次会话已补（连同文件夹状态就地校准一起,见 T2 修复）。
- 待真机回归：标题 ask（覆盖/保留）+ 本地图导入后文件夹清除 + 备份恢复非法文件不砖化 + 载入历史确认弹窗。

**2026-07-15 · 第十二次会话· 标题冲突 `ask` 询问弹窗**：
- **`titleConflict='ask'` 接真实实现**（`feat/title-ask-dialog`）：此前 `ask` 保守降级 `keep`，现补独立询问弹窗。机制：标题在正文写入**后**设置，`ask` 模式先 `setTitleOnXTab(title,'keep')` 探测——`applied=true`（编辑器本无标题、顺便设好）无冲突不弹；`applied=false`（已有标题被跳过）→ `askTitleConflict(title)` 弹 `TitleConflictDialog` 并 **await 用户选**。resolver 存 `titleAskResolver` ref，用户点覆盖/保留 → `settleTitleAsk` 兑现 Promise 恢复 `startImport`。只在**真冲突**打扰、无冲突静默设。改 3 处（`WorkspaceProvider` async 逻辑 + 新组件 + dict）。纯前端，tsc/build 绿，**待真机验证**（需编辑器已有标题的场景）。

**2026-07-15 · 第十一次会话· 本地图按需授权(PR #11)+ 自动 alt 尝试后搁置**：
- **本地图按需授权**（PR #11,已合并）：两级文件夹 `active`（素材板「本篇图片文件夹」)+ `persistent`（设置默认），逐文件兜底 `resolveLocalImageAcrossScopes`(active 缺某图才回落 persistent);素材板就地连接/更换/清除;浏览器重启权限回落后「一键恢复」复用存量 handle。真机全通过。
- **自动填图片 ALT/Description —— 尝试后搁置**：目标是把 markdown `![alt]` 的 alt 写进 X 图片的 ALT 无障碍描述。实现并真机后失败,逐一排除三条路:
  - **直写 Draft entity data 不可行**:手动填 ALT+Save 后 dump MEDIA entity,`data` 只有 `entityKey` + `mediaItems[{localMediaId, mediaCategory:"DraftTweetImage", mediaId}]`,**无 alt/description 字段**、填的文本也不在 → ALT 走 X 后端(按 mediaId 经 `/compose/articles/media/edit`),不进 Draft。
  - **UI 弹窗自动化脆弱/卡死**:程序 `realClick`「Edit media」按钮打开弹窗后**永久 loading**,内部 `[role="tab"][aria-label="Edit image description"]` / `textarea[data-testid="altTextInput"]` 全不在 DOM(手动打开正常,疑似 media 未就绪 + ALT tab 是 `<a href="/compose/articles/media/edit">` 触发路由);且 Save(`endEditingButton`)只保存并回 Crop tab、**不关弹窗**,须点左上返回。
  - **后端私有接口**与项目对 GraphQL/私有接口保守立场相悖,不做。
  - **结论**:自动 alt 搁置,代码全回退(分支 `feat/image-alt-text` 弃用),`altCaption` 开关维持演示占位。若将来做只剩后端接口一条路,需先评估稳定性。
- **附带**:3 处 `getReadableVault`→`resolveLocalImageAcrossScopes` 文档订正(PR #11 review 改名后漏同步的注释/CHANGELOG)。

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

**2026-07-15 · 第十次会话（本次）· 图片 marker 残留修复 + B(alt→ALT) 启动**：
- **修复 · 图片 marker 残留**（`fix/marker-sweep-retry`）：真机见多图导入后正文残留 `__MARKFLOW_IMG_q5hsn4_4__`。根因：某图走 `relocateMediaByFallbackIndex` 兜底路径（精确 relocate 失败 → 只确认 MEDIA 存在、**不删 marker 块**，留给 sweep）后，`sweepMarkers` **单次**清扫因 X `onChange` 异步 commit、读到 fiber 中间态而漏删。改 `sweepMarkers` 为 **async 多轮重试**（每轮 delay 让 X commit + 读最新 state 删残留，至多 4 轮；抽出 `sweepMarkersOnce` 返回「本轮是否有残留」），两处调用点加 `await`。tsc/build 绿，**待真机验证清理**。
- **B（alt→ALT/Description）方向厘清 + DOM 全探清（下次开箱即实现）**：真机确认 X 图片**两个**入口——**Edit → ALT → Description**（无障碍 alt text，语义 = markdown `![alt]` 的 alt）与 **Edit Caption**（图左下、可见图注）。经用户选定，alt 写 **ALT / Description**（语义正确、无障碍、不改文章视觉）。**完整 DOM（用户实测提供）**：
  - **入口**：图左上常驻 `button[aria-label="Edit media"]`（每张图一个，按 DOM 出现顺序对应第 k 张图）→ 点击打开「Edit media」弹窗（默认可能停在 Crop tab）。
  - **切 ALT tab**：`[role="tab"][aria-label="Edit image description"]`（text "ALT"，`href="/compose/articles/media/edit"`，`aria-selected` 反映选中）→ 点击切到 ALT。
  - **输入框**：`textarea[data-testid="altTextInput"]`（`name="altTextInput"`，`maxlength=1000`）——**是 textarea 非 contenteditable**！填值须用 native value setter（`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el, alt)`）+ `dispatchEvent(new Event('input',{bubbles:true}))`，否则 React 受控组件不认。
  - **保存**：`[data-testid="endEditingButton"]`（text "Save"）→ 点击保存并关弹窗（点击用 realClick 完整事件序列，参考封面）。
  - **流程（逐图串行）**：第 k 张 `uploadOneImage` 成功后，若 alt 非垃圾 → 点第 k 个 `Edit media` → 点 ALT tab → 填 altTextInput → 点 endEditingButton → 等弹窗关 → 下一张。串行避免弹窗叠加。
  - **数据流**：`PreparedImage` 加 `alt`；`prepareOneImage` 带 `block.alt`；`imageMarkers` 记 alt。**垃圾 alt 过滤**（空/`image`/`img`/纯文件名如 `IMG_3512.PNG`/纯数字/单字符 → 跳过）。
  - **未决**：`Edit media` 按钮与「第 k 张图」的对应需实现时验证（DOM 顺序假设）；Save 后 X 是否需额外确认。

> 下一步接续：**B · alt→ALT/Description**（等用户 DOM）；**本地图按需授权**（导入时自动弹选文件夹——体验优化）。`docs/research/xposter-analysis.md` §3.5 标题/封面 GraphQL、§7 FS Access 实证。~~postMessage 隐私 A2(MessageChannel)~~ 已验证不可达成并放弃(见 §8)。
