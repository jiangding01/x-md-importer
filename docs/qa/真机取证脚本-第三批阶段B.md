# 真机取证脚本 — 第三批阶段 B(I4 / I5 / I6 / I7)

> 来源:[`修复方案-2026-10-26-第三批.md`](../review/修复方案-2026-10-26-第三批.md) 第 2 节。I5 / I6 / I7 的现象还没在真机上确认,**先取证、再定修法**;I4 顺带取证,用来确认修法(I2 修法已定,修完做回归即可,不需要取证)。
> 脚本**只读**:不点击、不输入、不改 DOM 或编辑器状态。定位编辑器 / 标题框 / 封面输入的口径与 `entrypoints/injector.ts` 完全一致(`EDITOR_SELECTOR_TIERS`、`scoreTitleField`、`setCoverImage` 的 accept 过滤),所以输出就是「插件此刻会选中谁」。

## 用法

1. 打开 X 文章编辑页(`x.com/compose/articles/edit/…`),按 F12 打开 DevTools → Console。
2. 顶部的上下文下拉框保持 **top**(不要选扩展的 content script 上下文)。
3. 粘贴下方整段脚本回车。结果会打印出来,并自动复制到剪贴板(DevTools 的 `copy()`)。
4. 按下面「场景」把每次的输出贴回给我,注明场景编号。

## 场景(每个场景跑一次脚本)

| 编号 | 对应 | 操作 | 重点看 |
|---|---|---|---|
| S1 | I5 / I4 | 界面语言**简体中文**,打开一篇有正文的文章 | `E1`、`E4` |
| S2 | I5 | X 设置 → 辅助功能、显示和语言 → 语言,切到**日语**(或西班牙语),刷新同一篇文章 | `E1.pick` 是否为 null |
| S3 | I5 | 切回**英文**,刷新同一篇文章 | `E1` |
| S4 | I6 | 一篇**没有封面**的文章 | `E2` |
| S5 | I6 | 一篇**已有封面**的文章(可在 X 里手动设一张) | `E2`:封面输入还在不在、多了哪些按钮 |
| S6 | I7 | 用插件写入下方「I7 样例」后跑脚本,然后按「I7 手动检查」逐项试 | `E3` + 手动检查结果 |
| S7 | I7 | 新建空文章,用 **X 自己的**插入菜单插一个代码块(或分割线 / 图片),不打字,跑脚本 | `E3`:X 原生插入时是否在前后补了空段落 |

### I7 样例(S6 用)

````markdown
![](https://pbs.twimg.com/media/GZx0kNnXcAAx6jW.jpg)

```js
const a = 1;
```

---

```js
const b = 2;
```
````

即:以图片开头、中间分割线与代码块相邻、以代码块结尾。图片若上传失败,换成任意一张可访问的远程图即可。

### I7 手动检查(S6 跑完脚本后)

逐项记下「能 / 不能」:

1. 点击第一张图片**上方**,能否出现光标并输入文字?
2. 点击最后一个代码块**下方**的空白处,能否出现光标并输入文字?
3. 光标放在分割线前一段的末尾,按 ↓ 能否越过分割线到下一个代码块之后?
4. 两个相邻 atomic(分割线与代码块)之间,能否插入一个新段落?

## 脚本

```js
(() => {
  const box = (el) => {
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const attrs = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    aria: el.getAttribute('aria-label'),
    ph: el.getAttribute('placeholder'),
    testid: el.getAttribute('data-testid'),
    role: el.getAttribute('role'),
    ce: el.getAttribute('contenteditable'),
    ...box(el),
  });
  const testidPath = (el, n = 6) => {
    const out = [];
    for (let p = el.parentElement; p && out.length < n; p = p.parentElement) {
      const t = p.getAttribute('data-testid');
      if (t) out.push(t);
    }
    return out;
  };

  // 与 injector.ts EDITOR_SELECTOR_TIERS / findEditorElement 同口径
  const TIERS = [
    "[contenteditable='true'][data-testid='composer']",
    "[contenteditable='true'].public-DraftEditor-content",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true']",
  ];
  let editor = null;
  let editorTier = null;
  for (const [i, sel] of TIERS.entries()) {
    let best = null;
    let area = 0;
    for (const el of document.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect();
      if (b.width <= 200 || b.height <= 80) continue;
      if (b.width * b.height > area) {
        best = el;
        area = b.width * b.height;
      }
    }
    if (best) {
      editor = best;
      editorTier = i;
      break;
    }
  }

  const out = {
    path: location.pathname,
    htmlLang: document.documentElement.lang,
    navLang: navigator.language,
    at: new Date().toISOString(),
    editor: editor ? { tier: editorTier, ...attrs(editor) } : null,
  };

  // E1 · 标题框(I5):全部候选 + 按 scoreTitleField 打分 + 插件会选中的那个
  const cands = [...document.querySelectorAll("input, textarea, [contenteditable='true'], [contenteditable='']")]
    .filter((el) => el !== editor)
    .map((el) => {
      const a = attrs(el);
      const hints = [a.aria, a.ph, a.testid].filter(Boolean).join(' ').toLowerCase();
      const visible = a.w > 0 && a.h > 0;
      const keyword = /title|标题/.test(hints);
      const score = visible && keyword ? 10 + (a.top < 240 ? 3 : 0) + (a.w > 240 ? 2 : 0) : 0;
      return { ...a, visible, keyword, score, path: testidPath(el, 3) };
    });
  const pick = cands.reduce((best, c) => (c.score > (best?.score ?? 0) ? c : best), null);
  out.E1 = { pick, candidates: cands };

  // E2 · 封面(I6):file input(插件只认 accept 含 image 且不含 video 的那个)+ 封面区域可能的按钮
  out.E2 = {
    fileInputs: [...document.querySelectorAll('input[type="file"]')].map((inp) => ({
      accept: inp.getAttribute('accept'),
      multiple: inp.multiple,
      testid: inp.getAttribute('data-testid'),
      isPluginCoverInput: /image/i.test(inp.accept || '') && !/video/i.test(inp.accept || ''),
      path: testidPath(inp),
    })),
    coverishElements: [...document.querySelectorAll('[data-testid], [aria-label]')]
      .filter((el) => /cover|header|banner|封面|media|photo|image|カバー|portada/i.test(
        `${el.getAttribute('data-testid') || ''} ${el.getAttribute('aria-label') || ''}`,
      ))
      .filter((el) => !editor || !editor.contains(el))
      .slice(0, 30)
      .map((el) => ({ ...attrs(el), path: testidPath(el, 3) })),
    imgsAboveEditor: editor
      ? [...document.querySelectorAll('img')]
          .filter((img) => img.getBoundingClientRect().bottom <= editor.getBoundingClientRect().top + 1)
          .filter((img) => img.getBoundingClientRect().width > 120)
          .map((img) => ({ host: (() => { try { return new URL(img.src).host; } catch { return null; } })(), ...box(img), path: testidPath(img, 3) }))
      : [],
  };

  // E3 · 正文块结构(I7):从 Draft editorState 读块类型(与 injector findDraftStateNode 同口径)+ DOM 上 atomic 是否不可编辑
  try {
    const key = editor && Object.keys(editor).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let fiber = key ? editor[key] : null;
    let node = null;
    for (let d = 0; d < 80 && fiber; d += 1) {
      const sn = fiber.stateNode;
      if (sn?.props?.editorState && typeof sn.props.onChange === 'function') {
        node = sn;
        break;
      }
      fiber = fiber.return;
    }
    if (!node) {
      out.E3 = { error: 'draft state node not found' };
    } else {
      const content = node.props.editorState.getCurrentContent();
      const blocks = content.getBlockMap().toArray().map((b, i) => {
        let entity = null;
        try {
          const ek = b.getLength() ? b.getEntityAt(0) : null;
          entity = ek ? content.getEntity(ek).getType() : null;
        } catch { /* 无实体 */ }
        return { i, type: b.getType(), len: b.getLength(), entity };
      });
      const domBlocks = [...editor.querySelectorAll('[data-block="true"]')];
      out.E3 = {
        count: blocks.length,
        head: blocks.slice(0, 4),
        tail: blocks.slice(-4),
        adjacentAtomic: blocks.filter((b, i) => i > 0 && b.type === 'atomic' && blocks[i - 1].type === 'atomic').map((b) => b.i),
        domAtomic: domBlocks
          .map((el, i) => ({ i, ce: el.querySelector('[contenteditable="false"]') ? 'has-false' : null, cls: (el.className || '').toString().slice(0, 60) }))
          .filter((d) => d.ce),
      };
    }
  } catch (err) {
    out.E3 = { error: String(err) };
  }

  // E4 · 滚动到顶部(I4):content.ts 现取文档里第一个 [contenteditable="true"],看它是不是正文编辑器
  const firstCE = document.querySelector('[contenteditable="true"]');
  const scrollParent = (el) => {
    for (let p = el?.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (p.scrollHeight > p.clientHeight && (oy === 'auto' || oy === 'scroll')) return p;
    }
    return null;
  };
  out.E4 = {
    firstIsEditor: firstCE === editor,
    first: firstCE ? attrs(firstCE) : null,
    sameScrollContainer: scrollParent(firstCE) === scrollParent(editor),
    allContentEditable: [...document.querySelectorAll('[contenteditable="true"]')].map((el) => ({ isEditor: el === editor, ...attrs(el) })),
  };

  console.log(out);
  try {
    copy(JSON.stringify(out, null, 2));
    console.log('[MarkFlow 取证] 结果已复制到剪贴板');
  } catch {
    console.log('[MarkFlow 取证] 自动复制失败,请右键上方对象 → Copy object');
  }
  return out;
})();
```

## 结果怎么判(我拿到输出后据此定修法)

- **I5**:S2 的 `E1.pick` 为 null、而某个候选 `keyword:false` 却明显是标题框 → 关键词门槛在非中英界面失效,改按该框稳定的 `data-testid` / 结构定位;若 `testid` 本身含 title,则 I5 不成立、关闭。
- **I6**:S5 的 `E2.fileInputs` 里没有 `isPluginCoverInput:true` → 已有封面时输入不渲染,确认 I6;再看 `coverishElements` 里有没有稳定的「更换 / 移除封面」按钮,决定是走「先移除再设」还是「已有封面时如实报 skipped、不计失败」。若 S5 仍有封面输入,I6 不成立、关闭。
- **I7**:S6 手动检查有「不能」→ 确认 I7;S7 的 `E3` 若显示 X 原生插入会在 atomic 前后补 `unstyled` 空块,修法就照做(首尾 / 相邻 atomic 补空段落);都「能」则关闭。
- **I4**:S1 的 `E4.firstIsEditor:false` 且 `sameScrollContainer:false` → 确认会滚错容器,按方案改用编辑器同口径定位;否则仍按方案统一选择器(低风险),但降为顺手修。
