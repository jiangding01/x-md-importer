// 从 CHANGELOG.md 提取指定版本段落作为 GitHub Release 正文。
// 用法: node extract-release-notes.mjs <version>   （version 不带 v 前缀，如 0.2.0）
// 匹配 `## [<version>]` 到下一个 `## [` 之间的内容；找不到则回退为「见 CHANGELOG」。
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').trim();
if (!version) {
  console.error('缺少 version 参数');
  process.exit(1);
}

const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const lines = changelog.split(/\r?\n/);

// 版本标题形如：## [0.2.0] - 2026-07-16   （日期可选）
const headingRe = /^##\s+\[([^\]]+)\]/;
let start = -1;
for (let i = 0; i < lines.length; i += 1) {
  const m = headingRe.exec(lines[i]);
  if (m && m[1] === version) {
    start = i;
    break;
  }
}

if (start === -1) {
  // 回退：不阻断发版，给个指向 CHANGELOG 的占位正文。
  process.stdout.write(
    `Release v${version}\n\n完整变更见 [CHANGELOG.md](./CHANGELOG.md)。\n`,
  );
  process.exit(0);
}

// 收集到下一个版本标题前（不含标题行本身）。
const body = [];
for (let i = start + 1; i < lines.length; i += 1) {
  if (headingRe.test(lines[i])) break;
  body.push(lines[i]);
}

// 去掉首尾空行。
while (body.length && body[0].trim() === '') body.shift();
while (body.length && body[body.length - 1].trim() === '') body.pop();

process.stdout.write(body.join('\n') + '\n');
