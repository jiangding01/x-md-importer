/**
 * 全部导入相关设置项 · 移植自设计稿 state.opts 与 §5.2.4。
 * 注意：`appearance`（外观）与 `lang`（语言）属界面偏好，归 PrefsProvider 管理，不在此。
 */

export interface Options {
  // 01 界面
  editorFont: 'sm' | 'md' | 'lg';
  wrap: boolean;
  // 02 导入行为
  onExisting: 'ask' | 'append' | 'overwrite';
  strict: boolean;
  imgFail: 'skip' | 'abort';
  pace: 'steady' | 'fast';
  scrollTop: boolean;
  autoReport: 'always' | 'anomaly' | 'never';
  // 03 标题与封面
  setTitle: boolean;
  titleConflict: 'ask' | 'overwrite' | 'keep';
  h1Handle: 'remove' | 'keep';
  setCover: boolean;
  coverKeep: 'keep' | 'remove';
  // 04 内容转换
  tableStrategy: 'native' | 'mdblock' | 'image';
  codeStrategy: 'native' | 'image' | 'quote';
  codeLang: 'plaintext' | 'javascript' | 'python' | 'bash';
  h4Plus: 'bold' | 'sub';
  inlineCode: 'backtick' | 'unicode' | 'text';
  tweetUrl: 'embed' | 'link';
  divider: 'divider' | 'ignore';
  taskList: 'symbol' | 'plain';
  footnote: 'list' | 'ignore';
  htmlBlock: 'text' | 'ignore';
  obsidianImg: boolean;
  wikilink: boolean;
  punct: boolean;
  zhConvert: 'off' | 's2t' | 't2s';
  // 05 图片与媒体
  folder: boolean;
  /** 已连接文件夹的显示名(未连接为 null);随 folder 语义同步更新。 */
  folderName: string | null;
  compress: boolean;
  maxEdge: '960' | '1280' | '1600' | 'orig';
  quality: '60' | '70' | '82' | '90' | '95';
  altCaption: boolean;
  // 06 成功反馈
  confetti: boolean;
  sound: boolean;
  soundStyle: 'soft' | 'crisp' | 'mute';
  // 07 记录与数据
  histLimit: '50' | '200' | 'inf';
  // 09 高级
  graphql: boolean;
  concurrency: '1' | '2' | '3' | '4' | '5';
  retries: '0' | '1' | '3' | '5';
}

export const defaultOptions: Options = {
  editorFont: 'md',
  wrap: true,
  onExisting: 'ask',
  strict: false,
  imgFail: 'skip',
  pace: 'steady',
  scrollTop: true,
  autoReport: 'anomaly',
  setTitle: true,
  titleConflict: 'ask',
  h1Handle: 'remove',
  setCover: false,
  coverKeep: 'keep',
  tableStrategy: 'native',
  codeStrategy: 'native',
  codeLang: 'plaintext',
  h4Plus: 'bold',
  inlineCode: 'backtick',
  tweetUrl: 'embed',
  divider: 'divider',
  taskList: 'symbol',
  footnote: 'list',
  htmlBlock: 'text',
  obsidianImg: true,
  wikilink: true,
  punct: false,
  zhConvert: 'off',
  folder: false,
  folderName: null,
  compress: true,
  maxEdge: '1280',
  quality: '82',
  altCaption: true,
  confetti: true,
  sound: true,
  soundStyle: 'soft',
  histLimit: '200',
  graphql: false,
  concurrency: '3',
  retries: '3',
};
