# HANDOFF · 跨机器接力文档

> **这份文档的用途**：让在**另一台电脑**上的 AI Agent（或你本人）能无缝接续开发，无需重新摸索上下文。
>
> **维护约定（重要）**：
> - 每次「阶段性功能完成 → 提交代码」时，**必须同步更新本文档**，使其始终反映最新进度、未完成任务与后续规划。
> - 本文档随代码一起提交到 git 仓库。任何一台电脑上开发，都按此约定更新并提交。
> - 更新时重点维护：`## 5 当前进度`、`## 9 待办与路线图`、`## 11 最近一次会话小结`，并在顶部更新「最后更新」。
> - **工作流**：每批改动 **先 code review + 修复，再提交**；走 **feature 分支 → PR → 合并 main**，不直接推 main。

**最后更新**:2026-10-26 · 分支 `claude/happy-ride-bjd4qg`(基于 main `782d306`)· **v0.5.0 尚未打 tag——真机回归通过后打在 main `782d306`,不要打在之后的 main HEAD(第三批进 0.5.1,打错即 tag 漂移)**。本轮全面审查(`docs/review/全面审查-2026-10-26.md`)的修复按用户决定并入 0.5.0:**第一批**(P1/P4/P5、W1/W2/W10,PR #36、#37)与**第二批**(阶段 A 解析 PR #38、阶段 B 界面 / 文案 / 文档 PR #39)均已合入 main。**第三批**方案见 `docs/review/修复方案-2026-10-26-第三批.md`(用户已定:先打 v0.5.0、第三批进 0.5.1;P12 空标题不产出块;ESLint 放阶段 C 单独 PR)。**第三批阶段 A**(P6 / P11 / P12 / H1 / O5 / O7 / O8)已合入 main(PR #40);**阶段 B 的 I2 / I4** 本分支实施(待真机回归 QA T32),I5 / I6 / I7 等用户用 `docs/qa/真机取证脚本-第三批阶段B.md` 取证后再定;阶段 C 方案已定(O9 / O1 / O2 / O4 做,O3 / O6 不做,见方案 §3),阶段 C(C1–C4)已全部合入 main(PR #42–#45,O3 / O6 按方案不做)。均记入 CHANGELOG `[Unreleased]`,计划随 0.5.1 发布。单测 851。**真机回归**:0.5.0 用 `782d306` 构建跑 `docs/qa/真机回归执行清单-v0.5.0.md`;0.5.1 用 main 构建跑 `docs/qa/真机回归执行清单-v0.5.1.md`(A 必测 6 / B 应测 3 / C 可选 2,附 I4–I7 取证),发版步骤见其 §7。逐项明细见 CHANGELOG [0.5.0] / [Unreleased];更早的历史见 §11 与 git log。

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
- **本次刚做(v0.5.0 定版)**:两轮上线前审查的修复合集。① 8 月审查(`docs/review/上线前全面审查-2026-08-18.md`)五批修复——存储写失败可见、草稿/历史多窗口同步、tabId+articleId 双钥钉死、committed 区分、marker 剥离保文本、解析 12 项、备份恢复安全化、Toast 分型、对比度等;② 10 月发版前复审(`docs/review/发版前审查-2026-10-22.md`)阶段 0～3——pnpm pin 修复、A1 同行多张带链接图片(P0)、B1 图片阶段 settle 谓词等待(P0)、B3 `/compose/articles` 写入闸门、去 `tabs` 权限改 host_permissions、`minimum_chrome_version` 116、manifest `_locales` 国际化、A2 强调符 flanking、B2 超时晚到 MEDIA 追回 + orphan 审计、C2 设置多窗口同步、C9 本地图文件名索引、B9 回传校验、B10 SSRF 补漏、字体只打 latin woff2(1.11MB→约 640KB)。单测 307→646。版本号 0.5.0、CHANGELOG 定版、README / 隐私政策 / NOTICE / QA T16～T21 已同步。〔v0.4.0〕数学块 `$$` → X 原生 LaTeX 块(真机验证)。 〔打 tag 前复审修复(2026-10-23,本分支)〕对 PR #33 的五路审查 → 对抗性核实 → 方案评审后,修复核实属实的 #33 引入回归与旧问题:本地图同名多处报 `local-ambiguous`(不再静默选错图)、删除末轮 FIFO(无法归属的晚到图如实上报 `orphan-media` / `media-order-uncertain`)、权限被拒 toast 只计确实未授权的域名并剔除被拦主机、ask 拒绝权限后确认覆盖不二次弹窗、`isBlockedHost` 补漏、标题抽取改取解析主循环上报的标题(P3)并隔离解析开关(P7)、`findClosing` 记忆化(P1/P2)、列表续行 `2024.`(P5)、frontmatter `cover` 整行判定(P6)。P4(列表下 4 空格缩进的围栏 / 引用 / 标题、Tab 制表位)推迟 0.5.1,见 backlog。
- **还没做(发版前)**:① 本分支 `/check` 审查 → 修复 → 复审通过后提交、开 PR,由用户合并(PR #32 / #33 已合入 main);② 真机回归 `docs/qa/真机回归测试-审查修复五批.md` T1～T15 + T16～T22(B1/B2/B3/权限弹窗/去 tabs 探针/字体是代码无法自证项;其中 T17 已按「无静默错位」改写,T19 补 ask 拒绝后确认不二次弹窗与已授权 / 被拒混合,T22 为本地图同名歧义);③ 把 `docs/privacy-policy.md` 发布到公开地址(仓库私有,审核员打不开),补联系邮箱;④ 打 `v0.5.0` tag → release 工作流出 zip → 商店上传,后台填权限理由与隐私 URL。发版后待办见 `docs/review/backlog-2026-10-22.md`。
- **明确不做(产品决策)**：**行内数学 `$…$`** 与 **行内图片**——X 的 LaTeX / 媒体都是**块级** Insert 项,无行内原生承载,与「行内代码」同策略:保留原文、能力面板如实告知。不再列为候选,勿再评估。
- **真机验证(本轮,已通过)**：setext 标题两种下划线均成标题且不多出分割线 · 任务列表 ☐/☑ 正确、加粗精确落在文字上未被符号带偏 · `[x]无空格` 原样保留 · 全角空格列表项正常 · emoji/CJK 后的加粗 offset 精确 · 远程图上传 + 封面设置成功（含带查询参数的 `pbs.twimg.com` URL）· 推文嵌入 / 表格 / 代码块 / 分割线均原生。
  - 期间一次图片上传失败经排查为**该 Wikimedia URL 本身不可达**，非代码问题；降级链路如实把 markdown 原文写回正文、未丢内容，行为符合设计。样例已改用 `pbs.twimg.com`。
- **真机结论(本轮)**：**X 忽略 Draft `ContentBlock.depth`**——嵌套列表渲染成扁平列表,有序列表还会被连续重编号。能力面板「多级列表」据此从暂定的 `special` 落为 `warn`、文案改为确定的「X 不支持列表层级 · 已扁平化(内容不丢)」。**depth 保留照写**:语义正确、零成本,X 日后支持即自动生效。
- **已排除（固有限制）**：`postMessage`→MessageChannel「私有通道」（MAIN world 下 File 对页面脚本不可隐藏，见 §8）；**自动填图片 ALT/Description**——实测 ALT 不在 Draft MEDIA entity data（`data` 只有 `mediaItems`）、走 X 后端 `media/edit`,无法「借 Draft 直写」;程序化打开「Edit media」弹窗永久 loading(内部元素不渲染)、Save 只回 Crop tab 不关窗。三路(直写/UI 弹窗/私有接口)皆不通,**自动 alt 已搁置**、代码已回退(分支 `feat/image-alt-text`),`altCaption` 开关为演示占位。详见 §11。
- **下一步**:真机回归 → 打 tag 上架;之后按 backlog 迭代,远期「文章 → Markdown 反向导出」。
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
- **lint**：`pnpm lint`(ESLint,只开 React hooks 两条规则,CI 同跑)。有意省略 hooks 依赖时写 `// eslint-disable-next-line react-hooks/exhaustive-deps` 并在上一行写理由;豁免失效会报错。
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
  markdown/BlockPreview.tsx      # 预览:按解析产出渲染「写进 X 的样子」(第三批 C3)
  markdown/sample.ts
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

- ✅ **storage 加载路径校验**（本轮）：此前**恢复备份时逐字段校验、日常加载却裸信任**，是一处不对称。后果不只是崩——**恢复手段过重**:一个坏 `skin` 字段就抛错、把用户推到「清空全部本地数据」的恢复卡片，草稿与历史一并陪葬。
  - 校验器（`validatePrefs/Options/History`，已有 36 例测试）下沉到新模块 `lib/storage/schema.ts` 并接入四个 loader。**零新逻辑**。
  - 下沉是为破环：`backup.ts` 自身 import 四个 loader（导出要读当前数据），若 loader 反向 import 它复用校验器即成 `prefs → backup → prefs` 运行时循环。`Prefs`/`defaultPrefs`/`HistoryItem` 一并迁入 schema，原模块 re-export，既有导入点零改动。
  - 行为转变：坏字段**静默回落默认、面板照常可用、用户数据保全**；坏历史项**只丢该项**、其余历史保留。bootstrap 的 try/catch 与 ErrorBoundary 保留为**最后一道防线**，不再是第一道。
  - 新增 63 例单测（`loadValidation.test.ts`）：13 种损坏形态 × 四个加载器，含**端到端接线测试**（塞脏 JSON 进 localStorage 驱动真实 `loadX()`）——只测校验器而不测接线的话，漏接了照样全绿。已用「拆掉校验 → 测试变红」反证。

- 🟡 **v0.5.0 · 上线前两轮审查修复**(8 月五批 + 10 月阶段 0～3,**代码侧三绿,待真机回归**):
  - **写入安全**:双钥钉死 + 文章页路由闸门(推文/私信框不再「已连接」);图片阶段每步 `settle` 等 React 提交(非末张失败不再被回滚删掉);超时晚到 MEDIA 只按 pendingKey 精确追回(无归属证据的不猜,如实上报 `orphan-media` / `media-order-uncertain`;末轮 FIFO 已在 2026-10-23 删除);权限申请统一为两条写入路径的第一个 await;injector 回传白名单校验(B9)。
  - **解析**:链接图片括号配对扫描器(A1)、强调符 flanking + 转义 + `\p{L}` 词内 `_`(A2/A12/A13)、列表续行 / 列表内缩进围栏(A3/A4)、围栏判定收敛为 `parseLines(onFence)` 单一来源、标题抽取 `inlinePlainText`、frontmatter/cover 边角十余项。
  - **数据**:存储写失败常驻错误条、草稿/历史/设置/主题多窗口同步、草稿防抖 250ms+2s max-wait、历史 UUID(备份 version 2)、恢复前确认 + 自动导出、wipe 真清、加载路径逐字段校验(PR #31)。
  - **上架合规**:去 `tabs`、host_permissions 仅 x.com/twitter.com、`unlimitedStorage`、Chrome ≥116、manifest `_locales`(en/zh_CN)、设置页版本读 manifest、生产不打 `console.info`、隐私政策 / NOTICE、字体瘦身(约 640KB,wxt 构建报告 637.58 kB)。
  - 单测 307(v0.4.0 tag)→ 370(PR #31)→ 488(8 月五批)→ 646(10 月三阶段)→ **738**(打 tag 前复审修复)。

`pnpm compile` / `pnpm test`(738)/ `pnpm build` 全绿(2026-10-23 复审修复批:`pnpm test` 738 通过;compile / build 以提交前 `/check` 为准)。

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
| ~~数学块 `$$`~~ | ✅ 已接 X 原生 `LATEX` atomic（真机 dump 实证 shape:`data:{}`、公式在块 `text`、逐字符挂 entity）。块级 `$$…$$` 单行/多行/未闭合回退/围栏内不误判/`$$100` 假阳性防线。**已真机验证渲染**（`E = mc^2` 原生渲染成 LaTeX 块） | 第十七次会话（本轮） |
| **行内数学 `$…$`** | ⚠️ 按纯文本写入（X 的 LaTeX 是块级 Insert,无行内原生承载,与行内代码/图片同策略）。**能力面板已如实告知** | 暂缓 |
| **行内图片**（段落中的 `![](x)`） | ⚠️ 保留 markdown 原文（仅独占一行的图片会上传）。需 Draft 行内 atomic,成本较高。**能力面板已如实告知** | 暂缓 |
| 脚注 `[^1]` / 内嵌 HTML | ⚠️ 保留原文（X 均不支持）。**能力面板已如实告知** | 不计划 |
| `punct` / `zhConvert` / `retries` / `codeStrategy` 设置项 | 仍置灰「规划中 / 当前固定」（诚实占位,非撒谎） | 未定 |
| **扩展更新后旧 injector 需刷新 X 页面** | ⚠️ 扩展无法替换已注入页面的旧脚本;v0.5.0 协议新增 `isArticleEditor`,旧脚本不回该字段 → 探针判 `needs-refresh`、提示「请刷新此 X 页面以启用插件」(fail-closed,不会误写)。每次涉及协议的发版都要在更新说明里提醒用户刷新 | 固有限制 |
| `settleTimeouts` / `imageLateRecovered` / `orphanMedia` 诊断字段 | ⚠️ **仅 X 页面 console 可见**:sidepanel 侧经 `resultGuards` 归一化时有意丢弃(不入存储、UI 不消费,测试明确断言丢弃),排查看 X 页面 console 的 `[MarkFlow]` 日志;orphan / 错位经失败明细 `orphan-media` / `media-order-uncertain` 呈现 | 按需 |
| 可选 host 权限撤销入口(D8) | ⚠️ 扩展内无 `permissions.remove` 入口,用户只能去 chrome://extensions 撤销 | backlog |

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
- **LATEX 块的多行公式:链路正常,`\n` 不需要处理**（2026-07-25 真机验证，`docs/qa/测试样例-多行公式.md`）：多行公式体会让 `AtomicBlock.text` 带 `\n`，X **原样传给 LaTeX 渲染器**，`aligned` / 矩阵 / 分段函数（含多个 `\n` + `\\`）全部正确渲染换行与对齐。**「两行独立公式连排」是标准 LaTeX 语义、不是缺陷**——数学模式下换行符即空白（KaTeX/MathJax 同理），要换行须用 `\\` 且在支持换行的环境里。**曾考虑把 `\n` 换成空格，已否决**：既是 no-op（渲染器本就当空白），若进一步改成插真换行更有害——同一 markdown 在 Obsidian/GitHub 里也是连排，我们单独换行反而与用户本地预览不一致。忠实搬运即正确。
- **storage 读出必须先校验,别再加「裸信任」的加载路径**（`lib/storage/schema.ts`）：四个 loader 已统一走 `validateX()`。新增持久化切片时**照此接上**，别退回 `{...默认, ...存储}` 的裸展开——`getItem` 只在值为 `undefined` 时用 fallback，`null`/字符串/数字/数组都会被原样返回。**校验器与结构定义必须留在 `schema.ts`**（不能挪回 `backup.ts`）：`backup.ts` 自身 import 四个 loader，loader 反向依赖它就成运行时循环。
- **别用「面板没白屏」当砖化测试的通过标准**：坏数据分两类——① 触发抛错（→ 兜底 UI）；② **静默回落默认值**（面板看起来完全正常）。旧 QA T3 用 `{markflow_prefs:"corrupted"}` 两头都没打到（key 名写错 + 字符串展开不覆盖任何字段），跑出来是「面板正常」→ 记 PASS，实则 ErrorBoundary 与 RecoveryScreen **一次都没执行到**。要打到校验路径必须让**字段本身非法**（如 `{skin:'bogus'}`）。
- **标题打分（setTitle）**：关键词（title/标题）是**硬门槛**，否则会误命中正文大 contenteditable，overwrite 时清空正文。别放宽。
- **frontmatter**：parser 跳过与 `extractTitle` 抽取的边界判定必须一致（都用**顶格 `^---`**）；H1 抽取/移除都要**跳过代码块**。
- **content script 更新不自动生效**：改 content/injector 后必须刷新 X 页面；症状①「三灯绿但写入报未连接」= 页面跑旧 content；症状②「正文写入了却报 `images undefined` 崩溃 / 图片不上传」= 新 injector + 旧 content（旧 content 注入新 injector 但自己不带 images 字段）。injector 已对 images 默认 `[]` 防御（崩溃→降级），但**真正上传图片必须刷新页面**加载新 content。
- **MAIN world 下 File 对页面脚本「不可隐藏」——固有限制，勿再尝试「私有通道」**：injector 在 MAIN world，与 x.com 页面 JS 共享同一个 window 与 JS 堆。图片上传靠**借页面的 `onFilesAdded` 回调**（只存在于 MAIN world），File 必须序列化进 MAIN world 才能喂给它——一旦进入，同 world 的页面脚本就能 hook `onFilesAdded` / `FileReader` 读到，**换任何传输通道都藏不住**。曾试图用 MessageChannel 把 content↔injector 通信私有化（分支 `feat/messagechannel-private`），**已验证不可达成并回退**：`window.postMessage(hello, origin, [port2])` 派发的是**单个**事件，MAIN world 里所有监听器（injector + 页面脚本）拿到的是**同一个** `e.ports[0]`；页面脚本 `addEventListener('message', e => e.ports[0].onmessage = leak)` 即可在握手期抓到 port、读走后续所有 File（已实测确认）。MessageChannel 仅能挡「被动 `window.onmessage` 监听」，挡不住任何主动页面脚本，收益不足以支撑「私有」表述。**结论**：这是「借 `onFilesAdded` 上传」架构的固有代价，除非改上传路径（如 GraphQL 上传 API——技术方案明确避开的脆弱/付费路径）。**教训**：动隔离/安全边界前，先写清威胁模型（对手是谁、能力边界）+ 查证 API 确切语义（文档/实测），确认目标**理论可达**再动手，别凭「感觉更私密」下手。
- **FS 文件夹 handle 对 x.com 页面脚本可读（固有残留，已缓解）**：`FileSystemDirectoryHandle` 因 FS Access origin 绑定**只能**存 x.com origin 的 IndexedDB（sidepanel 扩展 origin 用不了它，搬不走）。而 content script 与 x.com 页面**共享同源 IndexedDB**——页面脚本 / XSS 可 `indexedDB.open('markflow_local_assets')` 取出 handle、免手势 `getFile()` 遍历读用户**整个已连文件夹**（比「MAIN world File 不可隐藏」严重：那只暴露正在导入的单张图，这暴露整文件夹、持久）。**已缓解**（发布前加固）：涉及本地图的导入结束后 `clearVaultHandle(active+persistent)`，把暴露窗口从「整个会话」压到「单次导入」；代价是每篇导入需重选文件夹。**残留**：「连接后从未导入」的窗口仍暴露（content 侧无自然清理时机），用户可手动「清除」；将 x.com XSS 视为威胁模型内则此为固有面。
- **`InlineStyleRange.offset` 单位 = UTF-16 码元，禁止直接喂 `convertFromRaw`**：parser 用 `string.length`（码元）计 offset，injector 按 `block.text.length` 逐**码元**构造 characterList 直接 merge 进 Draft ContentBlock——全链路统一码元，emoji/CJK 扩展字符（代理对）后的样式区间精确对齐。**雷区**：Draft 的 raw 格式（`convertFromRaw`/`encodeInlineStyleRanges`）按**码点**计——将来若有人改走 rawToContentState，所有代理对之后的区间会整体错位。保持直写 characterList 路径。
- **`settle` 谓词等待不可去掉**(B1,injector):图片阶段每次 `onChange` 之后都必须等 X 真正提交(谓词:marker 文本已变 / MEDIA 已出现)再读下一轮 editorState。去掉或换回固定 `delay` 会让下一轮用陈旧 state 读-改-写,把上一步(如失败图写回的原文)回滚,marker 重现后被清扫整块删掉——内容静默丢失。settle 超时只记账(`settleTimeouts`)不中断。
- **权限申请:首次点击时 `request` 必须是第一个 await;ask 确认路径不再申请**:直写与 ask 两条路径的**首次点击**都要先同步解析 blocks 并 `permissions.request`,再做探针/其他 await。任何前置 await(包括「先探针取 articleId」)都会消耗 Chrome 的瞬时用户激活,新 profile 下权限弹窗会直接被拒、不弹出。8 月批次二曾在直写路径前插了探针 await,10 月阶段一才改回。ask 弹窗确认(覆盖 / 追加)时手势已用过,`startImport` 带 `permAlreadyRequested`:跳过 `request` 与 toast,只用 `queryRemoteImagePermissions`(`permissions.contains`,无需手势、不弹窗)对当前 origins 重算未授权集合供失败改标——别在确认路径再调 `requestRemoteImagePermissions`,否则拒绝后会二次弹窗 + 二次 toast(B6)。`permissions.request` 全有或全无,拒绝不影响已授权 origin,故 toast 计数与改标只认 `deniedOrigins`,不能把「被拒」当成「全部未授权」(B4);origin 计算只有 `originPatternOf` 一处。
- **晚到 MEDIA 只做 `pendingKey` 精确追回,不按顺序猜归属**(B2):循环中与循环结束后各扫一遍当前 state,只把已拿到 mediaId 的、超时那刻登记过 key 的 pending 块还给对应的超时图。**末轮 FIFO 已删除**(曾把任意无主 ready 块按顺序分给最早超时图,无归属证据、猜错即两图对调且全报成功)。无法归属的如实上报:多出的图走 `orphan-media`;存在不可追踪的超时图(无 pendingKey,或其块已消失)、其后有图成功归位、且孤儿数在扣除「仍可追踪(pendingKey 仍在)的超时图自身的块」后仍 > 0 时另推一条 `media-order-uncertain`(detail 为英文诊断串;不计 imageFail;以孤儿数为门槛压误报,代价是错位链末块在审计后才到时漏报,见 backlog)。**别再加「按顺序分配」类兜底**,除非先拿到 MEDIA entity 数据层面的归属证据。
- **标题抽取只认解析主循环上报的标题**(P3/P7):`pickTitleHeading` 只从 `parseMarkdownWithHeadings` 上报的标题里挑,不要在 `frontmatter.ts` 再写 setext / 段落行的自有判定("第二套实现漂移" 已栽过多次);`extractTitle` / `parseMarkdownWithoutTitle` / `firstTitle` 的解析开关必须由调用方透传(`WorkspaceProvider` 与 `capability` 已透传),模块级开关只在 `withParseOptions` 内临时设置并还原。
- **去标题按块下标,不再改 md 文本**(P4,2026-10-26):`h1Handle=remove` 走 `parseMarkdownWithoutTitle`——一次解析、按标题上报的 `blockIndex` 去掉那一块。别退回「删源行 / 换空行再重解析」:删行会让相邻行重新拼接(首行 `---` 被当 frontmatter、两段合并、正文被吸进列表项),换空行同样会改变语境(`- 项\n# 标题\n  续行` 的续行会被吸进列表项)。
- **`$$` 闭合搜索遇空行即止;带内容的起行只看段落续行**(P1,2026-10-26):LaTeX 数学模式不允许空行,别把闭合搜索改回无界(会跨段落配对、吞正文);`$$ a+b` 这种带内容的起行与口语 `$$100` 同形,只允许裸闭合、且中间遇任何块级起始行即止,别放宽成「带内容 × 带内容」或不设边界。
- **草稿回声按自写队列判定,不能只靠 pending 闸门**(W2,2026-10-26):`flushDraft` 在写入完成前就清 pending,前一次慢写入的回声会晚于下一次 flush 才到——只看「无 pending、值不同」会把自己的旧回声当外部编辑采纳(回退 + 丢字)。新增持久化切片若也订阅 onChanged,照 `echoQueue` 登记自写值;与已落盘值相同的写入不登记(Chrome 不发事件,会滞留)。
- **导入收尾只用显式传入的本次运行数据**(W1,2026-10-26):`finishImport` 的 md / 解析开关由 `startImport` 传入(`buildRunRecord`),别再从组件闭包读 `opts.*`——`useCallback` 依赖漏一项就会记下旧值,且平时改稿 / 切语言重建回调会把问题藏起来。
- **未闭合围栏到文末都是代码;未闭合 HTML 注释反而回退文本**(第二批 P2 / P3,2026-10-26):两条看似矛盾,依据是「内容不丢」——围栏延伸到文末仍把内容按代码写进 X;注释块不写入,若也延伸到文末就是整篇后文静默丢失。别把其中一条「统一」成另一条。文末孤立的开栏行(其后无内容)不产空代码块。
- **探针重探保留上次结论**(第二批 W5):`useProbe` 只在首次探测时显示 `probing`,之后重探只置 `loading`。别改回「每轮先置 probing」——`connected` 会短暂为 false,横幅闪烁、写入按钮禁用一拍;写入安全由 `startImport` 写入前的即时重探保证,不依赖这里。
- **历史同步与草稿同用自写回声队列**(第三批 H1):`commitHistory` 登记 `historySignature`(id 序列),onChanged 先经 `decideHistoryChange` 吞掉自写回声再判采纳。别退回「与当前是否相同」——连续两次写入时前一次的迟到回声会让列表闪回。与已落盘签名相同的写入不登记(Chrome 不发事件,会滞留)。
- **草稿写失败走退避重试,退避期间键入不排定时器**(第三批 O7):`draftFailCount > 0` 时 `schedulePersist` 只更新 pending,由重试定时器落盘;重试成功时若又有新编辑,`flushDraft` 负责恢复常规防抖。改这段时三种时机都要顾到:退避中键入、重试写入进行中键入、失焦 / 手动保存与重试并发。
- **列表语境按「上一块是否在列表项内部」保留**(第三批 P6):轮首清栈条件是「上一个块不是列表项且不在列表内部」,「在内部」= 该块起行缩进 ≥ 当时的列表内容列。别改回只看块类型——列表里的缩进围栏 / 图片之后子项层级会清零。
- **能力计数要与写入同一判定**(第三批 P11):报告用 `capability(md, en, parseOpts, adjust)`,`adjust` 由 `startImport` 按 `h1Handle` / `coverKeep` 的实际移除结果给出并存进报告快照;新增「写入前改块」的步骤时,同步加进 `CapabilityAdjust`,否则报告又按原始 md 计数。
- **整对象切片的多窗口同步只有一份**(第三批 C4,`lib/storage/syncedObject`):设置与偏好都走 `useSyncedObject`;再加同类切片(整对象存一个 key、无未落盘编辑概念)照此接入,别再复制一份 Provider 内的同步代码。`stableJson` 只适用于扁平对象。草稿 / 历史有自己的判定(`decideDraftChange` / `decideHistoryChange`),别并进来。
- **预览只渲染解析产出**(第三批 C3,`lib/markdown/BlockPreview` + 侧边栏 `DraftPreview`):别再引入通用 Markdown 渲染器——预览的意义就是「写进 X 的样子」。新增块类型 / 行内样式时同步改 BlockPreview;链接 href 只经 `safeHref`(http(s) / mailto),不得用 `dangerouslySetInnerHTML`;图片保持占位框(预览不发网络请求)。
- **解析结果只算一次、只读共享**(第三批 C2):写入流程用 `analyzeDraft` 一次得出标题 / 正文块 / 去标题块(`blocksWithoutTitle`),收尾与报告卡复用同一份(`RunInput.analysis`、`LastRunSnapshot.analysis`);草稿页卡片读 `useDraftAnalysis()`(DraftTab 内的 `DraftAnalysisProvider`,`useDeferredValue` 延后)。别在组件里再调 `parseMarkdown` / `capability(md…)`;共享的 `blocks` 不得原地修改;要看原文时用 `useDraftAnalysis().md`(与解析配对的那份),别混用 `useWorkspace().md`。
- **正文编辑器定位只有一份**(第三批 I4,`lib/bridge/editorLocator`):injector 与 content 共用 `findEditorElement`。别在 content / 其他地方再写 `querySelector('[contenteditable="true"]')`——页面里第一个可编辑区不一定是正文。
- **空稿取样的 `x` 要么被主提交替换、要么撤回**(第三批 I2):插入前复查切文章、轮询每轮复查;取样失败时只在正文恰为 `x` 时 `undo`,撤不掉在错误串里带 `SAMPLE_RESIDUE_SUFFIX` 让侧边栏提示。在插入与主提交之间再加 await 会放大残留窗口。
- **素材板与写入流程的「封面来源 / 是否涉及本地图」只有一份**(第二批 W6,`lib/workspace/importPlan`):别在组件里再写一套判定。
- **`findClosing` 跳过完整链接要走 `scan.link` 缓存**(第二批 P8):`matchLink` 自身 O(n)(A21),不缓存时每个 `[` 都重算,`[a` 重复串比改前慢约 3 倍。
- **引用内的围栏产出代码块**(P5,2026-10-26):引用分支先认围栏、按 CommonMark「容器结束即闭合」,并 `onFence` 上报区间;不要把引用改回逐行 `walkInline` 处理围栏行。
- **本地图按文件名兜底遇同名多处不得静默挑一个**(B1):导入时只有 md 的 `File`、拿不到它在文件夹里的路径;`./`、`../` 开头多候选即 `ambiguous`,单段文件名取最浅者、并列也 `ambiguous`;解码遍优先(解码遍唯一即用、歧义即报歧义,不被原串遍覆盖,解码遍无候选才看原串遍);索引层按作用域顺序,第一个有候选的文件夹决定结果(歧义 / 唯一候选读失败都不再落到下一作用域);歧义与权限回落按作用域顺序归因(排在歧义作用域之前的作用域权限已回落 → 报 `local-permission-lapsed`,否则报歧义)。报告原因 `local-ambiguous`。
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
- [x] ~~QA T3 砖化兜底~~ ✅ 已由**加载路径校验**+ 63 例单测覆盖(`lib/storage/loadValidation.test.ts`)。⚠️ 旧版 QA 步骤写错两处(key 名 `markflow_prefs` 应为 `markflow:prefs`;payload `"corrupted"` 触发不到任何防护),照旧版做会得到**假通过** —— 已在 QA 文档订正。

**下一批候选（本轮盘点发现、已在能力面板如实告知但尚未支持）**
- [x] ~~**数学块 `$$`**~~ ✅ 本轮实现并真机验证：真机 dump 确认 X 原生 `LATEX` atomic 块（`data:{}`、公式在块 `text`、逐字符挂 entity），parser 识别块级 `$$…$$` → injector 直写 → 能力面板标 native。真机导入 `$$\nE = mc^2\n$$` 后 X 原生渲染出 LaTeX 公式块。
- [ ] 行内数学 `$…$`：X 的 LaTeX 是块级 Insert 项，无行内原生承载，暂只如实告知（与行内代码/行内图片同策略）。

**v0.5.0 发版前**:真机回归(QA 文档 T1～T21)→ 隐私政策发布到公开地址 → 打 tag 上架。见 §0「还没做」。

**发版后待办**:见 [`docs/review/backlog-2026-10-22.md`](./docs/review/backlog-2026-10-22.md)——审查推迟项(A8/A11/A19～A21、B6/B12/B13/B15、C10～C24/C27/C28/C32/C37、D8)与本轮 code review advisory;另有 8 月方案遗留的设计层项(信息架构流水线化、mdast 重构、arm 共享 hook)。

**2026-10-26 全面审查**:见 [`docs/review/全面审查-2026-10-26.md`](./docs/review/全面审查-2026-10-26.md)(31 项新问题,其中 3 项需真机确认;另 9 条优化,均不在上面的 backlog 里);第一批 P1/P4/P5/W1/W2/W10 修复方案见 [`docs/review/修复方案-2026-10-26.md`](./docs/review/修复方案-2026-10-26.md)(已合入 main:PR #36、#37);第二批(P2/P3/P7/P8/P9、W3–W9/W11、I1/I3、D1)方案见 [`docs/review/修复方案-2026-10-26-第二批.md`](./docs/review/修复方案-2026-10-26-第二批.md)(已合入 main:PR #38、#39);第三批(剩余解析边角、历史回声、需真机取证的注入项、优化项)方案见 [`docs/review/修复方案-2026-10-26-第三批.md`](./docs/review/修复方案-2026-10-26-第三批.md)(阶段 A 已实施,进 0.5.1;阶段 B / C 待后续)。

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

**2026-10-26 · 第二十次会话(续)· 第三批阶段 C4 + Actions 额度事故**:
- PR #44 的 CI 两次秒挂:job 没分配到 runner(`runner_id: 0`、无日志),同时段 main 上的运行也一样——仓库 Actions 额度 / 账单问题,非代码。按规则重跑一次确认、在 PR 留言;用户处理额度后重跑全绿再合并。**教训**:「2–3 秒失败 + 无步骤 + 无日志」先查 runner 分配与额度,别去改代码。
- C4:`useSyncedObject` + 纯函数 `decideSyncedChange` / `stableJson` 单测;审查期 React 脚本模拟双实例(B 跟随 A、快速连改时迟到回声不回退、key 删除回落默认)——新旧代码都绿,去掉回声判定的变异版本变红(脚本须把两次写入落盘分在不同 `act` 里,否则 React 合并渲染、回退看不见)。

**2026-10-26 · 第二十次会话(续)· 第三批阶段 C3**:
- 预览改为渲染 `analysis.blocks`;纯函数(`inlineSegments` / `safeHref` / `groupBlocks` / `parseTableMarkdown`)与无 hooks 的 `BlockList` 在 node 下用 `renderToStaticMarkup` 单测;全格式样例渲染截图人工检查。check 审查补一处:代码块正文首行形似表格分隔行时被误渲染成表格——`parseTableMarkdown` 先认围栏。删 react-markdown / remark-gfm,侧边栏 JS 450 → 294 KB。
- 与方案的出入:图片保持原有占位框而不加载远程图(预览不发请求,与此前一致);hooks 外壳放 `entrypoints/sidepanel/components/draft/DraftPreview.tsx`,`lib/markdown` 只留纯渲染,测试不必加载侧边栏状态层。

**2026-10-26 · 第二十次会话(续)· 第三批阶段 C2**:
- `analyzeDraft` / `blocksWithoutTitle` / `capabilityFromAnalysis` / `titleText`;写入路径 4 遍(含报告卡 5 遍)→ 1 遍,草稿页每次按键 2 遍 → 1 遍且延后。验证:仓内等价测试(语料 + 1500 组随机 × 3 种开关)、新旧差分 24 万组零差异、160 KB 基准(写入 131 → 40 ms,按键 54 → 30 ms)、审查期 React 脚本(两个面板随草稿更新且一次改动只解析一次;原有 8 例回归通过)。
- 与方案的出入:Provider 挂在 DraftTab 而非 WorkspaceProvider(切到记录 / 设置时不解析,与此前一致);报告快照也带上 analysis,报告卡不再重解析。

**2026-10-26 · 第二十次会话(续)· 第三批阶段 C 方案 + C1**:
- 方案(think skill):实测 160 KB 文档每次按键能力面板与素材板各全文解析一次(约 30 + 30 ms),写入流程 4 遍解析只在点写入时发生;去掉 react-markdown + remark-gfm 侧边栏 JS 450 → 289 KB。据此 O1 扩到按键路径、O2 做、O4 收窄到 Settings / Prefs、O3 / O6 不做;用户按推荐批准。
- C1:ESLint 只开 hooks 两条规则;首次运行抓到 `copyHistoryItem` 依赖写错(`t.errWriteFail` 应为 `t.errCopyFail`;因 `t.copiedToast` 随语言一起变,回调照样随语言重建,未造成可见问题——事后复核更正,起初误判为可见 bug)与 `startImport` 多余依赖 `en`。依赖版本按「发布满 14 天」锁定(caret 会解析到 7–10 天前的新版,改为显式指定版本)。

**2026-10-26 · 第二十次会话(续)· 第三批阶段 B 的 I2 / I4**:
- 阶段 A 合入(PR #40)后给出真机取证脚本(`docs/qa/真机取证脚本-第三批阶段B.md`,E1–E4 与 injector 同口径,Chromium 下用模拟页面 / 模拟 Draft 状态跑通四段);用户决定 I2 / I4 先修、取证结果稍后给。
- I2 / I4 的可判定部分抽为 `lib/bridge/editorLocator`、`lib/bridge/sampleResidue` 加单测;注入层行为只能真机验证(QA T32)。check 审查补一处:定位不到编辑器时不再执行 `insertText`。

**2026-10-26 · 第二十次会话(续)· 第三批阶段 A**:
- **决定**(用户按推荐):第一、二批真机回归后先打 v0.5.0(打在 main `782d306`),第三批进 0.5.1、记入 CHANGELOG `[Unreleased]`;P12 空标题不产出块;ESLint(O9)放阶段 C 单独 PR。
- **实施**:P6 / P11 / P12 / H1 / O5 / O7 / O8。纯逻辑抽到 `lib/`(`historySync`、`draftRetryDelay`、`folderErrText`、`CapabilityAdjust`)加单测;新旧差分 4 万组随机输入,差异只出现在空标题(P12)与列表内缩进块(P6)两类,逐条抽看均为预期改进。审查期 React 测试脚本(不入库)验证 H1 / O7:同样断言在 main 上红、本分支绿。
- **check 审查抓到一处**:O7 初版在「重试写入进行中又有键入、重试成功」时,新编辑没有定时器、滞留到下次键入或失焦——重试成功后若有待写值即恢复常规防抖;用去掉该修复的变体确认测试会红。另把 P6 的列表语境记录挪到清栈之后(行为不变,语义更直)。

**2026-10-26 · 第二十次会话 · 全面审查 + 第一批修复(阶段 1:解析层)**:
- **审查**:解析层 / 侧边栏·存储 / 注入链路 / 文档四路(两路由 subagent 并行,结论逐条由主控复现或对照源码核实)→ 31 项新问题(其中 3 项需真机确认)+ 9 条优化,全部不在 10-22 backlog 里,存 `docs/review/全面审查-2026-10-26.md`。
- **第一批**(用户决定并入 0.5.0,W10 顺带修):阶段 1 做 P1 / P4 / P5,阶段 2 做 W1 / W2 / W10,各一个 PR。提交前用 Waza `check` skill 审查,有问题修完再提。
- **阶段 1 的 check 审查抓到一处**:P1 初版让 `$$ a+b` 这类带内容的起行只以空行为界,会把中间的列表 / 引用 / 标题吞进公式(`$$100 涨\n- 项\n$$`)——收紧为只看段落续行,补测试。另用「旧提交独立 worktree + 2 万组随机输入」做新旧差分:不含 `$$` / 引用的输入零差异。
- **教训**:随机差分里「有差异的样本」要逐条看,不能只数数——这次的问题正是从样本里看出来的。
- **第二批阶段 A**:用户选定 P2 / P3 / W9 均按推荐方案。check 审查抓到四处并修:P8 链接跳过让病态输入慢约 3 倍(加 `scan.link` 缓存)、文末孤立 ``` 会产空代码块、YAML 解码可能把换行 / NUL 带进标题、能力面板把列表 / 引用里的 `<!--` 误计为未闭合注释。与方案的偏差:未闭合 HTML 注释回退为文本(不吞到文末),理由见 §8。
- **第二批阶段 B**:各项判定抽成 `lib/` 纯函数加单测(probeView / drag / importPlan / errorText / folderOverlayText / reportTone / pruneHistory / beginProbe);另用审查期的 React 测试脚本(不入库)端到端验证 W5(重探期间 connected 不掉)、W8(改上限立即裁剪并写回)、W9(两级清除 + 提示 + 延迟 reload)。check 审查改一处:清除数据时文件夹清除挪到本地数据删完之后(清除请求最长等超时,不能拖住删除)。
- **阶段 2**:W1 / W2 抽成纯函数(`buildRunRecord`、`echoQueue` + `decideDraftChange`)加单测;另用审查时的 React 测试脚本(linkedom + 假 chrome.storage,不入库)做端到端反证——同样两条断言在旧代码上红、新代码上绿。W10 的实现与方案有一处出入:方案写「快照照存」,实际按 B4-6「快照与报告卡同生命周期」改为草稿已变时两者都不置回(历史照写)。

**2026-10-23 · 第十九次会话 · 打 tag 前对 PR #33 的复审修复**:
- **起点**:PR #32 / #33 合入 main 后、打 tag 前,对 `b3dac9a..0ec9b15` 做五路审查 → 两路对抗性核实 → 两路方案评审,只收核实属实的问题(方案 `docs/review/修复方案-2026-10-23.md`,证伪项与推迟项见其第 3 节)。分支 `fix/pre-tag-review-2026-10-23`,版本号仍 0.5.0,改动并入 CHANGELOG `[0.5.0]`。
- **修复**:B1 本地图同名歧义、B2 删末轮 FIFO + 不确定提示、B4/B5/B6 权限计数 / 被拦主机 / ask 确认路径、F6 SSRF 补漏、P3/P7 标题单一来源与开关隔离、P1/P2 findClosing 记忆化、P5 列表续行、P6 cover 整行判定。P4 推迟 0.5.1。实现中的定案:B1 唯一候选读取失败时不再落到下一作用域;B2 不确定提示 detail 为英文诊断串、仅 `orphanMedia > 0` 时出现;B6 确认路径用 `queryRemoteImagePermissions` 只查不申请;F6 `198.18/15` 只对点分 IPv4 字面量生效;P3 补充:标题抽取跳过「未闭合围栏开栏行 / `$$` 后跟 `===`」形成的 setext 标题(正文解析不变),这类不会被设为文章标题、会继续找下一个一级标题;P5 只有字面 `1.` 能打断。
- **教训**:同一事实的「第二套判定」是反复出现的缺陷源(标题抽取 vs 正文解析、origin 计算申请 vs toast)——这次都收敛为单一来源(`onHeading`、`originPatternOf`);猜归属的兜底(FIFO)在没有归属证据时比如实上报更危险,「报成功的错位」比「报失败」伤用户更深。
- **文档**:CHANGELOG / HANDOFF / QA(T17 改写、T19 补充、新增 T22)/ backlog(P4 + 实施要点、B2 残留、本地图与协议相对地址等旧问题)已同步。

**2026-10-22 · 第十八次会话· 发版前复审 + 三阶段修复 + v0.5.0 定版**:
- **起点**:发现 8 月审查分支(9 个提交、五批修复、CI 全绿)**从未合入 main、未真机回归**;v0.4.0 tag 落后 main 5 个提交(PR #31 源码不在 tag 里,同一版本号两份代码)。于是先复审「分支合入后仍开放」的问题,开 PR #32 合分支,再在 `fix/pre-release-2026-10` 上分阶段 0～3 修复并定版 0.5.0。
- **教训 · pnpm 坏版本**:`packageManager` 钉的 pnpm@11.12.0 被官方标为 broken release,本机 compile/test/build/zip 全失效。只改 pin 到 11.18.0、`--frozen-lockfile` 验证零改动;**不要重生成 lockfile**(本机 registry 是公司源,会写进 lockfile)。CI 注释不再钉具体小版本。
- **教训 · tag 漂移**:定版提交打 tag 后又合了源码改动却没 bump 版本——同一版本号对应两份代码,CHANGELOG 用例数也对不上。发版收尾(tag/版本/CHANGELOG)统一走 `/check` ship 模式。
- **教训 · 审查分支未合入**:修复做完但分支挂着没合,两个月后复审时得先逐条甄别哪些已在分支里修过。修复分支完成即开 PR 并跟进合并,HANDOFF「最后更新」要写清分支是否已合入 main。
- 修复要点与踩坑见 §5「v0.5.0」条目与 §8 新增条目(settle / 权限首个 await / 晚到 MEDIA 只精确追回 / 标题单一来源 / 本地图同名歧义);待办见 §0「还没做」与 backlog 文档。

**2026-07-25 · 第十七次会话 · 数学块 `$$` → X 原生 LaTeX**：
- **先真机 dump 定 entity shape,再动手**：X 的 LaTeX 块 entity 形状是本项目 M0 探针清单里一直没做的一项(DIVIDER/MARKDOWN/TWEET 都有源码/dump 实证,唯独 LATEX 没有)。开发前先写 Console dump 脚本(照 injector 的 fiber 定位路径)交用户真机跑,拿到确切 shape:`entityType="LATEX"` / `mutability=IMMUTABLE` / `data={}`(空) / **公式本体在块 `text`** / **每个字符都挂同一 LATEX entity key**。**教训延续**:entity 形状绝不臆造(捏错 X 直接不渲染),先 dump 实证再写。
- **LATEX 与前三种 atomic 的形状相反**:DIVIDER/MARKDOWN/TWEET 的数据在 entity `data`、块文本恒单空格(injector 硬编码);LATEX 反过来——`data` 空、公式在 `text`。故 protocol 给 LATEX 变体独有 `text` 字段;injector atomic 分支按 `entityType==='LATEX'` 分流:公式文本逐字符挂同一 entityKey(与既有 LINK entity 逐字符挂法同理),其余三种保持单空格。
- **parser 块级 `$$` 识别**(`matchMathOpen`):单行 `$$ x $$` 就地成块、多行 `$$\n…\n$$` 找裸 `$$` 闭合行、未闭合回退当文本(与未闭合围栏一致)、空公式回退。**假阳性主防线**:`$$100 涨到` 这类行内双美元其后非空 → 判 null 不进块判定、也不当段落边界(沿用本项目「`$$` 须行首」口径)。放在围栏之后(围栏内 `$$` 已被吃掉)、其余 atomic 之前。
- **能力面板诚实化**:「数学公式」从 warn「未接」改 **native「原生 LaTeX 块」**;新增「未闭合公式」warn 条目。计数从产出块取(LATEX atomic → native),文本残留的裸 `$$` 起行 → warn;`RE_MATH_RESIDUE` 收窄到**只认裸 `$$` 行**,替换旧 `/^\$\$/m` 的宽松匹配,消除 `$$100` 假阳性(沿用本项目「计数从 parseMarkdown 产出取,不另起正则」doctrine)。
- **自查 + 独立 review 各揪一条,均反证钉住**:① 自查发现单行分支 `line.slice(2,-2)` 未先 `trimEnd`,`$$ x $$ `(尾随空格)会切出 `x $$` 脏结果——修为先 trimEnd 再切,补回归测试(bug 版跑测试确实红);② review agent 揪出 multi 分支「起行 `$$` 后带内容」是**死代码**(`matchMathOpen` 对 `$$x` 判 null,永远进不来)且注释虚假宣称支持——复现确认后删死代码 + 订正注释。两条都自己复现/反证后才动手,不采信 agent 自述。
- **行内 `$…$` 不做**:X 的 LaTeX 是块级 Insert 项,无行内原生承载,如实告知降级(与行内代码/行内图片同策略)。
- 单测 293→307(块级 $$ 多行/单行/未闭合/空公式/围栏内/缩进/尾随空格/`$$100` 假阳性 + capability native/warn 拆分)。tsc/build 全绿。**已真机验证**:导入 `$$\nE = mc^2\n$$` 后 X 原生渲染出 LaTeX 公式块(带原生 Edit/Close 控件),LATEX atomic 直写路径成立。
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
