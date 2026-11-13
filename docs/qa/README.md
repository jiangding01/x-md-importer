# QA · 设计稿 vs 实现 对照测试

> 用途：把「原型设计稿」与「当前构建产物」的同一视图两两并排，逐项核对像素级还原度，供后续自测参考（等价于 visual regression baseline）。

## 怎么看

- **对照文档**：`comparison.html` —— 用浏览器打开即可（双图并排 + 逐项结论 + 判定徽章）。
  - 因图片用相对路径 `shots/`，直接双击打开或用静态服务器托管本目录皆可：
    ```bash
    cd docs/qa && python3 -m http.server 8080   # 然后访问 http://localhost:8080/comparison.html
    ```
- **原始截图**：`shots/` —— 命名规范 `{序号}-{视图}-{主题}-{语言}.{design|impl}.png`。

## 采集口径（复现方式）

- 侧栏宽度 **420px**（@2x 采集）；富状态视口 **1700px**、空态/弹窗 **900px**。
- 设计稿 = `~/Downloads/x-importer/design_handoff_markflow/MarkFlow v3.dc.html`（Vue 原型，需同目录 `support.js`）。
- 实现 = `pnpm build` 产物 `.output/chrome-mv3/sidepanel.html`，静态托管后用 Playwright 驱动。
  - 2026-11-13 起侧边栏依赖扩展 API（不在扩展环境会报 “This script should only be loaded in a browser extension” 并白屏）：静态托管时须在页面脚本运行前（`page.addInitScript`）注入模拟的 `globalThis.browser`（`runtime.id` 非空；`tabs.query` 返回一个 `https://x.com/compose/articles/edit/<id>` 的活动标签；`tabs.sendMessage` 对 `markflow:probe` 回「编辑器 / Draft 实例 / 上传通道均就绪、已有内容」，对 `markflow:import` 回 `ok:true`）与只含 `runtime.id` 的 `globalThis.chrome`（不提供 `chrome.storage`，存储自动回退 localStorage）。待发布页截图即按此方式采集：载入示例 → 预览 → 展开能力映射 → 预检 → 导入到 X → 覆盖。
- 记录 Tab 通过 `localStorage['markflow:history']` 注入与设计稿相同的 3 条数据以做 1:1 对比。

## 覆盖矩阵（13 组）

待发布（空态/编辑/预览/能力映射/覆盖弹窗/预检+报告）· 记录 · 设置（极简/控制台/纸感/玻璃/英文）· 待发布英文空态。

## 已知的「非缺陷」差异（对比时忽略）

1. **下拉默认值差异** —— 设计稿 demo「语言=中文/外观=浅色」，实现「跟随浏览器/跟随系统」。实现符合技术方案 §5.2.4 规格，非还原缺陷。
2. **演示外壳** —— 设计稿左缘淡色竖排文字「模拟的 X 文章编辑页」是原型演示外壳，非产品 UI。
3. **滚动架构** —— 实现用「固定面板+内层滚动」（适配真实 Chrome 侧栏固定高度），原型用整页增高；本文档已用加高视口消除该差异。
4. **待发布页 7 张实现截图已按 2026-11-13 构建重拍**（01/02/03/04/06/08/15）—— 主按钮改名「导入到 X」（原「写入 X 文章」），并包含设计稿之后的迭代（状态条「编辑页 #id」、素材卡「本篇图片文件夹」、预览提示条、示例文稿与能力映射条目等），与设计稿不同属预期，非还原缺陷。记录 / 设置页截图未重拍。

## 结论

三个 Tab（待发布/记录/设置）在四主题 × 中英下还原度**整体很高**，未发现真实的像素级偏离。
