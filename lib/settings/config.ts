/**
 * 设置页九组配置 · 逐条移植自设计稿 settingsConfig() 与《技术方案设计.md》§5.2.4。
 * key 对应 Options 字段；'lang' / 'appearance' 为特例，映射到 prefs（语言 / 外观）。
 */

export type SelectOption = { v: string; label: string };

/**
 * disabled=true 表示该项**尚未接入真实实现**(装饰开关):UI 置灰、不可交互——
 * 诚实呈现「当前不可配 / 规划中」,不让用户误以为改了生效。toggle 置灰固定显示 off;
 * select 置灰固定显示「生效档」(opts 首位),不读可能过期的存储值。
 */
export type SettingRow =
  | { k: string; t: 'toggle'; label: string; desc: string; disabled?: boolean }
  | { k: string; t: 'select'; label: string; desc: string; opts: SelectOption[]; disabled?: boolean }
  | { k: string; t: 'action'; label: string; desc: string; actLabel: string; danger?: boolean; disabled?: boolean };

export interface SettingSection {
  id: string;
  num: string;
  title: string;
  rows: SettingRow[];
}

interface ConfigCtx {
  en: boolean;
  folderConnected: boolean;
  /** 已连接文件夹的显示名(未连接为 null)。 */
  folderName: string | null;
  wipeArm: boolean;
}

export function settingsConfig({ en, folderConnected, folderName, wipeArm }: ConfigCtx): SettingSection[] {
  const T = (zh: string, e: string) => (en ? e : zh);
  const o = (v: string, zh: string, e: string): SelectOption => ({ v, label: en ? e : zh });

  return [
    {
      id: 'ui',
      num: '01',
      title: T('界面', 'Interface'),
      rows: [
        { k: 'lang', t: 'select', label: T('语言', 'Language'), desc: T('侧边栏界面语言。', 'Sidebar language.'), opts: [o('auto', '跟随浏览器', 'Follow browser'), o('zh', '中文', '中文'), o('en', 'English', 'English')] },
        { k: 'appearance', t: 'select', label: T('外观', 'Appearance'), desc: T('浅色/暗色;「控制台」固定暗色、「纸感」固定浅色。', 'Light/dark; Console is dark-only, Paper light-only.'), opts: [o('system', '跟随系统', 'System'), o('light', '浅色', 'Light'), o('dark', '暗色', 'Dark')] },
        { k: 'editorFont', t: 'select', label: T('编辑框字号', 'Editor font size'), desc: T('Markdown 编辑框文字大小。', 'Markdown editor text size.'), opts: [o('sm', '小', 'S'), o('md', '中', 'M'), o('lg', '大', 'L')] },
        { k: 'wrap', t: 'toggle', label: T('自动换行', 'Word wrap'), desc: T('编辑框内长行自动换行。', 'Wrap long lines in the editor.') },
      ],
    },
    {
      id: 'behavior',
      num: '02',
      title: T('导入行为', 'Import behavior'),
      rows: [
        { k: 'onExisting', t: 'select', label: T('编辑器已有内容时', 'When editor has content'), desc: T('写入前如何处理已有草稿。', 'How to handle an existing draft.'), opts: [o('ask', '每次询问', 'Always ask'), o('append', '总是追加', 'Always append'), o('overwrite', '总是覆盖', 'Always overwrite')] },
        { k: 'strict', t: 'toggle', disabled: true, label: T('严格模式', 'Strict mode'), desc: T('任何降级前逐项确认;关闭则自动降级并在报告中说明。（规划中）', 'Confirm every degradation; off = auto-degrade with report. (planned)') },
        { k: 'imgFail', t: 'select', disabled: true, label: T('图片失败时', 'On image failure'), desc: T('保留原文兜底、跳过继续（当前固定）。', 'Keep source text as fallback, skip & continue (fixed).'), opts: [o('skip', '跳过继续', 'Skip & continue')] },
        { k: 'pace', t: 'select', disabled: true, label: T('写入节奏', 'Write pace'), desc: T('快速会缩短块间等待,超长文慎用。（规划中）', 'Fast shortens waits; careful with long docs. (planned)'), opts: [o('steady', '稳妥', 'Steady'), o('fast', '快速', 'Fast')] },
        { k: 'scrollTop', t: 'toggle', label: T('完成后滚动到顶部', 'Scroll to top when done'), desc: T('写入完成后回到文章开头。', 'Return to the top after writing.') },
        { k: 'autoReport', t: 'select', label: T('自动展开导入报告', 'Auto-expand report'), desc: T('导入完成后是否自动展开报告。', 'Expand the report automatically.'), opts: [o('always', '总是', 'Always'), o('anomaly', '仅异常时', 'On anomaly'), o('never', '从不', 'Never')] },
      ],
    },
    {
      id: 'title',
      num: '03',
      title: T('标题与封面', 'Title & cover'),
      rows: [
        { k: 'setTitle', t: 'toggle', label: T('设置文章标题', 'Set article title'), desc: T('优先级:frontmatter title > 首个 H1 > 文件名。', 'Priority: frontmatter > first H1 > filename.') },
        { k: 'titleConflict', t: 'select', label: T('已有标题时', 'On existing title'), desc: T('编辑器已有标题的处理方式。', 'When the editor already has a title.'), opts: [o('ask', '询问', 'Ask'), o('overwrite', '覆盖', 'Overwrite'), o('keep', '保留原标题', 'Keep original')] },
        { k: 'h1Handle', t: 'select', label: T('H1 处理', 'H1 handling'), desc: T('用作标题后是否从正文移除。', 'Remove from body after using as title.'), opts: [o('remove', '移除', 'Remove'), o('keep', '保留在正文', 'Keep in body')] },
        { k: 'setCover', t: 'toggle', label: T('设置文章封面', 'Set article cover'), desc: T('来源:frontmatter cover > 正文首图。', 'Source: frontmatter cover > first image.') },
        { k: 'coverKeep', t: 'select', label: T('首图用作封面后', 'First image as cover'), desc: T('该图在正文中的去留。', 'Keep or remove it from the body.'), opts: [o('keep', '正文保留', 'Keep'), o('remove', '从正文移除', 'Remove')] },
      ],
    },
    {
      id: 'convert',
      num: '04',
      title: T('内容转换', 'Content conversion'),
      rows: [
        { k: 'tableStrategy', t: 'select', disabled: true, label: T('表格策略', 'Tables'), desc: T('原生表格,X 直接渲染（当前固定）。', 'Native table, rendered by X (fixed).'), opts: [o('native', '原生表格', 'Native table')] },
        { k: 'codeStrategy', t: 'select', disabled: true, label: T('代码块策略', 'Code blocks'), desc: T('原生代码块带语言标注（当前固定）。', 'Native code block with language (fixed).'), opts: [o('native', '原生代码块', 'Native')] },
        { k: 'codeLang', t: 'select', label: T('代码块默认语言', 'Default code language'), desc: T('无语言标注的 fence 使用。', 'Used for unlabeled fences.'), opts: [o('plaintext', 'plaintext', 'plaintext'), o('javascript', 'javascript', 'javascript'), o('python', 'python', 'python'), o('bash', 'bash', 'bash')] },
        { k: 'h4Plus', t: 'select', disabled: true, label: T('#### 以下标题', 'H4+ headings'), desc: T('X 仅两级标题,更深层级用粗体段落（当前固定）。', 'X has only two heading levels; deeper use bold paragraph (fixed).'), opts: [o('bold', '粗体段落', 'Bold paragraph')] },
        { k: 'inlineCode', t: 'select', disabled: true, label: T('行内代码', 'Inline code'), desc: T('X 正文不支持行内代码,保留反引号(当前固定)。', 'X body has no inline code; keep backticks (fixed).'), opts: [o('backtick', '保留反引号', 'Keep backticks')] },
        { k: 'tweetUrl', t: 'select', disabled: true, label: T('推文 URL(独行)', 'Tweet URL (own line)'), desc: T('嵌入推文卡片（当前固定）。', 'Embed tweet card (fixed).'), opts: [o('embed', '嵌入卡片', 'Embed card')] },
        { k: 'divider', t: 'select', disabled: true, label: T('分割线 ---', 'Divider ---'), desc: T('转 DIVIDER 原生块（当前固定）。', 'Native DIVIDER block (fixed).'), opts: [o('divider', 'DIVIDER 块', 'DIVIDER block')] },
        { k: 'taskList', t: 'select', disabled: true, label: T('任务列表 - [ ]', 'Task lists'), desc: T('☑/☐ 符号列表或普通列表。（规划中）', 'Symbol list or plain list. (planned)'), opts: [o('symbol', '符号列表', 'Symbol list'), o('plain', '普通列表', 'Plain list')] },
        { k: 'footnote', t: 'select', disabled: true, label: T('GFM 脚注', 'GFM footnotes'), desc: T('转文末「注释」编号列表。（规划中）', 'Endnotes list at the bottom. (planned)'), opts: [o('list', '文末列表', 'Endnotes'), o('ignore', '忽略', 'Ignore')] },
        { k: 'htmlBlock', t: 'select', disabled: true, label: T('内嵌 HTML 块', 'Inline HTML'), desc: T('剥离标签保留文本,或整块忽略。（规划中）', 'Strip tags keep text, or drop. (planned)'), opts: [o('text', '保留文本', 'Keep text'), o('ignore', '整块忽略', 'Drop block')] },
        { k: 'obsidianImg', t: 'toggle', label: T('Obsidian 图片嵌入', 'Obsidian embeds'), desc: T('识别 ![[图片]] 语法(本地文件夹解析)。', 'Recognize ![[image]] syntax.') },
        { k: 'wikilink', t: 'toggle', label: T('Wikilink 转纯文本', 'Wikilinks to text'), desc: T('[[wikilink]] 转为纯文本。', 'Convert [[wikilink]] to text.') },
        { k: 'punct', t: 'toggle', disabled: true, label: T('智能标点', 'Smart punctuation'), desc: T('修正中文标点,保护代码/链接/URL 区域。（规划中）', 'Fix CJK punctuation; protect code & URLs. (planned)') },
        { k: 'zhConvert', t: 'select', disabled: true, label: T('简繁转换', 'Chinese conversion'), desc: T('写入前的字形转换。（规划中）', 'Script conversion before writing. (planned)'), opts: [o('off', '关', 'Off'), o('s2t', '简→繁', 'S→T'), o('t2s', '繁→简', 'T→S')] },
      ],
    },
    {
      id: 'media',
      num: '05',
      title: T('图片与媒体', 'Images & media'),
      rows: [
        {
          k: 'folder',
          t: 'action',
          label: T('本地图片文件夹', 'Local image folder'),
          // 三态:已连接 / 未连接但 handle 仍在(浏览器重启权限回落,可一键恢复)/ 从未连接。
          desc: folderConnected
            ? T(`已连接:${folderName ?? ''}`, `Connected: ${folderName ?? ''}`)
            : folderName
              ? T(`需重新授权:${folderName}(浏览器重启后权限回落)`, `Needs re-auth: ${folderName} (permission lapsed after restart)`)
              : T('尚未连接。连接后可在 X 文章页写入本地图片。', 'Not connected. Connect to write local images on the X article page.'),
          actLabel: folderConnected ? T('清除', 'Clear') : folderName ? T('恢复', 'Resume') : T('连接', 'Connect'),
        },
        { k: 'compress', t: 'toggle', label: T('图片压缩', 'Image compression'), desc: T('>150KB 才压;上传更快、更抗限流。', 'Only if >150KB; faster & safer uploads.') },
        { k: 'maxEdge', t: 'select', label: T('最大长边', 'Max long edge'), desc: T('压缩时的尺寸上限。', 'Size cap when compressing.'), opts: [o('960', '960px', '960px'), o('1280', '1280px', '1280px'), o('1600', '1600px', '1600px'), o('orig', '原图', 'Original')] },
        { k: 'quality', t: 'select', label: T('压缩质量', 'Quality'), desc: T('JPEG 质量(60-95)。', 'JPEG quality (60-95).'), opts: [o('60', '60', '60'), o('70', '70', '70'), o('82', '82(推荐)', '82 (rec.)'), o('90', '90', '90'), o('95', '95', '95')] },
        { k: 'altCaption', t: 'toggle', disabled: true, label: T('alt 写入图片描述', 'Alt → image ALT'), desc: T('X 的 ALT 走后端、无法可靠写入。（暂不支持）', 'X stores ALT server-side; not reliably writable. (unavailable)') },
      ],
    },
    {
      id: 'feedback',
      num: '06',
      title: T('成功反馈', 'Success feedback'),
      rows: [
        { k: 'confetti', t: 'toggle', label: T('庆祝动画', 'Celebration'), desc: T('写入完成时页面内短暂动画。', 'Brief animation on completion.') },
        { k: 'sound', t: 'toggle', label: T('完成音效', 'Completion sound'), desc: T('写入成功后播放一声本地提示音。', 'Short local chime on success.') },
        { k: 'soundStyle', t: 'select', label: T('音效风格', 'Sound style'), desc: T('提示音的听感。', 'Chime character.'), opts: [o('soft', '轻柔提示', 'Gentle'), o('crisp', '清脆叮声', 'Crisp'), o('mute', '静音脉冲', 'Silent')] },
      ],
    },
    {
      id: 'data',
      num: '07',
      title: T('记录与数据', 'History & data'),
      rows: [
        { k: 'histLimit', t: 'select', label: T('记录保留上限', 'History limit'), desc: T('超出后自动清理最旧记录。', 'Oldest records pruned beyond limit.'), opts: [o('50', '50', '50'), o('200', '200', '200'), o('inf', '不限', 'Unlimited')] },
        { k: 'backup', t: 'action', label: T('备份与恢复', 'Backup & restore'), desc: T('导出/导入全部设置与记录(JSON,本地文件)。', 'Export/import all settings & history (local JSON).'), actLabel: T('导出', 'Export') },
        { k: 'wipe', t: 'action', danger: true, label: T('清除所有数据', 'Erase all data'), desc: T('删除全部草稿、记录与设置,不可恢复。', 'Deletes drafts, history & settings. Irreversible.'), actLabel: wipeArm ? T('确认清除?', 'Confirm?') : T('清除', 'Erase') },
      ],
    },
    {
      id: 'keys',
      num: '08',
      title: T('快捷键', 'Shortcuts'),
      rows: [
        { k: 'shortcuts', t: 'action', label: T('打开侧边栏 / 一键写入', 'Open panel / quick write'), desc: T('在 chrome://extensions/shortcuts 中自定义。', 'Customize at chrome://extensions/shortcuts.'), actLabel: T('前往设置', 'Open') },
      ],
    },
    {
      id: 'adv',
      num: '09',
      title: T('高级', 'Advanced'),
      rows: [
        { k: 'graphql', t: 'toggle', disabled: true, label: T('GraphQL 增强通道', 'GraphQL channel'), desc: T('标题/封面直写 X 私有接口。接口脆弱,默认关闭。（规划中）', 'Writes title/cover via private API. Fragile; off by default. (planned)') },
        { k: 'concurrency', t: 'select', label: T('图片准备并发', 'Image concurrency'), desc: T('并行准备图片的数量。', 'Parallel image preparation.'), opts: [o('1', '1', '1'), o('2', '2', '2'), o('3', '3', '3'), o('4', '4', '4'), o('5', '5', '5')] },
        { k: 'retries', t: 'select', disabled: true, label: T('重试次数', 'Retries'), desc: T('图片抓取/上传失败的重试。（规划中）', 'Retries for fetch/upload failures. (planned)'), opts: [o('0', '0', '0'), o('1', '1', '1'), o('3', '3', '3'), o('5', '5', '5')] },
        { k: 'diag', t: 'action', label: T('诊断面板', 'Diagnostics'), desc: T('探针快照查看/导出 JSON(报障用)。', 'Probe snapshot / export JSON.'), actLabel: T('导出快照', 'Export') },
      ],
    },
  ];
}
