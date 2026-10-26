# 变更记录

本文件记录本项目的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.5.0] - 2026-10-22

> 上线前两轮审查的修复合集:2026-08 全面审查(2 P0 / 12 P1 / 31 P2,见 `docs/review/上线前全面审查-2026-08-18.md`)的五批修复,加 2026-10 发版前复审(见 `docs/review/发版前审查-2026-10-22.md`)的阶段 0～3 修复,以及打 tag 前对 PR #33 的复审修复(见 `docs/review/修复方案-2026-10-23.md`:本地图同名歧义、晚到图片不再猜归属、权限提示与 ask 重复弹窗、解析标题单一来源与性能、SSRF 补漏),以及 2026-10-26 全面审查第一批(见 `docs/review/修复方案-2026-10-26.md`:`$$` 公式不再吞正文、去标题按块不丢上下文、引用里的代码原样保留、草稿不被自己的保存回声回退、报告记实际解析开关)与第二批阶段 A(见 `docs/review/修复方案-2026-10-26-第二批.md`:未闭合围栏到文末按代码写入、HTML 注释不写入、frontmatter 引号转义、强调不截断链接、链接 title 不截断 URL)与阶段 B(新建文章页状态、拖放文字、重探不闪烁、本地封面入口、报告卡三态、记录上限即时生效、清除数据断开文件夹、文案本地化、隐私政策订正);另含 v0.4.0 tag 之后才合入 main 的 PR #31(存储加载路径校验)。主线是**写入安全**(钉死目标文章、等 React 提交、超时晚到图片追回)、**解析正确性**(CommonMark 边角三十余项)、**数据不丢**(写失败可见、多窗口同步、恢复安全化)与**上架合规**(权限最小化、manifest 国际化、隐私政策)。单测 307(v0.4.0 tag)→ **818**。
>
> 编号约定:`P0-x`/`P1-x`/`P2-x` 对应 2026-08 审查报告;`A`(解析)/`B`(注入)/`C`(工作区与 UI)/`D`(发版合规)编号对应 2026-10 发版前审查。同一问题 8 月修了一半、10 月补完的,下面合并为一条。

### 升级须知(用户可感知的变更)

- **权限集变化**:移除 `tabs`(此前会触发「读取您的浏览记录」安装警告);新增 `host_permissions: *://x.com/*、*://twitter.com/*`(与 content script 注入范围同域,不新增安装警告;用于注入编辑器桥接、读取当前标签页 URL 判断是否在 X);新增 `unlimitedStorage`(历史全文累积不再受 10MB 配额压顶,不弹额外提示)。远程图片域名仍是写入时按来源**逐个运行时申请**(`optional_host_permissions`)。
- **最低 Chrome 116**(`minimum_chrome_version`,`sidePanel.setPanelBehavior` 所需)。
- **商店名称 / 描述国际化**:manifest 改走 `__MSG_*__` + `default_locale: en`(新增 `public/_locales/{en,zh_CN}`)——英文 Chrome 显示「MarkFlow — Markdown to X Articles」,中文 Chrome 显示「MarkFlow — X 文章 Markdown 导入器」;描述统一为「本地优先,无遥测,不向开发者服务器发送任何数据」。
- **更新后需刷新已打开的 X 页面**:本版注入协议有变化(探针新增 `isArticleEditor` 等),旧页面里残留的旧脚本会被识别为「请刷新此 X 页面以启用插件」,刷新即恢复。
- **只在文章编辑页可写**:推文 compose 弹窗、私信等其他 Draft 输入框不再被误判为「已连接」。
- **备份格式 version 2**:历史记录 id 改 UUID,备份 `version` 随之升到 2;旧版(version 1)备份仍可恢复。
- **包体积 1.11MB → 约 640KB**:字体只打包 latin woff2 子集(字体文件 51 → 7)。
- 设置页底部版本号改读 manifest(此前硬编码 `v3.0`)。
- 单测 307(v0.4.0 tag)/ 370(main,PR #31 后)→ **818**。

### 新增

- **多窗口同步(P0-2 + C2)**:订阅 `chrome.storage.onChanged`(仅 local 区)。草稿/历史的外部变更采纳回灌,echo 以 mdRef / id 序列判定,本地有未落盘编辑或导入进行中不采纳(pending 闸门保数据),采纳时 toast 告知;设置与主题(Prefs/SettingsProvider)同样订阅,回声按「键排序后的 JSON」判定,`save` 移出 setState 更新函数。各 storage key 由所属 store 导出常量,监听方直接引用防漂移。
- **存储写失败可见化(P0-1)**:`setItem` 不再吞错;草稿/历史写失败按来源记账并在草稿页亮**常驻错误条**(附「导出当前草稿」自救按钮);手动「保存」await 成功才提示、失败如实报错;设置/偏好写失败落 console。
- **崩溃恢复屏自救出口(P1-9)**:新增「导出数据备份」(导出为可被「设置 → 恢复」直接吃下的 BackupData 形状 + 全量 raw dump);「重置」改为先自动导出、等下载发起再清,导出失败有内联反馈且需二次点击才强制重置。
- **「查看报告」入口(C4)**:Footer 常驻入口,`autoReport=never` 时也能打开上次导入的失败明细;「是否异常」判定纳入全部失败明细(此前只看计数)。
- **超时晚到图片追回(B2)**:某图上传超时后 X 晚到的 MEDIA 此前会被算到下一张、后续逐张错位。现在只按超时那刻记下的 `pendingKey`(pending 块 key)**精确**追回归位——循环中与循环结束后各扫一遍当前状态;无归属证据(超时时尚无 pending 块,或该块后来消失)的晚到块**不再猜**(曾有的末轮 FIFO 按顺序分给最早超时图,猜错即两图对调且全报成功,已删除),如实上报:仍多出的图片以 `orphan-media` 进失败明细(「存在无法归位的图片,请在编辑器中手动删除」);若存在不可追踪的超时图、其后有图成功归位、且孤儿数在扣除「仍可追踪(pendingKey 对应块还在)的超时图自身的块」后仍 > 0,另有一条 `media-order-uncertain`「此前有图片上传超时且其结果晚到,这张及之后的图片位置可能错位,请在 X 编辑器中核对」(不计入失败数)。诊断字段 `imageLateRecovered`/`orphanMedia` 仅 X 页面 console 可见。
- **本地图按文件名索引查找(C9)**:直读(解码 / 原串两遍,剥 `?query#hash`)失败后,按文件名 BFS 建一次索引(深度 ≤6、条目 ≤5000,跳隐藏目录与 `node_modules`,按 scope 缓存、每次导入重建);先全根直读再全根索引。Obsidian 短链接 `![[x.png]]`、md 在子目录时的 `./img/a.png` 不再全报 not-found。**同名歧义不静默挑图**:`./`、`../` 开头的路径多处同名即歧义(导入时拿不到 md 所在目录,如 Hugo bundle 各篇都有 `./cover.png`);单段文件名取路径最浅者(Obsidian 短链接语义),并列最浅也算歧义;解码遍优先(`a%20b.png` 按 `a b.png` 找,解码遍唯一即用、歧义即报歧义,不被原串遍的唯一命中覆盖,解码遍无候选才看原串遍)。歧义时降级为原文并报 `local-ambiguous`(「文件夹内有多张同名图片,无法确定是哪一张。请改用相对文件夹根目录的完整路径,或把本篇所在文件夹设为本篇图片文件夹」);按作用域顺序(素材板「本篇」先于设置默认)查,第一个有候选的文件夹决定结果(歧义、唯一候选读不到都不再落到下一个作用域,不会越过它去默认文件夹拿别的同名图);歧义与权限回落同样按作用域顺序归因——排在歧义作用域之前的作用域权限已回落(图可能唯一地在那里)时报「需重新授权」,否则报歧义。
- **失败原因码细分**:`article-switched`(导入中切了文章)、`not-article-editor`(非文章编辑页)、`remote-permission-denied`(图片域名授权被拒)、本地图 `no-folder` / `permission-lapsed` / `not-found` 三分(C30)、`orphan-media`、`media-order-uncertain`(晚到图片可能错位)、`local-ambiguous`(本地图同名歧义)、`bad-result`(injector 回传形状不合规),各有专属文案。
- **报告数据源钉死(P2-25)**:导入成功时冻结 `lastRunSnapshot`(md + parseOpts + 真实写入结果),报告卡明细与汇总统一读它——导入期间改稿、切设置、删历史都不再让报告漂移;HistoryItem 存 `parseOpts` 快照供日后历史回看。
- **文档**:隐私政策 `docs/privacy-policy.md`(中英双语)、第三方署名 `NOTICE.md`、审查与修复方案 `docs/review/*-2026-10-22.md`、`docs/review/修复方案-2026-10-23.md`、发版后待办 `docs/review/backlog-2026-10-22.md`;真机回归用例 `docs/qa/真机回归测试-审查修复五批.md`(15 组 + 2026-10 新增 T16～T22)。

### 修复 · 写入链路(注入)

- **权限被拒提示按实际未授权计数(B4)**:`permissions.request` 全有或全无,拒绝不影响此前已授权的域名。被拒(或抛错)后逐域名 `permissions.contains` 求出**确实未授权**的集合:toast「{n} 张远程图未获授权,可能无法下载」只计这些域名的远程图(按块计,含远程封面,与「图片 x/y」口径一致;文案不再说「将降级」——对方图床允许跨域时无权限也可能下载成功);失败改标为 `remote-permission-denied` 也仅限未授权域名,已授权域名的真网络故障、以及 4xx / 超时 / 非图片等明确原因保持原样。
- **权限申请剔除被拦主机(B5)**:内网 IP、`localhost`、单标签主机名不再进入申请弹窗与 toast 计数(后台必拒,申请了也用不上);origin 计算收敛为 `originPatternOf` 单一来源。
- **ask 模式拒绝权限后确认覆盖不再二次弹窗(B6)**:首次点击照旧发起申请(手势链第一个 await);覆盖确认弹窗里选「覆盖 / 追加」时跳过申请与 toast,只用 `permissions.contains`(只查不申请,无需手势)重算未授权域名供改标使用。取消覆盖弹窗不再收起上次的导入报告(报告卡收起时机挪到确定要写入之后)。
- **钉死写入目标:tabId + articleId 双钥 + 文章页闸门(P1-1、B3)**:`writeX` 两条路径(ask 与直写)都在进入任何挂起窗口(确认弹窗 / host 权限申请)之前探测并钉死目标;`import` 消息带 `expectedArticleId`,injector 在入口、主提交前、每张图前、清扫前、封面前**持续复查**,SPA 同 tab 切文章立即停手(`article-switched`)。另以 `location.pathname` 以 `/compose/articles` 开头作写入闸门(新建文章页 articleId 为 null 也能写,但推文/私信框会被拒为 `not-article-editor`),探针回传 `isArticleEditor`、`connected` 要求其为真,`articleSwitched` 同时纳入路由判断。批次四 code review 还抓回了一处批次二批量替换误还原的 `pinnedTabId` 钉死逻辑(`importToXTab`/`setTitleOnXTab`)。
- **图片阶段等待 React 提交(B1,P0)**:新增 `settle(stage, node, expect)` 谓词等待——`replaceMarkerWithText`/`relocateMediaToMarker`/`placeSelectionAtMarker`/首次 commit/`sweepMarkers` 每轮之后都等 X 真正提交再继续。此前连续「读-改-写」用的是陈旧 editorState:≥2 图且非末张失败时,失败图写回的原文会被下一轮回滚、marker 重现后被清扫整块删掉(内容丢失);append 首次 commit 只 `delay(150)` 无复核。超时只记账(`ImportResult.settleTimeouts`)不中断;content 每图通道预算 40s → 45s 为其留余量。
- **提交后失败可区分(P1-3)**:`ImportResult` 失败分支新增 `committed`;verify 不达标 / 图片阶段异常 / 通道 timeout 时正文可能已落地,UI 改用「正文可能已写入,请先检查再重试」文案族,阻止「按失败直觉重试」造成整篇重复。
- **marker 清扫保文本(P2-2)**:清扫只认完整 marker 形状并单事务**剥离**而非整块删除——用户在占位行内打的字、正文恰含 `__MARKFLOW_IMG_` 字面量的内容都不再被误删;残留审计始终执行,新增「残片」检测。
- **权限申请是手势链第一个 await**:直写与 ask 两条路径统一为先同步解析 blocks 并 `permissions.request`,再探针取 articleId(8 月批次二在直写路径的申请前加了探针 await,会吃掉 Chrome 的瞬时用户激活,新 profile 下权限弹窗可能弹不出来);探测失败同步刷新状态条。权限申请改按**块级**同源计算(P1-7,`<>` 包裹的远程图不再漏申请)。被拒时 toast「{n} 张远程图未获授权,可能无法下载」并将**来源 origin 确实未授权**的网络类失败标为 `remote-permission-denied`(C25 / B4,见上)。ask 确认路径不再申请(B6,见上)。
- **探针与消息健壮性(B5)**:`runProbe` / 监听器三分支 / `setTitle` 加 try/catch,异常回明确结果而非静默 timeout;injector 单例守卫(`Symbol.for` 标记,P2-5)防双注入并发直写同一 blockMap。
- **编辑器定位分级(P1-2)**:逗号并集选择器(实为 DOM 顺序)改有序层级逐级尝试(`data-testid="composer"` → `.public-DraftEditor-content` → `role=textbox` → 裸 contenteditable),级内取面积最大者。
- **标题**:`ask` 模式下编辑器已是同一标题时直接视为已设置,不再弹冲突窗(C33)。
- **封面失败计入失败数(C26)**(marker 残留除外)。
- **失败路径文件夹校准**:涉本地图的导入失败后同样就地校准素材板/设置的文件夹状态(此前只在成功分支校准,失败后 UI 仍显示「已连接」)。
- **dataURI 16MB 上限**:对齐远程/本地;超限报「超出大小上限」而非「无效」,percent-encoding 按解码后字节计(不误拒)。

### 修复 · 解析正确性

- **未闭合的代码围栏到文末都按代码写入(2026-10-26 第二批 P2)**:此前找不到闭合围栏时回退为普通文本,代码被当 Markdown 解析——代码里的 `# 注释` 成了标题(还被设成文章标题)、`*args` 的星号被吃掉、`- x` 成列表项。现在按 CommonMark,顶层未闭合围栏从开栏到文末整体成一个代码块(内容逐字保留、补齐闭栏),能力面板 warn「未闭合代码围栏 · 其后全部按代码写入」;开栏后一行内容都没有(文末孤立的 ```)时仍按文本,列表内缩进的未闭合围栏维持原行为。顺带消除「大量未闭合开栏行」的块级 O(n²)(审查 P10)。
- **HTML 注释块不写入(2026-10-26 第二批 P3)**:块首 `<!--` 到 `-->` 的整段注释(作者备注,GitHub / Obsidian / Typora 渲染时都不显示)此前逐行按 Markdown 解析,注释里的 `# TODO` 被设成文章标题、`- 说明` 成列表项、`<!--` 字面量写进 X。现在整段不写入(`-->` 之后同一行的正文照常写入),能力面板 special「HTML 注释 · 作者备注 · 不写入 X」;找不到 `-->` 时**不**按 CommonMark 吞到文末(注释不写入,吞到文末等于整篇后文丢失),回退为文本并 warn「HTML 注释未闭合」。段落中间的行内注释维持原样。
- **frontmatter 引号值解码转义(2026-10-26 第二批 P7)**:单引号值 `''` → `'`,双引号值解码 `\"` `\\` `\uXXXX` 等(未知转义保留,解码出的控制字符换成空格);此前 `title: 'It''s fine'` 写进标题成 `It''s fine`。`cover:` 同步。
- **强调不再截断链接(2026-10-26 第二批 P8)**:找闭合强调符时整体跳过完整链接(CommonMark:链接优先于强调)——此前 `**注意 [链接](https://a.com/a**b) 结束**` 的闭符被 URL 里的 `**` 截走、链接丢失,`_参见 [文档](…/my_doc)_` 斜体丢失。链接匹配按起点缓存,病态输入不比改前更慢。
- **链接 title 里的 `)` 不再截断 URL(2026-10-26 第二批 P9)**:`[a](https://a.com "title with ) paren")` 此前把 ` paren")` 漏进正文;现在空白后的 `"…"` / `'…'` 按 title 跳过。
- **`$$` 公式不再吞掉正文(2026-10-26 P1)**:多行公式的闭合搜索遇空行即止(LaTeX 数学模式不允许空行),裸 `$$` 不再跨空行、跨段落与下一段公式的起行配对——此前 `$$ a+b\n$$\n\n正文\n\n$$\nc\n$$` 会把「正文」整段写成一个渲染失败的公式块,能力面板还报「原生」。另认 Obsidian / MathJax 常见的带内容写法:裸起行 + `E=mc^2 $$` 闭合行、`$$ a+b` 起行 + 裸闭合;带内容的起行只在段落续行内找闭合(遇列表 / 引用 / 标题 / setext 下划线即止),「带内容起行 + 带内容闭合行」不放行(保住 `$$100 涨到…200$$` 口语双美元防线)。残留:独占一行的 `$$100 涨` 紧跟一行裸 `$$` 会被当成公式。
- **去标题按块进行,不丢相邻内容(2026-10-26 P4)**:`h1Handle=remove` 此前在 md 文本层删标题源行再重解析,相邻行重新拼接——`# 标题\n---\n作者\n---` 删后首行 `---` 被当成 frontmatter、分割线与作者行一起丢失;`导语\n# 标题\n正文` 两段合并;标题后的正文被吸进前面的列表项。现在一次解析(`parseMarkdownWithHeadings`,标题上报带块下标),只去掉被抽为文章标题的那个块(`parseMarkdownWithoutTitle`),其余块与全文解析逐一相同;`stripFirstH1` 删除。标题判定规则不变(`pickTitleHeading`,与 `extractTitle` 共用)。
- **引用里的代码原样保留(2026-10-26 P5)**:引用块此前逐行做行内解析,`> def f(*args, **kwargs): return a*b*c` 写进 X 成了 `def f(args, **kwargs): return ab*c` 并带斜体。现在引用内的围栏(``` / `~~~`)产出 MARKDOWN 代码块,内容逐字保留;引用先于闭栏结束时按 CommonMark 在引用末行闭合。X 的代码块不能嵌进引用,代码块会单独成块、不在引用竖线内。嵌套引用 `>>`、`> [!NOTE]` 不在本次范围。
- **标题抽取与正文解析同一来源(P3 + P7)**:标题抽取(`extractTitle` / `stripFirstH1` / 历史标题 `firstTitle`)不再自带 setext 判定,改取解析主循环上报的标题(`forEachContentLine` 的 `onHeading`),消除「正文认标题、抽取不认」或相反的分裂。同时订正 CommonMark §4.3:setext 下划线(`===`)不能作为列表项的 lazy 续行——`- item\n标题\n===` 是列表项,不再产出标题。标题抽取另外跳过「未闭合围栏开栏行 / 未闭合 `$$` 起行后跟 `===`」形成的 setext 标题(正文解析不变):这类写法不会被设为文章标题,抽取会继续找下一个一级标题。顺带修复:`$$\n# 不是标题\n$$` 里的 `#` 行被抽成标题、`stripFirstH1` 删坏公式。`extractTitle` / `stripFirstH1` / `firstTitle` 新增解析开关参数并由导入流程透传,抽取结果只取决于调用方自己的开关(`obsidianImg` / `wikilink` / `taskList`),不再继承上一次解析残留的模块级开关。
- **列表续行里的 `2024. 冬天`(P5)**:缩进到当前列表项内容列之上的非 `1.` 有序行不能打断段落,作为续行吸收(`- 去年\n  2024. 冬天很冷` 为单项);仍缩进不足或为 `1.` / 无序标记时按列表项处理,未缩进的 `- 去年\n2024. 冬天很冷` 保持原状。
- **frontmatter `cover` 整行判定(P6)**:复用正文的「整行恰为一张图」判定(含带链接图与 `![[a.png]]` / `[[a.png]]`,`|` 之后的 alt / 尺寸剥掉);同行两张图 `![a](x.png) ![b](y.png)`、`![[a.png]] ![[b.png]]` 与畸形写法不再被贪婪正则吞成一个错乱的路径,判为无封面;纯路径写法不变。
- **性能(P1 + P2)**:行内强调符 `findClosing` 改为按起点记忆化(取代 `noCloseFrom` 缓存),同字符定界符长串整串处理——跨行内代码的病态段落(原约 1.4s)、`'a' + '~'.repeat(50000)`、`'*'.repeat(20000) + 'a'` 等输入降到线性(< 50ms);与旧实现差分模糊对比零差异。
- **同行多张带链接图片(A1,P0)**:贪婪正则 `RE_LINKED_IMAGE_LINE` 改为与 `matchImageLine` 共用 `scanParenClose` 的括号配对扫描器——`[![a](1.jpg)](l1) [![b](2.jpg)](l2)` 不再被吞成一张(source 错乱),`[![a](i)](l) ![b](y)` 第二张不再静默丢失;多图同行 / 尾随文字交段落处理。
- **图片 title 剥离(P1-4 + A6)**:`![](url "标题")`(Typora/Pandoc 默认输出)不再把 title 吞进 src 导致上传必败;只剥 `"…"`/`'…'`,统一在 `normalizeImageSrc`,frontmatter `cover:` 也复用它。
- **推文链接(P1-5)**:X「复制链接」的 `?s=20` 带参形态、`mobile.` 子域、行尾空格均识别为推文嵌入;尾缀只认可打印 ASCII,URL 直接接中文正文时整行回落文本、正文不丢。
- **标题抽取(P1-6 + P2-14 + A7)**:跳过 frontmatter(YAML `# 注释` 不再被当标题或被 `h1Handle=remove` 误删);`firstTitle`(历史标题)复用 `extractTitle`;新增导出 `inlinePlainText`/`stripAtxClosing`,`# **粗** 标题` 抽出「粗 标题」、`# 标题 ##` 抽出「标题」。
- **强调符 flanking(A2)**:`canOpen`/`canClose` 看整段同字符连续串两侧——`2 * 3 * 4`、`a _ b _ c`、`x ~~ y ~~ z` 不再被吞成斜体/删除线;`***` 无闭合时按 CommonMark 拆 `*`+`**`;`findClosing` 跳过 `\`+ASCII 标点转义(A12,`*a\*b*` 不再错切);`_` 词内规避改 `\p{L}\p{N}`(A13,`报告_终版_修订` 中的下划线不再被吞)。`findClosing` 加未闭合缓存,病态输入 3.4s → 3.6ms,20 万条随机输入与旧实现差分零差异(后由 P1 / P2 的记忆化取代并覆盖更多病态形态,见上)。
- **列表(A3、A4、P2-13)**:lazy / 缩进续行并入当前列表项(此前成为独立段落);列表语境内允许「内容列 + 3」缩进的开/闭栏,围栏内容按开栏缩进剥离;软折行段落中的 `2024. ` 不再被硬切成列表(仅 `1.` 可打断段落)。
- **CommonMark 缩进块(P2-8)**:标题/引用/围栏接受 0-3 空格缩进;段落前导空白逐行剥(≤3 列);闭栏行尾随全角空格 U+3000 仍闭合。围栏判定收敛为单一来源——主循环抽成 `parseLines(onFence)`,`forEachContentLine` 直接复用其围栏区间,预览与 `frontmatter.ts` 的 frontmatter 判定也委托 parser(P2-9),三套平行实现收敛为一。
- **分割线变体(P2-7)**:`- - -`/`* * *`/`___`(含 Tab 分隔、尾随空白)识别为分割线,不再产出垃圾列表项;段落 + `---` = setext 的规则不变。
- **数学块(A14)**:单行 `$$…$$` 要求中间不含 `$$`,同行两段公式回落为段落。
- **能力面板(A15、P2-10)**:parser 记录 H4+ 降级块(`isDemotedHeading`,不进协议),整段加粗不再被误报为「降级标题」并计入历史降级数;预览顶部注明「以能力面板为准」。
- **frontmatter 值(P2-11、P2-12)**:`title: >`/`|` block scalar 回落 H1;行内 ` # 注释` 按 YAML 规则剥离(引号值不剥,转义引号不截断);`cover: "![[x.png|封面]]"` 剥 `|alt`。

### 修复 · 存储与数据

- **「记录保留上限」改小后立即生效(2026-10-26 第二批 W8)**:此前只在下一次导入时裁剪;现在上限变化(含备份恢复后 reload 带回超限历史)时立即裁掉最旧记录,与设置说明一致。
- **「清除所有数据」同时断开本地图片文件夹(2026-10-26 第二批 W9)**:文件夹授权存在 x.com 的 IndexedDB,此前清除后再进设置页又显示「已连接」。现在删完本地数据后尽力清除两级文件夹授权;当前标签不是 X 页时清不到,如实提示「需在打开 X 页面时清除,或到素材板 / 设置里手动断开」;设置项说明同步。

- **草稿不再被自己的保存回声回退(2026-10-26 W2)**:草稿保存时先清 pending 再写入,前一次较慢写入(如含大 dataURI 的长稿)的存储回声若晚于下一次保存才到,会被当成另一窗口的编辑采纳——编辑框回退、toast 误报「草稿已从另一窗口同步」,其后键入的内容丢失。新增自写回声队列(`lib/storage/echoQueue`,与设置 / 主题同步的回声判定同一思路):本实例发起的写入先登记,回声(含迟到的旧回声)按队列吞掉;写入失败即移除登记;与已落盘值相同的写入不登记。采纳判定抽成纯函数 `decideDraftChange`(`lib/workspace/draftSync`),既有闸门(本地有未落盘编辑 / 导入中不采纳、不看焦点)不变。
- **报告与历史记下本次实际用的解析开关(2026-10-26 W1)**:导入收尾此前读组件闭包里的 `obsidianImg / wikilink / taskList`,而回调依赖漏了这三项——切开关后不改稿直接写入,报告明细、降级数、历史标题与 `parseOpts` 都按旧开关计算并永久存进历史。现在由写入流程把本次解析用的 md 与开关显式传给收尾,计算抽成纯函数 `buildRunRecord`(`lib/workspace/runRecord`,口径不变)。
- **导入中改稿后不再弹旧稿报告(2026-10-26 W10)**:标题询问弹窗等挂起期间改了草稿 / 载入了别的内容时,收尾不再把旧稿的报告卡与快照置回(与「草稿一变就收起报告」的约定一致);本次结果照常写进历史。

- **加载路径逐字段校验(PR #31,v0.4.0 tag 之后合入 main)**:四个 loader 此前 `{...默认, ...存储}` 裸信任,一个坏 `skin` 字段就会抛错、把用户推到「清空全部本地数据」的恢复卡片。校验器下沉到 `lib/storage/schema.ts` 并接入全部 loader:坏字段静默回落默认、坏历史项只丢该项,草稿与历史保全。+63 用例(307 → 370)。
- **草稿写入防抖(P2-21)**:每键整串写 storage 改为 250ms trailing + 2s max-wait;blur / visibilitychange(hidden) / pagehide / 手动保存强制 flush。
- **历史 id 改 UUID**:双窗口同毫秒导入不再撞 id;校验器兼容旧时间戳 id。
- **备份导入校验与恢复安全化(P2-15、P2-16)**:断言 `kind==='backup'`(诊断快照不再被当备份「恢复成功」),version 2 原生 / 1 兼容 / 其他拒收;恢复前二次确认 + 自动先导出当前数据(导出失败即中止),写回顺序执行、失败即停、如实报告已恢复切片。
- **「清除所有数据」对齐文案(P2-19)**:真清 4 个 storage key 后 reload;失败如实报错;清除前掐断草稿防抖管线(防 pagehide flush 把刚删的草稿写回);其他窗口同步清空。
- **导出真实结果(P2-17)**:新增统一下载通道 `lib/ui/download`(失败必抛),备份/诊断导出失败不再谎报成功;历史「复制」按 clipboard 真实结果提示(非安全上下文先判存在)。
- **IndexedDB 加固(P2-18)**:`idbRun` 事务创建同步抛错转 reject、补 onabort/onerror 且所有路径关库,写事务以 `tx.oncomplete` 为可信成功时机(防 Quota abort 被吞成「已连接」);文件夹请求超时分型(状态/清除 10s,连接不设)。
- **`autoReport=anomaly` 生效(P1-10)**:「仅异常时」如实只在有降级/失败时展开报告(此前与 always 等价)。

### 修复 · 界面

- **新建文章页不再显示「未在文章编辑页」(2026-10-26 第二批 W3)**:状态条与预检卡此前以 `articleId !== null` 判定是否在文章页,新建页还没有 id,于是显示「未在文章编辑页」/ 预检 ✕,而写入按钮却可用。改按路由(`isArticleEditor`)判定,新建页显示「新文章(尚未保存)」。
- **编辑框可以拖放文字(2026-10-26 第二批 W4)**:只在拖入文件时拦截默认行为、显示「拖入文件」遮罩;从网页拖文字进来、框内拖动选中文字恢复原生行为。
- **重探不再闪「未检测到 X 文章编辑页」(2026-10-26 第二批 W5)**:重探期间保留上一次结论(只让刷新按钮转圈),写入后、切标签时横幅不再闪现、写入按钮不再禁用一拍;标签事件只认本侧边栏所在窗口,另一个窗口切标签不再触发本窗口重探。写入前仍即时重探并钉死目标(不受影响)。
- **本地封面也显示「本篇图片文件夹」入口(2026-10-26 第二批 W6)**:`cover: ./c.png` 而正文没有本地图时,素材板此前不显示文件夹行,导入才报「未连接文件夹」。素材板与写入流程改用同一份判定(`pickCoverSource` / `usesLocalImage`)。
- **报告卡标题栏按结果着色(2026-10-26 第二批 W7)**:有失败 → 危险色 ✕,仅降级或有提示 → 警示色 !,否则成功 ✓(此前绿色对勾写死,全部失败也显示成功);与底栏「查看报告」入口同一判定。
- **授权浮层跟随界面语言(2026-10-26 第二批 I1)**:X 页面上「连接本地图片文件夹」浮层此前硬编码中文;连接请求带上界面语言,英文界面显示英文浮层(旧侧边栏不带语言时仍为中文)。
- **文案本地化(2026-10-26 第二批 W11 / I3)**:成功提示里的「图片 / 封面」进字典;两个窗口同时写同一页(「X 页面上已有一次写入在进行」)、找不到可写入的编辑器(「请刷新 X 页面后重试」)给出专属文案,不再显示英文原文。

- **键盘焦点可见(P1-12)**:`:focus-visible` 焦点环替代一刀切 `outline:none`。
- **对比度(P2-29)**:`--ink3` 在四套主题提到 ≥3:1(极简浅 2.16→3.80、极简暗 3.06→3.49、控制台 2.57→3.64、纸感 2.97→3.49、玻璃浅约 2.5→3.6、玻璃暗约 2.6→4.3),层级仍低于 `--ink2`。
- **玻璃主题不透明面板 `--pSolid`(P2-30)**:三个确认弹窗背景、Toast/Header logo 前景改用不透明色,不再透底糊字。
- **Toast 分型(P2-27)**:success / error 两型(✕ 图标 + 危险色),时长按文案长度 2.2s～6s 浮动,容器 `role="status" aria-live="polite"`。
- **预览态禁用工具栏(P2-23)**、**拖拽遮罩不再卡住 / 不闪烁(P2-24)**、**历史单条删除二次确认(P2-26,专属文案「确认删除?」与 aria-label 同步)**、**AudioContext 用后释放(P2-22,含 suspended 态守卫,连续导入不哑音)**、**compress 关闭时长边/质量控件联动置灰**。
- **ask 断开有反馈(P2-20)**:覆盖询问前的即时探测发现断开时 toast 提示。
- **文案进字典(P2-31)**:表格模板(英文界面不再插入中文列名)、主题切换 aria-label。
- **设置文案订正(C36)**:去掉不存在的「文件名」标题回退与「一键写入」快捷键描述。

### 变更

- **隐私政策措辞订正(2026-10-26 第二批 D1)**:远程图片站点权限是写入时**一个**提示统一列出本篇所有图片站点(此前写成「逐个申请」);本地文件夹按文件名查找图片时会读取目录结构(文件名),不读取其他文件内容(此前写成「只读取引用到的图片」)。中英两版同步。

- **探针重探不依赖 URL**:去掉 `tabs` 权限后非 X 页面的 `changeInfo.url` 不可见,改为活动标签 `status==='complete'` 即重探(X→非 X 导航也会断开);`isXUrl` 收窄到根域,`help.x.com` 等子域不再误报「需刷新」;旧 injector 不回 `isArticleEditor` 时探针归为「需刷新」。
- **background 发送方校验**改用 `sender.origin` / `sender.url` 并收紧到根域。
- **`importArticle` 超时错误**:`class TimeoutError` 改为 `createTimeoutError`/`isTimeoutError` 工厂(项目不用 class)。
- **字体**:改手写 `@font-face`,只引 latin woff2(Space Grotesk / JetBrains Mono 字形不变,CJK 仍走系统字体栈)。
- **工具链**:`packageManager` 升到 `pnpm@11.18.0`(11.12.0 被 pnpm 官方标为坏版本,本机 compile/test/build/zip 全部无法运行);lockfile 未变。

### 安全

- **SSRF 黑名单再补漏(F6,只加不减)**:剥全部尾点(`localhost..` 此前仍留一个尾点绕过);IPv6 补 `fe80::/10` 全段(此前只覆盖 `fe80:` 一个 /16)、`fec0::/10`、`ff00::/8` 组播;主机名后缀补 `.localdomain`、`.lan`;IPv4 补 `198.18.0.0/15`(仅对点分 IPv4 字面量生效)。
- **SSRF 黑名单补漏(B10)**:`isBlockedHost` 抽到 `lib/bridge/blockedHost.ts`,补无点主机名、`0.0.0.0/8`、`100.64.0.0/10`、≥224 组播/保留段、`.home.arpa`、`64:ff9b::/96` 与 `::` 开头的 IPv6;29 条拦截 / 9 条放行用例。
- **injector 回传校验(B9)**:x.com 页面脚本可伪造 `postMessage`,content 对 injector 回传经 `resultGuards` 白名单校验与截断;不合规回 `bad-result`(若形状为 ok:true 则带 `committed:true` 走「先检查再重试」提示)。
- **权限最小化**:见「升级须知」——去 `tabs`,host 权限仅限 x.com / twitter.com。
- **生产构建不再输出调试日志**:content / injector 的 `console.info` 仅 DEV 保留。

### 移除

- `tabs` 权限。
- 「演示环境」占位(P1-11):素材卡封面「更换」死按钮、`demoToast` 词条。
- 死代码:`checkStep`/`stageIdx` 及预检逐步动画定时器链、`capability.images()` 全文正则(连同测试)、dict 死词条 `deskHint`/`pbPage`。
- `insert()` 无编辑器时「拼到全文末尾」的危险兜底(改 no-op)。

## [0.4.0] - 2026-07-25

> **tag 与 main 的差异**:`v0.4.0` tag 指向 `8127563`(PR #29 合并提交);其后 PR #30(多行公式 QA 文档)与 PR #31(存储加载路径逐字段校验,单测 307 → 370)合入了 main,但未单独发版——PR #31 的加载校验已并入 [0.5.0]。下文单测数以 tag 为准,main 上同版本号的代码为 370 例。

### 新增 · 数学块 `$$…$$` → X 原生 LaTeX 块
此前 `$$` 公式**无任何解析**,整段当普通段落写入、`$$` 字面量进正文,能力面板标 warn「未接」。经**真机 dump 确认** X 有原生 LATEX atomic 块,现接通:

- **解析**:块级 `$$…$$` → `AtomicBlock` 新变体 `{ entityType:'LATEX', data:{}, text: 公式 }`。支持多行(`$$\n…\n$$`)与同行闭合(`$$ x $$`);放在围栏识别之后、其余 atomic 之前(围栏内的 `$$` 已被保护、不解析)。
- **起行判定收严**(`matchMathOpen`):仅**顶格 `$$`** 触发,其后仅空白 → 多行、同行闭合且中间非空 → 单行、其余(含 `$$100 涨到` 这类口语双美元)判 null。这是**假阳性主防线**——`$$100` 既不进块判定也不当段落边界,与本项目「`$$` 须行首、`includes` 会误报」的一贯口径一致。找不到闭合 / 空公式 → **回退当普通文本**(与未闭合围栏一致)。
- **injector 直写**(真机 dump 确认的形状差异):LATEX 与 DIVIDER/MARKDOWN/TWEET **相反**——公式本体在块 `text`(前三种恒为单空格)、`data` 为空,且**每个字符都挂同一 LATEX entity key**(与 LINK entity 逐字符挂法同理)。空公式兜底退单空格(parser 已挡、这里双保险防空块崩)。
- **能力面板诚实化**:「数学公式」从 warn「未接·保留原文」改 **native「原生 LaTeX 块」**,计数从产出的 LATEX atomic 块取;文本里残留的裸 `$$` 起行(未闭合公式开头)另计一条 warn「未闭合公式」。收窄残留正则到裸 `$$` 行(`/^\$\$[ \t]*$/m`),消除旧 `/^\$\$/m` 对 `$$100` 的假阳性。
- **不做**:行内 `$…$`(X 的 LaTeX 是块级 Insert 项,无行内原生承载,同行内代码/行内图片策略,暂不支持)。
- 单测 293→307(tag 时;PR #31 合入 main 后为 370)(+14:多行/同行/未闭合回退/空公式/`$$100` 假阳性/围栏内不误判/尾随空格切偏 bug 回归等,全部经「回退代码→测试变红」反证)。tsc/build 全绿。**已真机验证通过**:导入 `$$\nE = mc^2\n$$` 后 X 原生渲染出 LaTeX 公式块(带原生 Edit/Close 控件)。

## [0.3.0] - 2026-07-25

> 新增嵌套列表 / 任务列表 / setext 标题三类 Markdown 语法，能力面板补齐 7 类此前静默/误标的语法告知，修 Toast 长文案溢出侧边栏，新增 Vitest 单测体系(225→293)+ CI。全部经真机验证通过。

### 新增 · 列表语义补齐(嵌套 + 任务列表)
此前 parser 的列表只认**顶格单层**,两类日常高频写法会**内容错乱**(不是降级):

- **嵌套列表**:`  - 二级` 不匹配顶格列表正则 → 掉进段落分支,正文里留下字面量 `  - 二级`。现按前导缩进算 `depth` 写入 Draft 原生的 `ContentBlock.depth`(`TextBlock.depth`,上限 4 —— Draft 默认样式表只到 `depth4`)。
  - 缩进→层级用**栈式**换算而非「缩进 ÷ 固定单位」:后者必须假定每级固定 2 或 4 空格,遇到另一种或混用 Tab 就整体算错;栈式只看相对深浅,故 2 空格 / 4 空格 / Tab / 混合缩进都正确,有序无序共用一个栈(`- 一级` + `1. 二级` 层级正确)。
  - `depth` 是**可选字段且仅 > 0 时写入**:顶层项产出形状与本特性引入前逐字节一致;旧版 injector(用户未刷新 X 页面)读不到它只会退化成扁平列表,仍优于此前的字面量段落。
- **任务列表**:`- [ ] / - [x]` 此前留字面量 `[ ]` 在正文里。现接通早已存在却被置灰的 `taskList` 设置——`symbol`(默认)转 ☐/☑ 符号、`plain` 剥掉标记;`TextBlock.task` 记勾选态供能力面板计数。加符号前缀时**整体平移** `inlineStyleRanges`/`links` 的 offset,否则 `- [ ] **粗体**` 的加粗区间会砸到前缀上。
- 设置页「任务列表」项**取消置灰**,文案从「（规划中）」改为如实描述。

### 修复 · 能力面板的静默降级与错误标绿(兑现「不会导入完才发现丢了」)
盘点发现能力面板对一批常见语法**只字不提**，任务列表更是被标绿成「原生列表」而正文实际留着 `[ ]` 字面量——面板在撒谎，与 README 的核心承诺相悖。补 7 类如实告知：

- **多级列表**（`warn`）：**真机确认 X 忽略 Draft `depth`**，嵌套列表渲染为扁平（有序列表还会连续重编号），层级确实丢失，故如实标降级、文案为「X 不支持列表层级 · 已扁平化(内容不丢)」。（此前暂标 `special` 是因尚未验证——不该在不知情时断言「已降级」；知情后就该如实说。）`depth` 仍照写：语义正确、零成本，X 日后支持即生效。
- **任务列表 / 行内图片 / 脚注 / HTML 块 / 数学公式 / setext 标题**（均 `warn`）：如实说明会变成什么。
- 计数**严格从 `parseMarkdown` 的产出块**取（沿用本文件既有 doctrine，不另起一套正则）：独占一行的图片已是 `ImageBlock`，天然不会与「行内图片」重复计数；围栏代码块内的 `![]()`/`$$`/`<div>` 是 atomic 块，不会误计。仅 setext 标题因解析后语义已丢失而必须扫原文，用围栏感知的 `forEachContentLine` 保持判定同源。
- **顺带修一个既存隐患**：`capability()` 此前调 `parseMarkdown(md)` **不带任何开关**，用户关掉 `obsidianImg`/`wikilink` 后面板按「默认开」统计、与实际写入不一致（又一次 UI 撒谎）。现加 `parseOpts` 第三参并从 3 个调用方透传真实设置。

### 新增 · setext 标题(`标题\n===` / `标题\n---`)
CommonMark 标准语法，此前**完全不识别**：整段退化成普通段落，`===` 字面量进正文；下划线是 `---` 时还会额外产出一条分割线，标题语义彻底丢失。

- 解析：段落收集完毕后若下一行是下划线，整段升格为 `header-one`（与 ATX 的 `#`/`##` 同归——X 只有两级标题）。放在段落收集**之后**判定，天然支持多行 setext 正文，也天然让紧邻段落的 `---` 优先当下划线而非分割线（与 CommonMark 同序）。**空行隔开的 `---` 仍是分割线**，列表/ATX 标题/引用下方的 `---` 也仍是分割线（setext 正文必须是段落行）。下划线要求**顶格**，与既有 `RE_DIVIDER` 同样严格。
- 标题抽取：`extractTitle` 现在也认 setext **一级**标题（`===`；`---` 是二级，与 `## ` 一样不作文章标题）。`findFirstH1` 随之回传 `lineCount`，`stripFirstH1` 按行数删——setext 占两行，只删一行会把 `===` 孤零零留在正文。判定复用 parser 导出的 `setextUnderlineLevel`/`isParagraphLine`，不另写一套。
- 保守边界：多行段落上方的 setext **不作标题**（整段才是标题、取末行会截断，按固定行数删会留孤儿行；这类写法极罕见，宁可不认也不误伤）。
- 能力面板的「setext 标题未识别」告警条目随之**移除**——面板不该再报一个已经支持的语法。

**历史行为翻转**：`a | b` 紧跟 `---` 此前产出「段落 + DIVIDER」，现为标题（2 单元格表头 vs 1 单元格分隔行本就不构成 GFM 表格，CommonMark 判定为 setext）。相关断言已同步翻转并注明。

### 修复 · 上批 code review 揪出的 3 条(均已复现 + 回归测试钉住)
- **frontmatter 闭合 `---` 被误计为 setext 标题**（最要命）：`countSetextHeadings` 直接扫原始 md，而 `forEachContentLine` 只跳围栏、**不跳 frontmatter**，于是「frontmatter 体末行 + 闭合 `---`」被当成「文字 + 下划线」。frontmatter 是本项目的招牌用法（title/cover 都靠它），**任何带 frontmatter 的文档**都会凭空多一条「setext 标题未识别」假告警并污染「降级」求和。修法是把 frontmatter 判定抽成 `frontmatterBodyStart()` 导出、与 `parseMarkdown` 共用同一口径——避免「第二套实现」漂移（本项目历史上栽过同样的跟头）。
- **放开缩进匹配的副作用**：`RE_UL`/`RE_OL` 允许前导缩进后，`isBlockBoundary` 复用同一正则，导致正文里粘贴的 **4 空格缩进代码/日志**中的 `- x` 被硬拆成列表项、丢掉原始缩进语境。按 CommonMark 加门槛（`canBeListItem`）：**已在列表 run 中**时任意缩进都算嵌套项；**不在列表中**时仅允许 ≤3 列（≥4 列属缩进代码块领域）。2 空格打断段落起列表的行为保留——那与 CommonMark 一致。
- **`$$` 行中假阳性**：`text.includes('$$')` 会把「价格从 $$100 涨到 $$200」当数学块，改为要求 `$$` 位于**行首**（块级公式的文本恒以 `$$` 起行，不受影响）。

### 修复 · Toast 长文案溢出侧边栏
成功提示最多可拼 5 段(空替换 + 图片 N/M + 封面 + 标题 + 文件夹断开),而 Toast 是 `whiteSpace:nowrap` 且无宽度上限;它 `position:absolute` 而 `#root` 为 `position:static`,包含块是视口而非面板,故长文案会向两侧溢出侧边栏被切掉。改为限宽换行(`maxWidth: calc(100vw - 32px)` + `overflowWrap:anywhere`,兼顾中文与长 URL/文件名),图标加 `flexShrink:0` 防换行时被压扁。`borderRadius` 99→18:单行高约 35px、半高 17.7px < 18,浏览器按半高钳制后**渲染与原胶囊逐字节相同**(短文案截图比对验证零回归),多行时不再侵入首尾行文字。

### 新增 · 单测体系 + CI(225 用例)
- **Vitest 单测覆盖纯函数层**:parser(85,块级/行内 offset/代理对/对抗输入/全部历史修复回归)、frontmatter+capability(55,fence 统一/计数回归)、backup validate(36,坏备份砖化 P0 防线:非法枚举回落/代理对截断/`__proto__` 不污染)、localVault `splitLocalPath`(20,路径逃逸/编码绕过)、protocol 纯函数+守卫(28)。`pnpm test` 150ms 跑完。
- **CI workflow**(`.github/workflows/ci.yml`):push/PR 跑 tsc + 单测 + Chrome 构建(Node 22,pnpm 版本从 packageManager 读取)。
- **明确不在单测范围**:injector/content(依赖页面 Draft.js fiber,无诚实单测缝隙,硬 mock 是空心绿灯)——回归靠 docs/qa/ 真机用例,已在 vitest.config 注释与 CI 注释声明。
- **修复 · 测试钉出的 2 个生产小 bug**:`classifyImageSource` 对大写 `DATA:` 前缀误判 local(scheme 本不分大小写,改 `/^data:/i` 与 http 判定对齐);`firstTitle()` 不跳围栏代码块、代码块内 `# fake` 被当历史条目标题(与 `extractTitle` 分裂,审计 P2-15)——改用 `forEachContentLine` 与 frontmatter 同源跳栏。两处测试断言同步翻转为正确行为(历史 bug 回归用例)。
- backup.ts 的 4 个 validate 函数导出供单测(行为零变化)。

## [0.2.2] - 2026-07-16

### 新增 · 导入报告失败明细(批次三,QA T6 引出)
失败不再只有汇总数:每张失败图给出**序号 / 来源 / 阶段 / 原因**,报告卡展示、随历史记录持久化、console 同步打印。

- **数据链路**:`prepareOneImage` 各失败分支带原因码(远程被拒透传 background 错误 / 本地未找到 / 超限 / 类型不符 / dataURI 无效);`uploadOneImage` 返回 `{ok, reason, detail}`——8 条互异失败路径(编辑器丢失 / 占位标记丢失 / 无上传通道 / 真超时 / **已上传但归位失败** / 异常)各有其码,不再被统一猜成「超时」;封面失败由 content 在通道层补记(`index=-1` 哨兵),prepare 与 set 失败均可见。
- **单一事实来源**:原因码收敛为 `protocol.ts` 的 `IMAGE_FAIL_REASONS` as const 联合类型——生产端强类型(拼错即编译报错),消费端保持 string(兼容备份恢复的任意字符串,UI 对未知码原样展示)。
- **展示与存储**:ReportCard 失败明细区块(「图 N / 封面 · 阶段 · 原因 · 来源」);`HistoryItem.imageFailures` 持久化;备份白名单逐项校验(index 须为 ≥ -1 整数,source/detail 恢复边界重截断)。
- **序号忠实**:`coverKeep='remove'` 抽走首图当封面后,引擎回传序号 +1 还原为用户文档顺序,报告不指错图;`source/detail` 经代理对安全的 `truncateForReport` 截断(source 80 / detail 200),防超长错误文本撑爆 storage;扩展更新后旧脚本场景有专属码 `prepare-missing`(提示刷新页面)。

### 修复 · marker 清扫「假干净」+ 残留静默(QA 批次三真机暴露)
- **清扫可靠性**:`sweepMarkers` 旧逻辑「某一轮没读到残留就收工」——X 的 onChange 异步 commit 下,一次陈旧的"干净"读取即终止清扫,fallbackIndex 路径的 marker 可躲过全部 4 轮、静默残留正文(真机实测写入后约 24s 仍有 4 个 marker 未 commit)。改为**连续两轮读到干净才收工**(上限 6 轮),读不到状态节点不再当"干净"。
- **报告盲区**:清扫仍未确认干净时,封面阶段后做残留审计——本次 run 的 marker 按尾部序号映射回「第几张图」,以 `marker-residue` 计入失败明细(只进明细、不计 imageFail:图已落地,残留是需手动删除的占位文本);历史前缀残留 console 告警。残留从「完全静默」变为「必然可见」。
- 真机回归:T6 大文档 replace/append 各 ×3 全零残留;偶发上传超时被如实报为「图 2 · 上传超时」(本功能目标的实战验证)。

## [0.2.1] - 2026-07-16

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

[Unreleased]: https://github.com/jiangding01/x-md-importer/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/jiangding01/x-md-importer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/jiangding01/x-md-importer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jiangding01/x-md-importer/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/jiangding01/x-md-importer/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/jiangding01/x-md-importer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jiangding01/x-md-importer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jiangding01/x-md-importer/releases/tag/v0.1.0
