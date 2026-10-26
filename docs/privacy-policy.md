# MarkFlow 隐私政策 / Privacy Policy

生效日期 / Effective date: 2026-10-22

[中文](#中文) · [English](#english)

---

## 中文

MarkFlow(「本扩展」)是一个把 Markdown 导入 X(原 Twitter)文章编辑器的 Chrome 扩展。本扩展为独立开发,与 X Corp. 无关联。本政策说明本扩展处理哪些数据、存放在哪里、何时会发起网络请求。

### 1. 我们不收集任何数据

- **无遥测**:本扩展不包含任何统计、分析、崩溃上报或广告代码。
- **无开发者服务器**:本扩展不向开发者或任何第三方服务器发送数据。开发者不运营任何接收用户数据的后端。
- **无账号**:本扩展不需要注册或登录,不读取、不保存你的 X 账号凭据。

### 2. 本机存储的数据

- **草稿、导入历史、设置**:只保存在你本机浏览器的 `chrome.storage.local` 中,不会同步或上传。卸载扩展、或在「设置 → 记录与数据 → 清除所有数据」中清除,即可删除这些数据。
- **本地图片文件夹授权**:当你导入引用本地图片的文章时,本扩展通过浏览器的 File System Access API 读取你**主动选择**的文件夹里的图片。该文件夹的访问句柄保存在 x.com 源的 IndexedDB 中(浏览器的安全机制要求如此),你可以随时在素材板或设置中断开;涉及本地图片的导入结束后,本扩展也会自动断开。本扩展只读取文章中引用到的图片文件的内容;按文件名查找图片时(如 Obsidian 短链接 `![[a.png]]`),会读取该文件夹内的目录结构(文件名与子文件夹名),不读取其他文件的内容。本扩展不修改、不上传文件夹中的其他内容。
- **备份导出**:只有在你主动点击「备份与恢复 → 导出」或「诊断面板 → 导出快照」时才会生成文件,文件保存到你本机的下载目录,本扩展不会将其发送到任何地方。

### 3. 网络请求

- **远程图片**:仅当你导入的文章中包含远程图片(`![](https://…)`)时,本扩展的后台脚本才会向**该图片所在的站点**请求图片文件,以便上传到你的 X 文章。请求前,本扩展会在你点击写入时**一次**列出本篇所有图片所在的站点,由 Chrome 弹出一个授权提示统一询问(只申请这些站点;你可以拒绝,被拒绝站点的图片会以原文保留);请求使用 `credentials: 'omit'`,**不携带 cookie 或登录凭据**。
- **写入 X**:文章内容只写入**你自己打开的** X 文章编辑器页面,由 X 自身的页面完成保存。本扩展**永不自动发布**,发布始终由你手动完成。
- 除上述情形外,本扩展不发起任何网络请求。

### 4. 权限说明

| 权限 | 用途 |
|---|---|
| `storage`、`unlimitedStorage` | 在本机保存草稿、历史与设置(导入历史可能较大,故不受默认 10MB 限制) |
| `sidePanel` | 在浏览器侧边栏显示工作台 |
| `host_permissions`:`x.com`、`twitter.com` | 在 X 文章编辑页注入编辑器桥接脚本以写入内容;读取当前标签页 URL,判断你是否正在 X 文章编辑页 |
| `optional_host_permissions`:`*://*/*` | **可选权限**,安装时不授予。仅在导入含远程图片的文章时,只针对本篇图片所在的站点申请(写入时一个提示统一列出),用于下载这些图片 |

### 5. 儿童隐私

本扩展不面向儿童,也不收集任何人的个人信息。

### 6. 政策变更

本政策如有变更,会随扩展版本更新并修改上方生效日期。

### 7. 联系方式

如有疑问,请联系:<!-- 联系邮箱 -->

---

## English

MarkFlow ("the extension") is a Chrome extension that imports Markdown into the X (formerly Twitter) article editor. It is developed independently and is not affiliated with X Corp. This policy explains what data the extension handles, where it is stored, and when it makes network requests.

### 1. We do not collect any data

- **No telemetry**: the extension contains no analytics, statistics, crash reporting or advertising code.
- **No developer servers**: the extension sends no data to the developer or to any third-party server. The developer operates no backend that receives user data.
- **No account**: no sign-up or sign-in is required, and the extension never reads or stores your X account credentials.

### 2. Data stored on your device

- **Drafts, import history and settings** are stored only in your browser's `chrome.storage.local` on your device; they are never synced or uploaded. Uninstalling the extension, or using "Settings → History & data → Erase all data", deletes them.
- **Local image folder access**: when you import an article that references local images, the extension reads images from a folder **you choose** via the browser's File System Access API. The folder handle is stored in IndexedDB under the x.com origin (as required by the browser's security model). You can disconnect it at any time from the assets panel or Settings, and the extension also disconnects it automatically after an import that uses local images. The extension only reads the contents of the image files referenced by your article; when it looks an image up by file name (e.g. an Obsidian short link `![[a.png]]`), it reads the folder's directory structure (file and subfolder names) but not the contents of any other file. It never modifies or uploads anything else in the folder.
- **Backup export**: a file is created only when you click Export under "Backup & restore" or "Diagnostics", and it is saved to your local downloads folder. The extension never sends it anywhere.

### 3. Network requests

- **Remote images**: only when an article you import contains remote images (`![](https://…)`) does the extension's background script request the image file **from the site hosting that image**, so it can be uploaded to your X article. Before doing so, when you click write, the extension lists **all** the sites hosting this article's images in **one** Chrome permission prompt (only those sites are requested; if you decline, images from the declined sites are kept as plain text). These requests use `credentials: 'omit'` and **never send cookies or login credentials**.
- **Writing to X**: content is written only into the X article editor page **that you opened yourself**, and is saved by X's own page. The extension **never publishes automatically**; publishing is always done by you.
- Apart from the above, the extension makes no network requests.

### 4. Permissions

| Permission | Purpose |
|---|---|
| `storage`, `unlimitedStorage` | Keep drafts, history and settings on your device (import history can be large, so it is not capped at the default 10 MB) |
| `sidePanel` | Show the workspace in the browser side panel |
| `host_permissions`: `x.com`, `twitter.com` | Inject the editor bridge script on X article editor pages to write content; read the current tab's URL to tell whether you are on an X article editor |
| `optional_host_permissions`: `*://*/*` | **Optional**, not granted at install. Requested only for the sites hosting the current article's images (listed together in one prompt when you write), only when the article has remote images, to download those images |

### 5. Children's privacy

The extension is not directed at children and collects no personal information from anyone.

### 6. Changes to this policy

If this policy changes, it will be updated together with an extension release and the effective date above will be revised.

### 7. Contact

Questions: <!-- 联系邮箱 -->
