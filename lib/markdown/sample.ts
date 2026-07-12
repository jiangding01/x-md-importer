/** 「载入示例」用的演示 Markdown · 移植自设计稿。 */

export const sampleZh = `---
title: 用 Markdown 写好一篇 X 文章
cover: assets/cover.png
---

# 用 Markdown 写好一篇 X 文章

在本地起草,让纯文本成为唯一事实来源,然后一键发布。

## 为什么是 Markdown

- **可迁移** —— 纯文本永远可读
- *更专注* —— 没有工具栏干扰
- \`更精确\` —— 代码就是代码

### 导入管线

> 好文章是改出来的。让草稿离你更近。

\`\`\`js
const publish = async (md) => {
  await x.articles.write(md);
};
\`\`\`

| 步骤 | 操作 |
|---|---|
| 1 | 导入 .md |
| 2 | 预检 |
| 3 | 写入 X |

![封面示意](assets/cover.png)

![流程图](https://example.com/pipeline.png)

---

#### 附录

更多内容见[使用指南](https://example.com)。
`;

export const sampleEn = `---
title: Writing a great X article in Markdown
cover: assets/cover.png
---

# Writing a great X article in Markdown

Draft locally, keep your source of truth in plain text, then publish in one click.

## Why Markdown

- **Portable** — plain text lives forever
- *Focused* — write without toolbars
- \`Precise\` — code stays code

### The pipeline

> Good writing is rewriting. Keep the draft close.

\`\`\`js
const publish = async (md) => {
  await x.articles.write(md);
};
\`\`\`

| Step | Action |
|---|---|
| 1 | Import .md |
| 2 | Preflight |
| 3 | Write to X |

![cover](assets/cover.png)

![diagram](https://example.com/pipeline.png)

---

#### Appendix

Read more in the [guide](https://example.com).
`;
