import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useConnection } from '@/lib/bridge/useConnection';
import { useProbe } from '@/lib/bridge/useProbe';
import { importToXTab, setTitleOnXTab } from '@/lib/bridge/importArticle';
import { requestRemoteImagePermissions } from '@/lib/bridge/imagePermissions';
import type { ImageBlock, ImportMode, SetTitleResponse } from '@/lib/bridge/protocol';
import { capability, firstTitle } from '@/lib/markdown/capability';
import { extractCover, extractTitle, stripFirstH1 } from '@/lib/markdown/frontmatter';
import { parseMarkdown } from '@/lib/markdown/parser';
import { sampleEn, sampleZh } from '@/lib/markdown/sample';
import { saveDraft } from '@/lib/storage/draftStore';
import { saveHistory, type HistoryItem } from '@/lib/storage/historyStore';
import type { Tab } from '@/entrypoints/sidepanel/types';
import type { Dict } from '@/lib/i18n/dict';

type Mode = 'edit' | 'preview';

interface WorkspaceValue {
  // 全局
  tab: Tab;
  setTab: (tab: Tab) => void;
  toast: string | null;
  showToast: (msg: string) => void;
  // 草稿
  md: string;
  setMd: (md: string) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  save: () => void;
  clear: () => void;
  clearArm: boolean;
  loadSample: () => void;
  readFile: (file: File | null | undefined) => void;
  // 能力映射折叠
  capOpen: boolean;
  toggleCap: () => void;
  // 预检
  checkVisible: boolean;
  checkStep: number;
  runCheck: () => void;
  closeCheck: () => void;
  // 导入
  importing: boolean;
  stageIdx: number;
  stagePct: number;
  stageLabel: string;
  writeX: () => void;
  askOverwrite: boolean;
  overwriteAppend: () => void;
  overwriteConfirm: () => void;
  overwriteCancel: () => void;
  editorHasContent: boolean;
  // 标题冲突询问(titleConflict='ask' 且编辑器已有标题时,写入后按需弹出)
  askTitleOverwrite: boolean;
  pendingTitle: string | null; // 待写入的新标题(弹窗内显示)
  titleOverwriteConfirm: () => void; // 覆盖为新标题
  titleOverwriteKeep: () => void; // 保留原标题
  // 报告 / 庆祝
  reportVisible: boolean;
  closeReport: () => void;
  celebrating: boolean;
  // 记录
  history: HistoryItem[];
  histQ: string;
  setHistQ: (q: string) => void;
  loadHistoryItem: (item: HistoryItem) => void;
  copyHistoryItem: (item: HistoryItem) => void;
  deleteHistoryItem: (id: number) => void;
  clearHistory: () => void;
  histClearArm: boolean;
  wipeAll: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

interface Timers {
  toast?: ReturnType<typeof setTimeout>;
  check?: ReturnType<typeof setTimeout>;
  celebrate?: ReturnType<typeof setTimeout>;
  clearArm?: ReturnType<typeof setTimeout>;
  histArm?: ReturnType<typeof setTimeout>;
}

/** 把注入引擎的英文错误短语归类为可读中文/英文文案。 */
function importErrorText(error: string, t: Dict): string {
  if (error === 'disconnected') return t.errDisconnected;
  if (error === 'no-injector') return t.errNoInjector;
  if (error === 'timeout') return t.errTimeout;
  // 其他 injector 层错误:统一「写入失败」并附上原始短语,便于诊断。
  return `${t.errWriteFail}: ${error}`;
}

/** 把标题设置结果归类为可读文案。applied:false 属正常(keep 命中已有标题)。 */
function titleResultText(res: SetTitleResponse, t: Dict): string {
  if (res.ok) return res.applied ? t.titleSet : t.titleKept;
  // 标题框未找到单列一类。
  if (res.error.includes('not found')) return t.titleFieldMissing;
  // 通道层错误(未连接/未就绪/超时)复用与正文一致的本地化,不把英文诊断码泄漏给用户。
  if (res.error === 'disconnected') return `${t.titleFail}: ${t.errDisconnected}`;
  if (res.error === 'no-injector') return `${t.titleFail}: ${t.errNoInjector}`;
  if (res.error === 'timeout') return `${t.titleFail}: ${t.errTimeout}`;
  return `${t.titleFail}: ${res.error}`;
}

interface WorkspaceProviderProps {
  initialMd?: string;
  initialHistory?: HistoryItem[];
  children: ReactNode;
}

export function WorkspaceProvider({
  initialMd = '',
  initialHistory = [],
  children,
}: WorkspaceProviderProps) {
  const { t, lang } = useI18n();
  const { opts } = useSettings();
  // review #6:editorHasContent 改为真实探针派生值(hasContent),不再是写死的 mock。
  const { connected, hasContent: editorHasContent } = useConnection();
  // 写入成功后需重探,让 hasContent 反映「编辑器现在有内容了」(探针默认只挂载探一次)。
  const { refresh: refreshProbe } = useProbe();
  const en = lang === 'en';

  const [tab, setTab] = useState<Tab>('draft');
  const [toast, setToast] = useState<string | null>(null);
  const [md, setMdState] = useState(initialMd);
  const [mode, setMode] = useState<Mode>('edit');
  const [dragging, setDragging] = useState(false);
  const [clearArm, setClearArm] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [checkVisible, setCheckVisible] = useState(false);
  const [checkStep, setCheckStep] = useState(-1);
  const [importing, setImporting] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [stagePct, setStagePct] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [reportVisible, setReportVisible] = useState(false);
  const [askOverwrite, setAskOverwrite] = useState(false);
  const [askTitleOverwrite, setAskTitleOverwrite] = useState(false);
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [histQ, setHistQ] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  // history 的最新值镜像:finishImport 可能在标题 ask 弹窗挂起(等用户输入,时长任意)后才收尾,
  // 期间用户若在「记录」页删改历史,闭包捕获的 history 会陈旧——finishImport 改读 ref 避免用旧值
  // commit 覆盖 storage、复活已删条目。所有写入都经 commitHistory 同步此 ref。
  const historyRef = useRef<HistoryItem[]>(initialHistory);
  const [histClearArm, setHistClearArm] = useState(false);

  const timers = useRef<Timers>({});
  // 标题冲突询问的 resolver:startImport 弹窗时存入,用户点覆盖/保留时兑现,恢复 async 流程。
  const titleAskResolver = useRef<((overwrite: boolean) => void) | null>(null);
  // 同步闸门:防极快双击并发触发两次 startImport(React state 的 importing 更新是异步的,
  // 双击间隔内两次 writeX 都可能读到陈旧的 importing=false)。ref 写入同步生效,
  // 只做「进入即锁、结束即解」的闸门作用,UI 展示仍用 importing state。
  const importingRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    if (timers.current.toast) clearTimeout(timers.current.toast);
    setToast(msg);
    timers.current.toast = setTimeout(() => setToast(null), 2200);
  }, []);

  const setMd = useCallback((v: string) => {
    setMdState(v);
    void saveDraft(v);
    // 内容一变,旧预检 / 导入报告就不对应当前 md 了 → 一并收起,不残留过期结果。
    // setMd 是所有「内容替换」的唯一入口(清空 / 载入示例 / 读文件 / 载入历史 / 编辑输入),放这一处全覆盖。
    // 写入流程 startImport 不经 setMd(它自行 setReportVisible(true)),故不会把刚出的报告清掉。
    setCheckVisible(false);
    setCheckStep(-1);
    setReportVisible(false);
  }, []);

  const commitHistory = useCallback((next: HistoryItem[]) => {
    historyRef.current = next; // 同步镜像,供挂起后的 finishImport 读最新值
    setHistory(next);
    void saveHistory(next);
  }, []);

  const playSound = useCallback(() => {
    if (!opts.sound || opts.soundStyle === 'mute') return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = opts.soundStyle === 'crisp' ? 1180 : 740;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      /* WebAudio 不可用则静默 */
    }
  }, [opts.sound, opts.soundStyle]);

  // ── 草稿动作 ──
  const save = useCallback(() => {
    void saveDraft(md);
    showToast(t.savedToast);
  }, [md, showToast, t.savedToast]);

  const clear = useCallback(() => {
    if (!clearArm) {
      setClearArm(true);
      if (timers.current.clearArm) clearTimeout(timers.current.clearArm);
      timers.current.clearArm = setTimeout(() => setClearArm(false), 2600);
      return;
    }
    setClearArm(false);
    setMd('');
    showToast(t.clearedToast);
  }, [clearArm, setMd, showToast, t.clearedToast]);

  const loadSample = useCallback(() => {
    setMd(en ? sampleEn : sampleZh);
    setMode('edit');
  }, [en, setMd]);

  const readFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setMd(String(reader.result));
        setMode('edit');
        setDragging(false);
        showToast(`${t.importedToast} · ${file.name}`);
      };
      reader.readAsText(file);
    },
    [setMd, showToast, t.importedToast],
  );

  // ── 预检 ──
  const runCheck = useCallback(() => {
    setCheckVisible(true);
    setCheckStep(0);
    let step = 0;
    const tick = () => {
      step += 1;
      if (step > 5) return;
      setCheckStep(step);
      timers.current.check = setTimeout(tick, 260);
    };
    timers.current.check = setTimeout(tick, 260);
  }, []);

  const closeCheck = useCallback(() => {
    if (timers.current.check) clearTimeout(timers.current.check);
    setCheckVisible(false);
    setCheckStep(-1);
  }, []);

  // ── 导入 ──
  // toastMsg:成功收尾提示,默认「已写入」;标题/空替换场景由 startImport 组合后传入。
  const finishImport = useCallback((toastMsg: string = t.writtenToast, imageFail = 0) => {
    const cap = capability(md, en);
    const ok = cap.filter((c) => c.badge !== 'warn').reduce((a, c) => a + c.count, 0);
    const deg = cap.filter((c) => c.badge === 'warn').reduce((a, c) => a + c.count, 0);
    const now = new Date();
    const item: HistoryItem = {
      id: now.getTime(),
      title: firstTitle(md, en),
      date: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${now.toTimeString().slice(0, 5)}`,
      ok,
      deg,
      // 图片上传失败计入 fail(记录/报告如实反映),其余降级仍归 deg。
      fail: imageFail,
      md,
    };

    setImporting(false);
    setReportVisible(opts.autoReport !== 'never');

    const limit = opts.histLimit === 'inf' ? Infinity : Number(opts.histLimit);
    // 读 historyRef.current(最新值)而非闭包 history:标题 ask 弹窗挂起期间用户可能已在记录页
    // 删改历史,用陈旧闭包 commit 会复活已删条目并写回 storage(review P1)。
    const nextHistory = [item, ...historyRef.current];
    commitHistory(nextHistory.length > limit ? nextHistory.slice(0, limit) : nextHistory);

    if (opts.confetti) {
      setCelebrating(true);
      timers.current.celebrate = setTimeout(() => setCelebrating(false), 950);
    }
    showToast(toastMsg);
    playSound();
    // 写入成功后重探编辑器状态,更新 hasContent——否则「只探一次」的探针会让下次
    // ask 模式误判编辑器仍为空,直接静默 replace 覆盖刚写入的正文(review #3)。
    void refreshProbe();
    // history 不再进 deps:finishImport 改读 historyRef.current(最新镜像),不依赖闭包快照。
  }, [md, en, opts.autoReport, opts.histLimit, opts.confetti, commitHistory, showToast, t.writtenToast, playSound, refreshProbe]);

  // 真实写入:解析 → 送达 X tab → 按结果收尾。纯文本写入近乎瞬时,
  // 进度条只走「解析中 → 写入中 → 完成」三段真实阶段(不再用定时器编造百分比,
  // 条纹动画在 await 期间提供 indeterminate 观感)。
  // 标题冲突询问:弹窗并 await 用户选择(覆盖=true / 保留=false)。startImport 标题阶段调用它。
  // 定义在 startImport 之前——后者依赖它,顺序颠倒会 TDZ。
  const askTitleConflict = useCallback((title: string): Promise<boolean> => {
    return new Promise((resolve) => {
      titleAskResolver.current = resolve;
      setPendingTitle(title);
      setAskTitleOverwrite(true);
    });
  }, []);
  const settleTitleAsk = useCallback((overwrite: boolean) => {
    setAskTitleOverwrite(false);
    setPendingTitle(null);
    const resolve = titleAskResolver.current;
    titleAskResolver.current = null;
    resolve?.(overwrite);
  }, []);

  const startImport = useCallback(
    async (mode: ImportMode) => {
      // 同步闸门优先于一切:极快双击时第二次调用在这里直接短路,
      // 不会重复触发下载阶段(在任何 await 之前完成拦截)。
      if (importingRef.current) return;
      importingRef.current = true;
      setImporting(true);
      setReportVisible(false);
      setStageIdx(0);
      try {
        setStageLabel(t.stParse);
        setStagePct(40);
        // 以下全同步(无 await),放在权限申请(首个 await)之前不破坏用户手势。

        // 标题抽取放在解析前:既决定后续是否设置标题,也决定要不要移除正文首个 H1。
        // h1Handle=remove:在 md 文本层删那行 H1(不在 blocks 层按 type 删——parser 把 H1/H2
        // 都映射成 header-one,blocks 层无法区分,见 stripFirstH1 注释)。
        const extracted = opts.setTitle ? extractTitle(md) : null;
        const bodyMd = extracted?.source === 'h1' && opts.h1Handle === 'remove' ? stripFirstH1(md) : md;
        let blocks = parseMarkdown(bodyMd, { obsidianImg: opts.obsidianImg, wikilink: opts.wikilink });

        // 封面来源:frontmatter cover > 正文首图。首图取自**已解析 blocks 的首个 ImageBlock**——
        // 与实际上传/移除同源,避免用 images() 全文正则误选到内联图 / 代码块内的图(review #1)。
        let coverSource: string | null = null;
        if (opts.setCover) {
          const fmCover = extractCover(md);
          if (fmCover) {
            coverSource = fmCover;
          } else {
            const firstImgIdx = blocks.findIndex((b) => b.kind === 'image');
            if (firstImgIdx >= 0) {
              coverSource = (blocks[firstImgIdx] as ImageBlock).source;
              // coverKeep=remove:直接删掉这个作封面的图片块,避免封面在正文重复(删的正是
              // 拿去当封面的同一块,不再有「选 A 删 B」的错位)。
              if (opts.coverKeep === 'remove') blocks = blocks.filter((_, i) => i !== firstImgIdx);
            }
          }
        }

        // 远程图 / 封面 host 权限:必须在用户手势内、任何其它 await 之前(上面全同步)。
        await requestRemoteImagePermissions(md, coverSource ? [coverSource] : []);

        // 写入中(等待 content → injector 直写)
        setStageLabel(t.stBody);
        setStagePct(75);
        // 压缩参数:compress 开时传 { maxEdge, quality };关时 null(content 侧不压)。
        const compress = opts.compress ? { maxEdge: opts.maxEdge, quality: Number(opts.quality) } : null;
        const res = await importToXTab(blocks, mode, coverSource, opts.scrollTop, compress);
        if (res.ok) {
          setStagePct(100);
          // #7:所选 append 但引擎实际降级为 replace(编辑器为空)→ 明确提示,不静默。
          let toastMsg = mode === 'append' && res.effectiveMode === 'replace' ? t.emptyReplaced : t.writtenToast;
          // 图片上传结果:有图片时如实附上「成功/总数」,失败图已被引擎降级为原文。
          const totalImg = res.imageOk + res.imageFail;
          if (totalImg > 0) {
            toastMsg = `${toastMsg} · ${en ? 'images' : '图片'} ${res.imageOk}/${totalImg}`;
          }
          if (res.coverSet) toastMsg = `${toastMsg} · ${en ? 'cover' : '封面'}`;
          // 标题流程:正文已成功,再设置标题。标题失败不推翻正文成功结论(部分成功)。
          if (extracted) {
            let titleRes: SetTitleResponse;
            if (opts.titleConflict === 'overwrite') {
              titleRes = await setTitleOnXTab(extracted.title, 'overwrite');
            } else if (opts.titleConflict === 'keep') {
              titleRes = await setTitleOnXTab(extracted.title, 'keep');
            } else {
              // ask:先以 keep 探测——编辑器本无标题则顺便设好(applied=true,无冲突不打扰);
              // 已有标题则被跳过(applied=false)→ 弹窗问用户,选覆盖才二次 overwrite。
              titleRes = await setTitleOnXTab(extracted.title, 'keep');
              if (titleRes.ok && titleRes.applied === false) {
                const overwrite = await askTitleConflict(extracted.title);
                if (overwrite) titleRes = await setTitleOnXTab(extracted.title, 'overwrite');
              }
            }
            toastMsg = `${toastMsg} · ${titleResultText(titleRes, t)}`;
          }
          finishImport(toastMsg, res.imageFail);
        } else {
          // 失败:不写成功记录,以可读中文/英文提示错误(复位在 finally 统一处理)。
          showToast(importErrorText(res.error, t));
        }
      } catch (err) {
        // 解析异常(如超深嵌套导致栈溢出)等意外:兜底提示,不留残局。
        showToast(`${t.errWriteFail}: ${String(err)}`);
      } finally {
        // 无论成功/失败/抛错,importing 一定复位——否则写入按钮会被永久禁用。
        // finishImport 已在成功路径把 importing 置 false,此处再置一次是幂等的。
        setImporting(false);
        // 同步闸门同样在此统一复位,与 importing state 复位保持一致的收尾时机。
        importingRef.current = false;
      }
    },
    // 依赖整个 opts(而非逐字段):startImport 读多个设置(setTitle/h1Handle/titleConflict/
    // setCover/coverKeep/scrollTop/obsidianImg/wikilink…),逐列极易漏(漏了会 stale-closure
    // 读到旧值——切开关后不改 md 就点写入即失效)。setOpt 每次产生新 opts 引用,依赖整个 opts
    // 让任一设置切换都重建回调,正确且防再漏。
    [md, en, t, opts, finishImport, showToast, askTitleConflict],
  );

  const writeX = useCallback(() => {
    if (!md.trim() || importing || !connected) return;
    if (opts.onExisting === 'ask' && editorHasContent) {
      setAskOverwrite(true);
      return;
    }
    // 非询问模式:按设置直接决定模式(总是追加 / 总是覆盖)。
    const mode: ImportMode = opts.onExisting === 'append' ? 'append' : 'replace';
    void startImport(mode);
  }, [md, importing, connected, opts.onExisting, editorHasContent, startImport]);

  const overwriteAppend = useCallback(() => {
    setAskOverwrite(false);
    void startImport('append');
  }, [startImport]);
  const overwriteConfirm = useCallback(() => {
    setAskOverwrite(false);
    void startImport('replace');
  }, [startImport]);
  const overwriteCancel = useCallback(() => setAskOverwrite(false), []);
  const titleOverwriteConfirm = useCallback(() => settleTitleAsk(true), [settleTitleAsk]);
  const titleOverwriteKeep = useCallback(() => settleTitleAsk(false), [settleTitleAsk]);

  // ── 记录 ──
  const loadHistoryItem = useCallback(
    (item: HistoryItem) => {
      setMd(item.md || '');
      setTab('draft');
      setMode('edit');
      showToast(t.loadedToast);
    },
    [setMd, showToast, t.loadedToast],
  );
  const copyHistoryItem = useCallback(
    (item: HistoryItem) => {
      try {
        void navigator.clipboard.writeText(item.md || '');
      } catch {
        /* 剪贴板不可用则静默 */
      }
      showToast(t.copiedToast);
    },
    [showToast, t.copiedToast],
  );
  const deleteHistoryItem = useCallback(
    (id: number) => commitHistory(history.filter((h) => h.id !== id)),
    [history, commitHistory],
  );
  const clearHistory = useCallback(() => {
    if (!histClearArm) {
      setHistClearArm(true);
      if (timers.current.histArm) clearTimeout(timers.current.histArm);
      timers.current.histArm = setTimeout(() => setHistClearArm(false), 2600);
      return;
    }
    setHistClearArm(false);
    commitHistory([]);
  }, [histClearArm, commitHistory]);
  const wipeAll = useCallback(() => {
    commitHistory([]);
    setMd('');
  }, [commitHistory, setMd]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      tab,
      setTab,
      toast,
      showToast,
      md,
      setMd,
      mode,
      setMode,
      dragging,
      setDragging,
      save,
      clear,
      clearArm,
      loadSample,
      readFile,
      capOpen,
      toggleCap: () => setCapOpen((v) => !v),
      checkVisible,
      checkStep,
      runCheck,
      closeCheck,
      importing,
      stageIdx,
      stagePct,
      stageLabel,
      writeX,
      askOverwrite,
      overwriteAppend,
      overwriteConfirm,
      overwriteCancel,
      askTitleOverwrite,
      pendingTitle,
      titleOverwriteConfirm,
      titleOverwriteKeep,
      editorHasContent,
      reportVisible,
      closeReport: () => setReportVisible(false),
      celebrating,
      history,
      histQ,
      setHistQ,
      loadHistoryItem,
      copyHistoryItem,
      deleteHistoryItem,
      clearHistory,
      histClearArm,
      wipeAll,
    }),
    [
      tab, toast, showToast, md, setMd, mode, dragging, save, clear, clearArm, loadSample, readFile,
      capOpen, checkVisible, checkStep, runCheck, closeCheck, importing, stageIdx, stagePct, stageLabel,
      writeX, askOverwrite, overwriteAppend, overwriteConfirm, overwriteCancel,
      askTitleOverwrite, pendingTitle, titleOverwriteConfirm, titleOverwriteKeep,
      editorHasContent, reportVisible, celebrating, history, histQ, loadHistoryItem, copyHistoryItem,
      deleteHistoryItem, clearHistory, histClearArm, wipeAll,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace 必须在 <WorkspaceProvider> 内使用');
  return ctx;
}
