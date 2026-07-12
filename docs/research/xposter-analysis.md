# xPoster（Markdown → X Articles）源码深度分析报告

> 分析对象：`/private/tmp/claude-501/-Users-jiangding/1d2fa362-3273-4214-85be-3f5b38bcf169/scratchpad/xposter`（v1.42.70，MIT）
> 行号引用均基于当前仓库快照。标注【源码实证】为直接读码结论，【推断】为基于代码的合理推测。

---

## 0. 总体结论（TL;DR）

xPoster 的核心路线是：**在 MAIN world 里通过 React fiber 拿到 X 编辑器（Draft.js）的组件实例，直接构造 Draft.js 的 ContentState/blockMap 并调用组件的 `props.onChange(EditorState.push(...))` 完成写入**；图片则**不自己调上传 API**，而是从 fiber 上找到 X 自己的 `onFilesAdded` 回调，把 `File` 对象交给 X 原生上传管线，再轮询 blockMap 中新出现的 `MEDIA` entity 拿 mediaId。特殊块（代码/分割线/推文）先在正文写占位 marker 文本，随后原位替换成 `atomic` block + 对应 entity。标题/封面走 X 私有 GraphQL 接口（携带公开 web bearer token + ct0 CSRF cookie）。整体是「寄生在 X 自己的编辑器状态机上」的方案，而非模拟键盘/剪贴板（剪贴板粘贴仅作 fallback）。

---

## 1. 编辑器写入机制（核心中的核心）

### 1.1 定位编辑器 DOM 元素【源码实证】

`main-world.js:5-6` 定义了多级 fallback 选择器：

```js
const EDITOR_SELECTOR =
  "[data-contents='true'] [contenteditable='true'], [contenteditable='true'][role='textbox'], [contenteditable='true'].public-DraftEditor-content, [contenteditable='true']";
```

`findEditorElement()`（main-world.js:80-86）遍历所有匹配元素，用几何尺寸过滤（`rect.width > 200 && rect.height > 80`）挑出真正的正文编辑区，排除标题输入框等小型 contenteditable。ISOLATED 侧的 `findEditor()`（content.js:2559-2562）则只认 `.public-DraftEditor-content` 且宽 > 200。

### 1.2 通过 React fiber 定位 Draft.js 组件实例【源码实证】

`findDraftStateNode()`（main-world.js:88-104）——这是整个项目最关键的 12 行：

```js
function findDraftStateNode() {
  const editor = findEditorElement();
  if (!editor) return null;
  const fiberKey = Object.keys(editor).find(
    (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
  );
  if (!fiberKey) return null;
  let fiber = editor[fiberKey];
  for (let depth = 0; depth < 80 && fiber; depth += 1) {
    const stateNode = fiber.stateNode;
    if (stateNode?.props?.editorState && typeof stateNode.props.onChange === "function") {
      return stateNode;
    }
    fiber = fiber.return;
  }
  return null;
}
```

要点：
- fiber key 兼容两代 React 内部命名（`__reactFiber$`≥React 17，`__reactInternalInstance$`≤React 16）；
- 从编辑器 DOM 节点的 fiber **沿 `fiber.return` 向上**最多 80 层；
- 判定条件是 `stateNode.props.editorState`（Draft.js 的 `EditorState`）+ `props.onChange` 为函数——命中的正是 X 包装的 `DraftEditor` 类组件实例。拿到它就同时拿到了「读状态」（editorState）和「写状态」（onChange）两个入口。

### 1.3 正文写入：直接构造 ContentState，不是粘贴、不是 execCommand【源码实证】

主路径是 `writeDraftBlocks()`（main-world.js:202-279）。它最巧妙的设计是**完全不打包 Draft.js / Immutable.js 依赖，所有构造器都从页面现有对象上「借」**：

```js
// main-world.js:205-217
const editorState = draftNode.props.editorState;
const EditorState = editorState.constructor;                       // 借 Draft.js EditorState 类
const SelectionState = editorState.getSelection().constructor;     // 借 SelectionState 类
const contentState = editorState.getCurrentContent();
const blockMap = contentState.getBlockMap();
...
const BlockMap = blockMap.constructor;                             // 借 Immutable.OrderedMap
const CharacterList = sampleBlock.getCharacterList().constructor;  // 借 Immutable.List
```

字符级元数据（CharacterMetadata）没有可用构造器，于是用「样本字符」派生：从现有 blockMap 中找一个带 `set`/`getStyle` 方法的字符实例（`findDraftCharacterSample`，main-world.js:174-179），之后所有新字符都通过 `sampleCharacter.set("style", ...).set("entity", ...)` 克隆出来。

若编辑器是全新空草稿、没有任何字符可采样，`ensureDraftCharacterSample()`（main-world.js:185-200）会 **focus 编辑器后 `document.execCommand("insertText", false, "x")` 强插一个字符**逼出样本，再轮询最多 1.6s 等 React 落盘——这是全流程里唯一用 execCommand 的地方，仅用于「取样」，不用于写正文。

逐块构造（main-world.js:223-266）：

```js
// 每个块：随机 key + 类型 + 文本 + 逐字符样式/实体
const key = `${Math.random().toString(36).slice(2, 7)}${index.toString(36)}`;
// 链接 → LINK entity（MUTABLE）
nextContent = nextContent.createEntity("LINK", "MUTABLE", { url: String(link.url) });
// 每个字符：命中的 inlineStyleRanges → OrderedSet 样式；命中的链接区间 → entity key
let style = sampleCharacter.getStyle().clear();
for (const styleName of styleNames) style = style.add(styleName);
characterList = characterList.push(sampleCharacter.set("style", style).set("entity", entity));
const nextBlock = sampleBlock.merge({ key, type: block.type || "unstyled", text, characterList, depth: 0, ... });
```

提交（main-world.js:269-277）：

```js
const nextState = nextContent
  .set("blockMap", nextBlockMap)
  .set("selectionBefore", selection)
  .set("selectionAfter", selection);
let nextEditorState = EditorState.push(editorState, nextState, "insert-fragment");
nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
draftNode.props.onChange(nextEditorState);   // 走 X 自己的 onChange，React 状态、undo 栈、自动保存全部由 X 接管
```

⚠️ 注意 `nextBlockMap = BlockMap()` 是**从空 map 建起**（main-world.js:220）——即结构化写入是**整体替换**编辑器内容而非追加。这解释了 UI 层为什么有「覆盖确认」面板（`confirmArticleImportOverwrite`，content.js:4042-4072）和 preflight 的「Existing content」警告项。

### 1.4 行内样式与链接的落地【源码实证】

- 样式名映射：`draftInlineStyleName()`（main-world.js:281-290）：`Bold→"BOLD"`、`Italic→"ITALIC"`、`Strikethrough→"STRIKETHROUGH"`、`Code→"CODE"`——均为 Draft.js 标准 inline style 名，说明 X Articles 原生支持这四种行内样式（含行内代码）。
- 链接：每块的 `links:[{offset,length,url}]` → `createEntity("LINK","MUTABLE",{url})`，按字符区间挂 entity key（main-world.js:230-236, 243-250）。

### 1.5 粘贴 fallback【源码实证】

结构化写入失败时（`runFlow`，main-world.js:1369-1373）降级为合成粘贴事件 `pasteHtml()`（main-world.js:131-147）：构造 `DataTransfer`（`text/html` + `text/plain`），派发 `ClipboardEvent("paste", {clipboardData})`，必要时用 `Object.defineProperty` 强写 `clipboardData` 属性。此时行内样式靠 shared.js 生成的 HTML（`<strong>/<em>/<s>/<code>/<a>`，STYLE_TAGS，shared.js:2-7）由 Draft.js 的 HTML 粘贴解析器还原。

---

## 2. 块类型映射

### 2.1 文本类块（Draft.js 原生 block type）【源码实证】

解析端 `parseTextBlocks()`（shared.js:812-864）：

| Markdown | Draft.js block type |
| --- | --- |
| `#`~`######` | `header-one` … `header-six`（**六级全映射，无降级**） |
| `> ` 单行 | `blockquote`（逐行独立 block，不合并多行） |
| `- * +` | `unordered-list-item`（depth 恒 0，无嵌套，main-world.js:261） |
| `1.` | `ordered-list-item` |
| 段落 | `unstyled` |
| 表格渲染失败的兜底文本 | `code-block`（shared.js:1177，唯一用到该 type 的地方） |

【推断】h1 通常被 `parseMarkdown` 抽走当标题（shared.js:493-501），正文里剩 h2-h6；X Articles UI 实际只提供有限的标题层级，h4-h6 写进去后如何渲染取决于 X 的 blockRenderMap，可能视觉上退化，但 Draft.js 数据层接受这些 type 不会报错。

### 2.2 特殊块：占位 marker → atomic block + entity【源码实证】

所有特殊块在 `buildPastePlan()`（shared.js:1038-1196）阶段先写成一个 `unstyled` 占位块，文本形如 `__XPOSTER_{5位随机}_{TYPE}_{序号}__`（shared.js:1039,1047），随后 MAIN world 用 `replaceMarkerWithAtomic()`（main-world.js:345-370）原位替换成 `type:"atomic"`、`text:" "`、单字符挂 entity 的 block：

| Markdown | entityType | mutability | entity data | 出处 |
| --- | --- | --- | --- | --- |
| `---` 分割线 | `"DIVIDER"` | IMMUTABLE | `{}` | shared.js:1102-1111 |
| ``` 代码块 ``` | `"MARKDOWN"` | MUTABLE | `{ markdown: "```lang\ncode\n```" }`（整个 fence 原文） | shared.js:1113-1123 |
| 推文 URL | `"TWEET"` | IMMUTABLE | `{ url, tweetId }` | shared.js:1125-1140 |
| 图片/表格图 | `"MEDIA"`（由 X 上传管线自动生成，xPoster 不亲手造） | — | X 自填（含 mediaId） | main-world.js:452-468 |

**回答 README 疑问**：X Articles 的「代码块」不是 `code-block` block type，而是 **atomic block + `MARKDOWN` entity**，xPoster 把完整的 Markdown code fence 原文塞进 `data.markdown`；分割线是 atomic + `DIVIDER` entity（不是 `'HR'`）。这两个 entity 类型名是 X 编辑器内部约定，xPoster 直接复用。【推断】X 编辑器有对应的 atomic block 渲染器消费 `MARKDOWN` entity 并做语法高亮渲染。

批量替换由 `insertAtomicBatch()`（main-world.js:372-409）完成：在一个 contentState 事务里逐 marker 替换，最后一次性 `EditorState.push(..., "insert-fragment")` + `onChange` 提交，减少 React 渲染次数。

---

## 3. 图片 / 媒体上传机制

### 3.1 触发 X 自身上传流程：fiber 上找 `onFilesAdded`【源码实证】

`findOnFilesAdded()`（main-world.js:106-129）：从编辑器 fiber 沿 `return` 向上最多 160 层，同时每层向下递归子树最多 8 层（`findOnFilesAddedInFiberChildren`），寻找 `props.onFilesAdded`（`memoizedProps` 或 `stateNode.props`）为函数的节点。这是 X 编辑器自己处理文件拖放/选择的回调 prop。

上传即直接调用：

```js
// main-world.js:751-757（startUploadAttempt 内）
const handler = findOnFilesAdded() || onFilesAdded;
handler([file]);   // file 是 base64ToFile() 构造的原生 File 对象
```

`base64ToFile()`（main-world.js:411-416）：`atob` → `Uint8Array` → `new File([bytes], fileName, {type: mime})`。**不构造 paste/drop 事件，不直接调 X 上传 HTTP API**——把 File 交给 X 的 React 回调后，压缩、分片上传、进度、media entity 插入全部由 X 自己完成。

### 3.2 上传完成检测：diff MEDIA entity + 递归挖 mediaId【源码实证】

`uploadImageAtMarker()`（main-world.js:707-907）流程：

1. `placeSelectionAtMarker()`（main-world.js:660-673）：`EditorState.forceSelection` 把光标钉到 marker 块的 offset 上——**X 会把上传的媒体块插入光标位置**，这是「图片插在正确位置」的关键；
2. 快照当前所有 MEDIA entity（`existingMediaEntities`，main-world.js:452-468）；
3. 调 `onFilesAdded([file])`；
4. 350ms 轮询 blockMap，`findNewMediaUpload()`（main-world.js:558-587）找快照外新增的 atomic MEDIA entity；
5. 从 entity data 递归提取 mediaId：`mediaIdFromEntityData()`（main-world.js:481-534）尝试 `mediaId/media_id/media_id_string/mediaKey/media_key/id_str/id/rest_id` 等键名，`normalizeMediaIdValue` 兼容 `123_456` 形式的 media key 和 `..._12345678` 尾缀数字（≥8 位）——这是对 X entity data 结构变动的防御性穷举；
6. mediaId 出现 = 上传完成；只有 entity 没有 mediaId = pending，用「数据签名稳定性」判定（`mediaEntityDataSignature` JSON 签名 5s 无变化 + 已出现 20s，或封顶 32s）后放行（封面图除外，`canUsePendingMediaUpload`，main-world.js:1297-1299）。

超时/重试参数（main-world.js:7-17）：基础 90s + 每张图 +2.5s，封顶 150s；45s 完全无 entity 自动重试；15s 后向用户开放手动 Retry；单图最多 3 次 attempt。

### 3.3 marker 替换与图片归位【源码实证】

上传成功后 X 插入的 MEDIA block 未必恰好在 marker 位置（光标可能被 X 挪动），所以有两步「归位」：

- `relocateImages()`（main-world.js:947-1046）：重排 blockMap，把 MEDIA block 移到 marker block 处（marker 独占一行时直接顶替其位置，否则插在其前）；找不到对应 block 时按「未被占用的 MEDIA block 顺序」兜底配对（fallbackIndex 逻辑，main-world.js:1002-1008）；
- `replaceMarkerText()`（main-world.js:909-936）：marker 文本替换为空 → 整块删除（`deleteBlockByKey`）；marker 混在其他文字中则只抠掉 marker 子串。

失败图片降级：`replaceMarkerText(draftNode, marker, op.op.fallbackText)`，fallbackText 是原始 `![alt](src)` Markdown（`imageFallbackMarkdown`，shared.js:1198-1206；runFlow 调用处 main-world.js:1466）——**失败不静默丢内容**。

最后 `cleanupMarkers()`（main-world.js:1048-1095）用正则 `__XPOSTER_[A-Za-z0-9]+_[A-Z]+_\d+__` 全文兜底清除任何残留 marker，**catch 分支里也执行**（main-world.js:1506-1516），保证中断/报错后正文不留脏占位符。

### 3.4 封面图【源码实证】

两条路径（buildPastePlan，shared.js:1181-1192 + runFlow，main-world.js:1447-1497）：

- 封面图同时出现在正文 → 复用该图上传得到的 mediaId；
- 封面不在正文 → 生成 `coverOnly:true` 的 `COVER` marker，照常上传拿 mediaId，**之后把这个临时插入正文的 MEDIA block 删掉**（`deleteBlockByKey`，main-world.js:1491-1497）。

设置封面调用 **X 私有 GraphQL**（main-world.js:1176-1185）：

```js
function updateCoverGraphql(articleId, mediaId, category = "DraftTweetImage") {
  return xGraphql("Es8InPh7mEkK9PxclxFAVQ", "ArticleEntityUpdateCoverMedia", {
    variables: { articleEntityId: articleId, coverMedia: { media_id: String(mediaId), media_category: category } },
    features: GRAPHQL_FEATURES, queryId: "Es8InPh7mEkK9PxclxFAVQ"
  });
}
```

`xGraphql()`（main-world.js:1148-1166）：`fetch("https://x.com/i/api/graphql/{queryId}/{op}")`，`credentials:"include"`，头部带**硬编码的 X Web 公开 bearer token**（main-world.js:1137-1138，即 x.com 前端通用 token）、`x-csrf-token` 取自 `ct0` cookie（main-world.js:1144-1146）、`x-twitter-auth-type: OAuth2Session`。articleId 从 URL `/articles/edit/(\d+)` 提取（main-world.js:1140-1142）。因运行在 MAIN world 同源上下文，cookie 自动携带。

### 3.5 标题：UI + GraphQL 双保险【源码实证】

- UI 通道 `setTitleViaUi()`（main-world.js:1208-1251)：对所有可见 input/textarea/contenteditable 打分（aria-label/placeholder/data-testid 含 "title/标题/add title/输入标题" +10 分、位于页面上部 +3、宽 >240 +2），命中后用 **原生 value setter**（`Object.getOwnPropertyDescriptor(proto,"value").set.call`）+ 派发 `input`/`change` 事件绕过 React 受控组件；
- GraphQL 通道 `ArticleEntityUpdateTitle`（queryId `x75E2ABzm8_mGTg1bz8hcA`，main-world.js:1168-1174）。
- 两通道都试，任一成功即算成功（`applyTitleMetadata`，main-world.js:1253-1272）。

### 3.6 图片字节的来源与惰性传输【源码实证】

图片准备在 ISOLATED content script 完成（`prepareImages`，content.js:1800-1828，**并发 3 路 worker**）：

- data URI → 直接解析（shared.js:1428-1447）；
- 本地相对路径 → File System Access（见 §7）；
- 远程 http(s) → 经 background `xposter:fetch-image` 代理下载（见 background.js:141-456，含私网 IP SSRF 黑名单、16MB 上限、MIME 白名单、3 次重试、5 分钟 32MB LRU 缓存、腾讯云 COS 签名 URL `response-*` 参数修复）；
- Markdown 表格 → `renderTableImage()`（shared.js:1549-1633）**canvas 离屏绘制表格转 PNG**（列宽按文本测量 120-260px，斑马纹，devicePixelRatio≤2，1200 cell / 16M 像素上限）。

传给 MAIN world 时不整包塞 base64：`streamImageFilesForMain()`（content.js:1830-1845）把 base64 从 plan 中剥离、以 marker 为 token 存 Map；MAIN world 用到哪张再发 `file-request`，content 回 `file-response`（main-world.js:40-62 requestPreparedFile ↔ content.js:1375-1391）。避免单条 postMessage 巨型 payload。

---

## 4. 推文嵌入

【源码实证】识别三种写法（shared.js:553-590 + 563-576）：

1. 独占一行的裸 URL：`^https?://(www.)?(x|twitter).com/{user}/status/(\d+)$`；
2. 独占一行的 `[text](status-url)` 链接；
3. `![alt](status-url)` 图片式写法也转推文。

统一生成 `{type:"tweet", tweetId}` segment → paste plan 中的 atomic 操作：`entityType:"TWEET"`, `data:{ url: "https://twitter.com/i/web/status/{id}", tweetId }`, IMMUTABLE（shared.js:1125-1140）→ MAIN world `insertAtomicBatch` 替换 marker 为 atomic block。【推断】X 编辑器的 TWEET entity 渲染器会自行拉取推文卡片；正文中非独占一行的推文链接则保持普通 LINK。

---

## 5. Preflight（Check article）检查

【源码实证】`buildPreflightChecks()`（sidepanel.js:5948-6086）共 11 项检查，数据来自两条链路：

- `xposter:page-status`（content.js:5475-5495）：路由（`isArticleRoute` = `/compose/articles`；`isEditorRoute` = `/compose/articles/edit/`，content.js:292-298）、`hasEditor`、编辑器现有文本长度/采样、content script 版本、旧版脚本残留、vault 状态；
- `xposter:diagnostics` → `diagnoseMainWorld()`（content.js:5565-5584）向 MAIN world postMessage `kind:"diagnostics"`，2.5s 超时；MAIN world 回包（main-world.js:1563-1583）：`hasEditorElement / hasDraftStateNode / hasOnFilesAdded / articleId / editorBounds`。

三个「X 改版探针」的对应关系：

| README 术语 | 实际检查 | 判定失效的含义 |
| --- | --- | --- |
| editor bridge | MAIN world 脚本 ready 握手 + diagnostics 应答（`mainWorld:true`） | MAIN world 注入失败 / postMessage 桥断 |
| Draft.js editor | `hasDraftStateNode`：fiber 上能找到 `props.editorState + onChange`（sidepanel.js:6039-6047 "Editor check"） | X 换掉 Draft.js 或 fiber 结构变化，结构化写入必挂 |
| media upload handler | `hasOnFilesAdded`：fiber 上能找到 `onFilesAdded` prop（sidepanel.js:6048-6060 "Uploads"，仅当草稿含图片时才是硬性项） | X 改上传组件 props，图片上传路径失效 |

其余检查：draft（有无可导入内容）、target（活动标签在 X Articles 路由）、page-script（content script 版本 === 扩展版本，防「扩展升级但页面还跑旧脚本」；另检测旧版脚本 DOM 残留并清理，content.js:347-397）、target-lock（Check 时用 URL/articleId 生成锁 key，写入前 drift 检测「文章被切换」，sidepanel.js:6860-6899）、editor-content（已有内容警告防误覆盖）、assets（本地图路径需要文件夹授权）、remote-images（web 图来源统计）、plan。

写入前 content 侧还有独立防线：媒体总数软上限 25（`X_ARTICLE_MEDIA_SOFT_LIMIT`，content.js:35-36，超限直接拒绝导入，接近 21 时提示）。

---

## 6. 架构与通信

【源码实证】四个执行环境 + 三种通信通道：

```
sidepanel.js (side panel 页)
   │  chrome.tabs.sendMessage({type:"xposter:*"})       ↑ chrome.runtime.sendMessage broadcast（progress/complete/error）
   ▼
content.js + shared.js  (ISOLATED world content script)
   │  window.postMessage  source:"xposter" →            ↑ source:"xposter-main" ←
   ▼
main-world.js  (MAIN world content script，与 X 页面同 JS 上下文)

background.js (MV3 service worker, type:module)
   ▲  chrome.runtime.sendMessage：xposter:fetch-image / probe-image / open-side-panel / open-articles / diagnose-active-tab（background.js:24-61）
```

- **MAIN world 注入方式**：manifest 声明式注入，`content_scripts[1]` 带 `"world": "MAIN"`（manifest.json:35-46），非 script 标签动态注入，`run_at: document_idle`、`all_frames: false`。这要求 Chrome ≥111（manifest 声明 `minimum_chrome_version: "116"`）。
- **window.postMessage 协议**：双向以 `data.source` 字段区分通道（`"xposter"` → MAIN / `"xposter-main"` ← MAIN，main-world.js:3-4），并校验 `event.source === window`。消息 kind：`ready?/ready`、`run`（携带完整 paste plan payload）、`progress`、`done`、`error`、`cancelled`、`cancel`、`retry-upload`、`file-request/file-response`、`upload-files(-done/-error)`、`diagnostics`（main-world.js:1522-1584；content.js runMain 监听侧 1360-1433）。
- **握手**：content 启动即 `waitForMainReady()`（content.js:1253-1278）每 250ms 广播 `ready?` 直到收到 `ready`；MAIN world 加载完也主动广播一次 `ready`（main-world.js:1587）。
- **保活**：content 侧对 run 全程设 180s 静默超时（`MAIN_WORLD_SILENCE_TIMEOUT_MS`，content.js:37），每收到 progress/file-request 刷新；MAIN world 上传等待期间每 15s 发心跳 progress（main-world.js:10）。
- **sidepanel 找目标 tab**：优先记忆的 targetTabId → 当前活动 X tab → `chrome.tabs.query({url:["https://x.com/*","https://twitter.com/*"]})`（sidepanel.js:2569-2584）；background 在打开 side panel 时把来源 tab 存入 `chrome.storage.local`（background.js:84-96）。

---

## 7. manifest 权限清单

【源码实证】manifest.json 全量：

| 类别 | 内容 | 用途 |
| --- | --- | --- |
| `permissions` | `storage`, `sidePanel`, `tabs` | 草稿/记录/设置存储；侧边栏；找 X 标签页（query url 需要 tabs） |
| `host_permissions` | **无** | 对 x.com 的注入靠 `content_scripts.matches` 自带授权 |
| `optional_host_permissions` | `http://*/*`, `https://*/*` | 仅当草稿含 web 图片时运行时申请：`chrome.permissions.request({origins:[...]})`（sidepanel.js:4124-4140），按图片来源 origin 精确申请 |
| `content_scripts` | ISOLATED: shared.js+content.js；MAIN: main-world.js | 见 §6 |
| `web_accessible_resources` | src/i18n.js, src/shared.js, fixtures/live-x-smoke.md（仅对 x.com/twitter.com） | 【推断】供页面上下文/诊断按需加载与冒烟测试取用 |
| 其他 | `minimum_chrome_version: 116`；background 为 module service worker；action 弹窗为 diagnostics.html | — |

**本地图片文件夹访问**：File System Access API。在 **X 页面（content script）上下文**弹自绘面板后调用 `window.showDirectoryPicker({ id: "xposter_vault_root", mode: "read" })`（content.js:1780），拿到的 `FileSystemDirectoryHandle` **持久化进 IndexedDB**（库 `xposter_local_assets` / store `handles` / key `vault_root`，shared.js:1459-1491），后续会话通过 `handle.queryPermission({mode:"read"})` / `requestPermission` 复活权限（shared.js:1493-1505）。相对路径解析有专门的路径安全器：拒绝绝对路径与盘符、拒绝 `..` 逃逸（`parseLocalImagePath`，shared.js:1257-1295），并支持「Markdown 路径首段 == 所选文件夹名」时自动剥掉首段再匹配（shared.js:1308-1334）。之所以在页面而非 sidepanel 里调 picker，【推断】是因为 side panel 上下文中 showDirectoryPicker 可用性/用户手势限制不可靠，sidepanel 侧有 `ensureXPageForVaultPrompt()` 先把用户带到 X 页（sidepanel.js:6644-6659）。

---

## 8. Markdown 解析与 paste plan

### 8.1 解析器【源码实证】

**导入用解析器是 shared.js 里完全手写的**；`vendor/minigfm.min.js`（MIT, Fgaoxing）只在 **sidepanel 预览**中做 Markdown→HTML 渲染（sidepanel.html:15；sidepanel.js:387-392），与写入 X 的链路无关。自研 Markdown→Markdown 导出器（读文章页 DOM 转回 Markdown，content.js:2891-3235）也是手写。

`parseMarkdown()`（shared.js:461-520）支持：

- frontmatter：`--- key: value ---` 简易解析（不支持嵌套 YAML），识别 `title/Title/标题`、`cover/Cover/封面`（封面值兼容 `![[...]]` 与 `![](...)` 包裹）；
- 标题提取优先级：frontmatter > 正文第一个 H1（取出后从正文删除）> 文件名候选；封面：frontmatter > 正文第一张图；
- 块级：h1-h6、单行 blockquote、无序/有序列表（单层）、段落、fenced code（``` / ~~~，3+ 个，含正确的闭合匹配，shared.js:605-629）、缩进代码（4 空格/Tab，shared.js:668-707）、GFM 表格（含对齐行校验与 `\|` 转义，shared.js:775-810）、分割线、独立行推文 URL、`![alt](src)`（手写括号配对器支持 URL 内嵌套括号与转义，shared.js:709-764）、Obsidian `![[image]]`（shared.js:592-600）；
- 行内：`***`（Bold+Italic）、`**`、`~~`、单 `*`/`_`、`` ` ``、`[text](url)`（parseInline，shared.js:866-945）；
- 特色：`smartPunctuation` 中文智能标点（半角→全角，带 URL/路径/邮箱/行内代码保护区与 **style/link offset 重映射**，shared.js:153-459）；`toTraditionalChinese` 简繁转换表；
- 不支持（明确边界）：嵌套列表、多行引用合并、任务列表、脚注、内嵌 HTML、setext 标题。

特殊块用「span 扫描 + overlaps 去重」策略（`findSpecialBlocks`，shared.js:522-603）：先扫代码块（优先级最高，防止其内容被误判），再表格、分割线、推文、图片，剩余区间交给 `parseTextBlocks`。

### 8.2 paste plan 数据结构【源码实证】

`buildPastePlan()`（shared.js:1038-1196）返回：

```js
{
  html: "<h2>..</h2><p>__XPOSTER_ab3xk_IMAGE_0__</p>...",   // 粘贴 fallback 用
  plain: "...",                                              // text/plain fallback
  blocks: [                                                  // 结构化写入用（Draft.js RawBlock 形状）
    { type: "header-two", text: "..", inlineStyleRanges: [{offset,length,style:"Bold"}], links: [{offset,length,url}] },
    { type: "unstyled", text: "__XPOSTER_ab3xk_IMAGE_0__", inlineStyleRanges: [], links: [] },
    ...
  ],
  plan: [                                                    // 后处理操作队列
    { marker: "__XPOSTER_ab3xk_DIVIDER_1__", op: { type: "atomic", entityType: "DIVIDER", data: {}, mutability: "IMMUTABLE" } },
    { marker: "__XPOSTER_ab3xk_CODE_2__",    op: { type: "atomic", entityType: "MARKDOWN", data: { markdown }, mutability: "MUTABLE" } },
    { marker: "__XPOSTER_ab3xk_TWEET_3__",   op: { type: "atomic", entityType: "TWEET", data: { url, tweetId } } },
    { marker: "__XPOSTER_ab3xk_IMAGE_0__",   op: { type: "image", file: {base64|token, mime, fileName, alt}, source, fallbackText, coverOnly } },
    { marker: "__XPOSTER_ab3xk_TABLE_4__",   op: { type: "image", file: {…表格PNG…}, fallbackText: 表格Markdown原文 } }
  ],
  markerPrefix: "__XPOSTER_ab3xk_"
}
```

content 侧再补 `title/cover/origin` 字段后整包 `postMessage kind:"run"` 给 MAIN world（content.js:1494-1505）。

`applyLimits()`（shared.js:957-998）：图片/表格/推文超过配置上限时不丢弃而是**降级为原始 Markdown 文本段**。

---

## 9. 健壮性设计

【源码实证】要点汇总：

1. **写前锁定与漂移检测**：Check 时 target lock，写前重验 lock key、路由、编辑器存在（sidepanel.js:6860-6899 + content.js:1448-1450）；content script 版本一致性检查防「扩展已更新、页面还是旧脚本」（sidepanel.js:5975-6014）；同类旧扩展 DOM 残留检测 + 主动清理（content.js:347-397）。
2. **marker 事务模型**：正文文本先行（一次性提交），媒体/特殊块全部通过幂等可清理的 marker 后处理；`runFlow` 的 catch 里也跑 `cleanupMarkers` + `kickRender`（main-world.js:1506-1518），任何中断都不会给用户留下 `__XPOSTER_*__` 脏文本；每次导入 marker 前缀随机，避免与历史残留冲突，同时兜底正则清理所有 `__XPOSTER_` 开头 token（main-world.js:943-945, 1061-1064）。
3. **取消与恢复**：`cancelRequested` 标志 + `throwIfCancelled()` 检查点密布每个 await 间隙（main-world.js:33-38 等约 20 处）；取消走同样的 marker 清理路径；导入记录（原始 Markdown）持久化在 chrome.storage.local 可重写；跨页跳转导入用 pending import（10 分钟 TTL，content.js:1582-1624）。
4. **多级重试**：图片下载 content 侧 4 次、间隔 `800ms × attempt²`（content.js:1847-1866）+ background 侧 3 次 `[0,700,1800]ms`（background.js:3, 290-305）+ 5 分钟 32MB LRU 缓存；上传 3 attempt + 45s no-entity 自动重试 + 用户手动 Retry 按钮（经 sidepanel→content→MAIN 三级转发，content.js:1287-1293）。
5. **节流/延时的性质**：**没有拟人化 anti-bot delay**。所有 sleep（80/100/120/150/180/250/350/400/600/900ms）都是等待 React 提交/渲染的节奏控制；每步操作后 `draftNode = findDraftStateNode() || draftNode` 重新抓取实例（runFlow 中出现 10+ 次），因为 React 重渲染后旧 stateNode 的 editorState 已过期。图片下载并发限 3 + 每张间隔 120ms（content.js:1805-1826），更多是自我限速礼貌性防节流。
6. **对 X 改版的防御手法**：选择器多级 fallback（EDITOR_SELECTOR 4 段）；fiber key 兼容新旧 React；fiber 向上 80/160 层 + 向下 8 层的宽容搜索；CharacterList API 兼容（`find/size/count()/get/first` 全试，main-world.js:153-172）；mediaId 键名穷举 + 递归深挖 5 层；结构化写入失败自动降级 HTML 粘贴；标题 UI+GraphQL 双通道；创建按钮三策略（empty-state testid → SVG path `d^="M14.543"` 图标匹配 → aria-label 多语言词表，content.js:2538-2557）；诊断面板输出全部探针布尔值供排障。
7. **安全**：远程图片私网 IP/localhost/IPv6 link-local 黑名单在 background 和 shared 双份实现（SSRF 防御，background.js:193-229）；重定向落点二次校验（background.js:360-365）；16MB 大小 + MIME 白名单双端校验；本地路径 `..` 逃逸拒绝；`credentials:"omit"` 下载图片。

---

## 10. 可借鉴 vs 可改进（站在自研角度）

### 10.1 被验证的可靠路径（建议沿用）

1. **「借页面构造器」直写 Draft.js 状态**是本项目最有价值的资产：不打包 draft-js/immutable 依赖、天然与 X 线上版本同构，且走 `props.onChange` 让 X 自己的自动保存/undo/校验全部生效。整套 `findDraftStateNode + sampleCharacter 克隆 + EditorState.push` 可以原样复用。
2. **`onFilesAdded` 桥接上传**：比逆向 X 上传 HTTP API（media/upload 分片、鉴权、参数随版本漂移）稳定得多，且天然获得 X 的压缩与合规处理。配套的「MEDIA entity diff + mediaId 递归提取 + pending 稳定性判定」是长期实战打磨出来的，值得整体搬运。
3. **marker 占位 → 原位替换 → catch 兜底清理**的事务模型：把「一次导入」拆成幂等小步，失败面可控、可恢复，是浏览器自动化里罕见的整洁设计。
4. **preflight 探针体系**（bridge/DraftNode/onFilesAdded 三层 + 版本一致性 + target lock）：把「X 改版导致的失效」从用户玄学报错变成明确的诊断项，极大降低维护成本。
5. **权限最小化姿势**：零 host_permissions、optional_host_permissions 按 origin 运行时申请、File System Access handle 存 IndexedDB——过 Chrome Web Store 审核友好，应照搬。
6. 表格→canvas 渲图、失败降级为原始 Markdown 文本、媒体软上限预检，都是低成本高体验的细节。

### 10.2 值得改进的点

1. **结构化写入是整体替换 blockMap**（main-world.js:220 从空 map 建起）：无法向已有文章追加/插入，也是「必须新草稿导入」限制的根源。自研可改为基于 selection 的 fragment 插入（`Modifier.replaceWithFragment` 等价操作），支持增量导入与断点续写。
2. **GraphQL queryId 硬编码**（`x75E2ABzm8_mGTg1bz8hcA`、`Es8InPh7mEkK9PxclxFAVQ`，main-world.js:1169,1177）：X 的 queryId 随前端发版轮换，这是最脆的点。可运行时从 X 页面加载的 JS bundle 里正则提取 queryId，或对失败增加「引导用户手动设置封面」的降级 UI。
3. **代码组织**：content.js 5595 行 / sidepanel.js 10000+ 行单文件 IIFE，大量 UI 样式字符串内联（如 vault 面板 100+ 行 CSS in JS，content.js:1634-1735），无构建步骤是刻意选择（便于审计），但自研建议用 TS + 构建（Vite/CRXJS）拆模块，用类型描述 plan/segment/消息协议——这套协议消息 kind 有 12 种、字段全靠约定，是最容易回归的地方。
4. **轮询偏多**：ready 握手、editor 等待、marker 等待、上传检测全是 setTimeout 轮询。上传检测可改为劫持/订阅 onChange（包一层 wrapper）或 MutationObserver，减少 350ms 轮询延迟累积；ready 握手可用 CustomEvent + 一次性广播。
5. **块类型覆盖**：不支持嵌套列表（depth 恒 0）、多行引用（逐行成块）。Draft.js 原生支持 list depth，自研解析器可以补齐（`depth` 字段直接可用）。
6. **每字符逐个 push CharacterList**（main-world.js:238-254）对超长文是 O(n) Immutable push；可用 `CharacterList(Array)` 一次构建或按 range 批量填充。实测长文（数万字）时这里和多次 onChange 是主要卡顿来源【推断】。
7. **file-request 惰性传输**已经不错，但 base64 在 content↔MAIN 间仍是字符串拷贝；MV3 下可考虑 `structuredClone` 传 ArrayBuffer（postMessage 支持 transferable 在同 window 下不可 transfer，但可避免 base64 编码开销，改传 Uint8Array）。
8. **硬编码 bearer token** 虽是 X web 端公开通用 token，但复制它进自己的产品有被 X 针对的风险与合规观感问题；自研可优先从页面运行时截获真实 Authorization 头（MAIN world 可包 fetch/XHR），降低指纹独特性。

---

## 附：关键文件导航

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| src/main-world.js | 1588 | MAIN world：fiber 定位、Draft.js 直写、atomic 替换、onFilesAdded 上传、GraphQL 标题/封面、marker 清理 |
| src/content.js | 5595 | ISOLATED：页面状态/路由检测、postMessage 桥、图片/表格准备、vault（File System Access）、页面 UI（导入按钮/状态卡/拖放）、文章→Markdown 导出 |
| src/shared.js | 1672 | 自研 Markdown 解析器、buildPastePlan、本地路径安全器、表格 canvas 渲图、IndexedDB handle 存取、智能标点 |
| src/background.js | 525 | MV3 service worker：远程图片下载代理（SSRF 防御/重试/缓存）、side panel/标签页管理 |
| sidepanel.js | ~10600 | 侧边栏：草稿/队列/记录、preflight 11 项检查、target lock、optional permissions 申请 |
| vendor/minigfm.min.js | — | 仅 sidepanel 预览渲染 Markdown→HTML，与导入链路无关 |
| manifest.json | 79 | MV3；双 content_scripts（ISOLATED + `world:"MAIN"`）；零 host_permissions |
