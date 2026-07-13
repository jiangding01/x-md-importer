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
import { importToXTab } from '@/lib/bridge/importArticle';
import type { ImportMode } from '@/lib/bridge/protocol';
import { capability, firstTitle } from '@/lib/markdown/capability';
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
  const { connected } = useConnection();
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
  const [celebrating, setCelebrating] = useState(false);
  const [histQ, setHistQ] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  const [editorHasContent, setEditorHasContent] = useState(true);
  const [histClearArm, setHistClearArm] = useState(false);

  const timers = useRef<Timers>({});

  const showToast = useCallback((msg: string) => {
    if (timers.current.toast) clearTimeout(timers.current.toast);
    setToast(msg);
    timers.current.toast = setTimeout(() => setToast(null), 2200);
  }, []);

  const setMd = useCallback((v: string) => {
    setMdState(v);
    void saveDraft(v);
  }, []);

  const commitHistory = useCallback((next: HistoryItem[]) => {
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
  const finishImport = useCallback(() => {
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
      fail: 0,
      md,
    };

    setImporting(false);
    setEditorHasContent(true);
    setReportVisible(opts.autoReport !== 'never');

    const limit = opts.histLimit === 'inf' ? Infinity : Number(opts.histLimit);
    const nextHistory = [item, ...history];
    commitHistory(nextHistory.length > limit ? nextHistory.slice(0, limit) : nextHistory);

    if (opts.confetti) {
      setCelebrating(true);
      timers.current.celebrate = setTimeout(() => setCelebrating(false), 950);
    }
    showToast(t.writtenToast);
    playSound();
  }, [md, en, opts.autoReport, opts.histLimit, opts.confetti, history, commitHistory, showToast, t.writtenToast, playSound]);

  // 真实写入:解析 → 送达 X tab → 按结果收尾。纯文本写入近乎瞬时,
  // 进度条只走「解析中 → 写入中 → 完成」三段真实阶段(不再用定时器编造百分比,
  // 条纹动画在 await 期间提供 indeterminate 观感)。
  const startImport = useCallback(
    async (mode: ImportMode) => {
      setImporting(true);
      setReportVisible(false);
      setStageIdx(0);
      try {
        // 解析中(同步、瞬时)
        setStageLabel(t.stParse);
        setStagePct(40);
        const blocks = parseMarkdown(md);
        // 写入中(等待 content → injector 直写)
        setStageLabel(t.stBody);
        setStagePct(75);
        const res = await importToXTab(blocks, mode);
        if (res.ok) {
          setStagePct(100);
          finishImport();
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
      }
    },
    [md, t, finishImport, showToast],
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
