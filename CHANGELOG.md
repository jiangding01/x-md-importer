# 变更记录

本文件记录本项目的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 待办
- Phase D：真实 Chrome 侧边栏最终 QA 与打磨。
- M0/M1：把 mock 的注入/预检/文件夹服务替换为真实的 Draft.js 注入引擎（接口已预留）。

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
