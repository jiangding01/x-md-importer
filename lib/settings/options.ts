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
  scrollTop: boolean;
  autoReport: 'always' | 'anomaly' | 'never';
  // 03 标题与封面
  setTitle: boolean;
  titleConflict: 'ask' | 'overwrite' | 'keep';
  h1Handle: 'remove' | 'keep';
  setCover: boolean;
  coverKeep: 'keep' | 'remove';
  // 04 内容转换
  codeStrategy: 'native' | 'image' | 'quote';
  codeLang: 'plaintext' | 'javascript' | 'python' | 'bash';
  taskList: 'symbol' | 'plain';
  obsidianImg: boolean;
  wikilink: boolean;
  punct: boolean;
  zhConvert: 'off' | 's2t' | 't2s';
  // 05 图片与媒体
  /** 设置里的「默认文件夹」(persistent 作用域)是否已连接;兜底级。 */
  folder: boolean;
  /** 已连接默认文件夹的显示名(未连接为 null);随 folder 语义同步更新。 */
  folderName: string | null;
  /** 素材板「当前文章文件夹」(active 作用域)是否已连接;优先级高于 folder。 */
  activeFolder: boolean;
  /** 已连接当前文章文件夹的显示名(未连接为 null);随 activeFolder 语义同步更新。 */
  activeFolderName: string | null;
  compress: boolean;
  maxEdge: '960' | '1280' | '1600' | 'orig';
  quality: '60' | '70' | '82' | '90' | '95';
  // 06 成功反馈
  confetti: boolean;
  sound: boolean;
  soundStyle: 'soft' | 'crisp' | 'mute';
  // 07 记录与数据
  histLimit: '50' | '200' | 'inf';
  // 09 高级
  concurrency: '1' | '2' | '3' | '4' | '5';
  retries: '0' | '1' | '3' | '5';
}

export const defaultOptions: Options = {
  editorFont: 'md',
  wrap: true,
  onExisting: 'ask',
  scrollTop: true,
  autoReport: 'anomaly',
  setTitle: true,
  titleConflict: 'ask',
  h1Handle: 'remove',
  setCover: false,
  coverKeep: 'keep',
  codeStrategy: 'native',
  codeLang: 'plaintext',
  taskList: 'symbol',
  obsidianImg: true,
  wikilink: true,
  punct: false,
  zhConvert: 'off',
  folder: false,
  folderName: null,
  activeFolder: false,
  activeFolderName: null,
  compress: true,
  maxEdge: '1280',
  quality: '82',
  confetti: true,
  sound: true,
  soundStyle: 'soft',
  histLimit: '200',
  concurrency: '3',
  retries: '3',
};
