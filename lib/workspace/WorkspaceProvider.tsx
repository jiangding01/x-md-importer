import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useConnection } from '@/lib/bridge/useConnection';
import { useProbe } from '@/lib/bridge/useProbe';
import { getFolderStatus, importToXTab, probeXTabContent, setTitleOnXTab } from '@/lib/bridge/importArticle';
import { resolveTargetXTab } from '@/lib/bridge/locateXTab';
import { requestRemoteImagePermissions } from '@/lib/bridge/imagePermissions';
import { classifyImageSource, type ImageBlock, type ImageFailure, type ImportMode, type SetTitleResponse } from '@/lib/bridge/protocol';
import { capability, firstTitle } from '@/lib/markdown/capability';
import { extractCover, extractTitle, stripFirstH1 } from '@/lib/markdown/frontmatter';
import { parseMarkdown } from '@/lib/markdown/parser';
import { sampleEn, sampleZh } from '@/lib/markdown/sample';
import { DRAFT_KEY, saveDraft } from '@/lib/storage/draftStore';
import { HISTORY_KEY, saveHistory, type HistoryItem } from '@/lib/storage/historyStore';
import { validateHistory } from '@/lib/storage/schema';
import { downloadText } from '@/lib/ui/download';
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
  // 持久化健康:任一草稿/历史写入失败(如配额满)时置位,DraftTab 展示常驻错误条(P0-1)。
  storageError: boolean;
  exportDraft: () => void;
  save: () => void;
  clear: () => void;
  clearArm: boolean;
  loadSample: () => void;
  readFile: (file: File | null | undefined) => void;
  // 载入二次确认(载入历史 / 导入 .md 会覆盖当前草稿时弹出)
  loadConfirmOpen: boolean;
  loadConfirm: () => void;
  loadCancel: () => void;
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
  deleteHistoryItem: (id: string | number) => void;
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
  const { opts, setOpt } = useSettings();
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
  // 载入待确认动作:非 null 时弹 LoadConfirmDialog,存的是「确认后要执行的覆盖动作」。
  // review B3:载入(历史/文件)与清空同等破坏力(经 setMd 立即覆盖 storage、不可逆),
  // 但此前只有清空二次确认;这里补齐载入的确认闸门。
  const [pendingLoad, setPendingLoad] = useState<(() => void) | null>(null);

  const timers = useRef<Timers>({});
  // 标题冲突询问的 resolver:startImport 弹窗时存入,用户点覆盖/保留时兑现,恢复 async 流程。
  const titleAskResolver = useRef<((overwrite: boolean) => void) | null>(null);
  // 同步闸门:防极快双击并发触发两次 startImport(React state 的 importing 更新是异步的,
  // 双击间隔内两次 writeX 都可能读到陈旧的 importing=false)。ref 写入同步生效,
  // 只做「进入即锁、结束即解」的闸门作用,UI 展示仍用 importing state。
  const importingRef = useRef(false);
  // B2-1:ask 弹窗挂起期间钉死的写入目标(tabId + articleId 双钥),确认/取消后即清。
  const pendingAskTarget = useRef<{ tabId: number; articleId: string | null } | null>(null);

  const showToast = useCallback((msg: string) => {
    if (timers.current.toast) clearTimeout(timers.current.toast);
    setToast(msg);
    timers.current.toast = setTimeout(() => setToast(null), 2200);
  }, []);

  // ── 草稿持久化(P0-1 + P2-21)──
  // md 的最新值镜像:onChanged 监听器/flush 以 [] 依赖注册,读闭包 state 会拿到陈旧快照,
  // 一切「当前草稿是什么」的判断只准读这个 ref。所有 setMdState 写入点必须同步更新它。
  const mdRef = useRef(initialMd);
  // 持久化健康:草稿/历史任一写失败(配额满等)置位 → DraftTab 常驻错误条。
  // 按来源分账(review 修复):草稿 flush 成功只清草稿位——历史写失败后草稿写成功不许把
  // 错误条清掉(失败的历史列表没有重试队列,直到下次历史变更前始终未落盘,错误条要如实亮着)。
  const [storageError, setStorageError] = useState(false);
  const persistFail = useRef({ draft: false, history: false });
  const markPersist = useCallback((source: 'draft' | 'history', ok: boolean) => {
    persistFail.current[source] = !ok;
    setStorageError(persistFail.current.draft || persistFail.current.history);
  }, []);
  // 250ms trailing 防抖 + 2s max-wait:此前每次键入整串写 storage(长文卡顿 + 写放大)。
  // trailing 会被连续键入无限顺延,崩溃(OOM/进程被杀,不触发 blur/pagehide)就丢整段——
  // max-wait 把最坏丢失从「整段连续输入」压回 ≤2s(review 修复)。
  // pending 非 null = 有未落盘的本地编辑;flush 失败会把值放回 pending 供下次重试。
  const pendingDraft = useRef<string | null>(null);
  const pendingSince = useRef(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = undefined;
    }
    const v = pendingDraft.current;
    if (v === null) return true;
    pendingDraft.current = null;
    try {
      await saveDraft(v);
      markPersist('draft', true);
      return true;
    } catch (err) {
      console.error('[MarkFlow] draft persist failed:', err);
      // 失败值放回 pending(除非期间已有更新的编辑),下次 flush 触发时重试,不静默丢。
      if (pendingDraft.current === null) pendingDraft.current = v;
      markPersist('draft', false);
      return false;
    }
  }, [markPersist]);

  const schedulePersist = useCallback(
    (v: string) => {
      if (pendingDraft.current === null) pendingSince.current = Date.now();
      pendingDraft.current = v;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      // max-wait:pending 已积压超 2s → 立即落盘,不再顺延。
      if (Date.now() - pendingSince.current >= 2000) {
        void flushDraft();
        return;
      }
      persistTimer.current = setTimeout(() => void flushDraft(), 250);
    },
    [flushDraft],
  );

  const setMd = useCallback(
    (v: string) => {
      setMdState(v);
      mdRef.current = v;
      schedulePersist(v);
      // 内容一变,旧预检 / 导入报告就不对应当前 md 了 → 一并收起,不残留过期结果。
      // setMd 是所有「内容替换」的唯一入口(清空 / 载入示例 / 读文件 / 载入历史 / 编辑输入),放这一处全覆盖。
      // 写入流程 startImport 不经 setMd(它自行 setReportVisible(true)),故不会把刚出的报告清掉。
      setCheckVisible(false);
      setCheckStep(-1);
      setReportVisible(false);
    },
    [schedulePersist],
  );

  const commitHistory = useCallback(
    (next: HistoryItem[]) => {
      historyRef.current = next; // 同步镜像,供挂起后的 finishImport 读最新值
      setHistory(next);
      // 写失败必须可见(P0-1):按来源记账,亮/清常驻错误条(见 persistFail 注释)。
      saveHistory(next).then(
        () => markPersist('history', true),
        (err) => {
          console.error('[MarkFlow] history persist failed:', err);
          markPersist('history', false);
        },
      );
    },
    [markPersist],
  );

  // flush 触发点:防抖到点之外,面板隐藏/卸载/失焦(用户点回 X 页面)都立即落盘——
  // 侧边栏被关闭时卸载事件不保证给足异步 IPC 时间,所以尽量在还活着的时机就写完。
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushDraft();
    };
    const onPageHide = () => void flushDraft();
    const onBlur = () => void flushDraft();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('blur', onBlur);
      void flushDraft();
    };
  }, [flushDraft]);

  // ── 双窗口同步(P0-2)──
  // 每个浏览器窗口一个 sidePanel 实例,此前各实例持挂载时快照、整体覆写 last-write-wins:
  // 窗口 A 写了半小时,回到 B 敲一个字符就用陈旧内容覆盖掉。订阅 onChanged 让非活跃实例跟随。
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const handler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const draftChange = changes[DRAFT_KEY];
      if (draftChange && typeof draftChange.newValue === 'string') {
        const incoming = draftChange.newValue;
        // 采纳条件(顺序即优先级):非 echo、本地无未落盘编辑、非导入中。
        // 有 pending 时不采纳:本地更新,随后 flush 会写回并再广播,吞掉 pending 才是丢数据。
        // 导入中不采纳:startImport 闭包依赖 md 一致性(blocks/历史都取自它)。
        // **不看 hasFocus**(review 修复):onChanged 是边沿触发,「聚焦时拒收」的更新永远不会
        // 再送达——A 窗口 blur-flush 的广播若晚于 B 获得焦点,B 会永远停在陈旧草稿上,
        // 第一次键入就把 A 的整段编辑覆盖回去(正是 P0-2 要堵的丢法)。聚焦但无 pending
        // = 本地已全部落盘,采纳外部新值是安全的;真正的并发编辑由 pending 闸门保护。
        const adoptable =
          incoming !== mdRef.current &&
          pendingDraft.current === null &&
          !importingRef.current;
        if (adoptable) {
          mdRef.current = incoming;
          setMdState(incoming);
          setCheckVisible(false);
          setCheckStep(-1);
          setReportVisible(false);
          showToast(t.draftSynced);
        }
      }
      const histChange = changes[HISTORY_KEY];
      if (histChange && Array.isArray(histChange.newValue)) {
        const incoming = validateHistory(histChange.newValue);
        const cur = historyRef.current;
        // echo 判定:长度 + id 序列一致即本窗口刚写入的回声(条目不可变,只有增删)。
        const same =
          incoming.length === cur.length && incoming.every((it, i) => it.id === cur[i]?.id);
        if (!same) {
          historyRef.current = incoming;
          setHistory(incoming);
        }
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, [showToast, t.draftSynced]);

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
  // 手动保存 = 强制 flush 并如实汇报:此前无条件 toast「已保存」,写失败也谎报成功(P0-1)。
  const save = useCallback(() => {
    pendingDraft.current = mdRef.current; // 即便无变更也强制写一次,让「保存」语义真实
    void flushDraft().then((ok) => showToast(ok ? t.savedToast : t.errStorageWrite));
  }, [flushDraft, showToast, t.savedToast, t.errStorageWrite]);

  // 常驻错误条上的自救出口:把当前草稿(读 ref,含未落盘的 pending 值)下载成 .md 文件。
  const exportDraft = useCallback(() => {
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      downloadText(`markflow-draft-${stamp}.md`, mdRef.current, 'text/markdown');
      showToast(t.draftExported);
    } catch (err) {
      console.error('[MarkFlow] draft export failed:', err);
      showToast(t.errExportFail);
    }
  }, [showToast, t.draftExported, t.errExportFail]);

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
        const incoming = String(reader.result);
        // 拖入浮层先收起(与是否弹确认无关),避免取消时 dragging 遮罩残留。
        setDragging(false);
        const apply = () => {
          setMd(incoming);
          setMode('edit');
          showToast(`${t.importedToast} · ${file.name}`);
        };
        // 当前草稿非空且内容不同 → 弹确认;否则(空/相同)直接载入。
        if (md.trim() && incoming !== md) setPendingLoad(() => apply);
        else apply();
      };
      reader.readAsText(file);
    },
    [md, setMd, showToast, t.importedToast],
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
  // B5 的 UI 后半程:content 在「涉本地图的导入」结束后清 vault handle,但 sidepanel 的
  // opts 缓存(activeFolder/folder)没人通知——素材板/设置会一直显示「已连接」直到组件
  // 重新挂载(真机回归 T2 的「UI 撒谎」)。导入收尾时调用本函数向 content 重新校准两级状态。
  const recalibrateFolders = useCallback(async () => {
    const [active, persistent] = await Promise.all([
      getFolderStatus('active'),
      getFolderStatus('persistent'),
    ]);
    if (active.ok) {
      setOpt('activeFolder', active.connected);
      setOpt('activeFolderName', active.folderName);
    }
    if (persistent.ok) {
      setOpt('folder', persistent.connected);
      setOpt('folderName', persistent.folderName);
    }
  }, [setOpt]);

  // toastMsg:成功收尾提示,默认「已写入」;标题/空替换场景由 startImport 组合后传入。
  // ok 用注入引擎回传的真实写入块数(blockCount)——此前拿 capability 的格式计数凑数,
  // 纯文本段落任何类目都不计,导致「实际写入成功、报告 0 成功」(真机回归 T5)。
  // 口径:成功 = 实际写入块数 - 图片失败数(失败图已降级为文本块,不重复计);
  // 降级 = capability 的格式降级项计数(H4+/行内代码等,写入成功但格式打折,单位是「处」)。
  const finishImport = useCallback((
    toastMsg: string = t.writtenToast,
    imageFail = 0,
    blockCount = 0,
    imageFailures?: ImageFailure[],
  ) => {
    // parseOpts 透传:面板计数须与本次实际写入用的同一套解析开关一致(否则关掉
    // obsidianImg/wikilink/taskList 后报告仍按默认开的口径统计,又是一次 UI 撒谎)。
    const cap = capability(md, en, { obsidianImg: opts.obsidianImg, wikilink: opts.wikilink, taskList: opts.taskList });
    const ok = Math.max(0, blockCount - imageFail);
    const deg = cap.filter((c) => c.badge === 'warn').reduce((a, c) => a + c.count, 0);
    const now = new Date();
    const item: HistoryItem = {
      // UUID 而非 Date.now():双窗口同毫秒导入会撞 number id(React key 冲突、删除连删两条)。
      id: crypto.randomUUID(),
      title: firstTitle(md, en),
      date: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${now.toTimeString().slice(0, 5)}`,
      ok,
      deg,
      // 图片上传失败计入 fail(记录/报告如实反映),其余降级仍归 deg。
      fail: imageFail,
      md,
      // 失败明细(序号/来源/阶段/原因)随记录持久化,供报告卡展示与事后排查。
      imageFailures,
    };

    setImporting(false);
    // autoReport 三档如实生效(P1-10):此前只区分 never/非 never,「仅异常时」(默认值)形同 always。
    const hasAnomaly = deg > 0 || imageFail > 0;
    setReportVisible(opts.autoReport === 'always' || (opts.autoReport === 'anomaly' && hasAnomaly));

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
    async (mode: ImportMode, pinnedTarget?: { tabId: number; articleId: string | null }) => {
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
        let blocks = parseMarkdown(bodyMd, { obsidianImg: opts.obsidianImg, wikilink: opts.wikilink, taskList: opts.taskList });

        // 封面来源:frontmatter cover > 正文首图。首图取自**已解析 blocks 的首个 ImageBlock**——
        // 与实际上传/移除同源,避免用 images() 全文正则误选到内联图 / 代码块内的图(review #1)。
        let coverSource: string | null = null;
        // 正文首图被抽走当封面时置真:引擎看到的图片序列比用户文档少第一张,回传的失败明细
        // index 需 +1 还原成「文档里的第 N 张图」,否则报告指错图(review 批次三)。
        let coverRemovedBodyImage = false;
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
              if (opts.coverKeep === 'remove') {
                blocks = blocks.filter((_, i) => i !== firstImgIdx);
                coverRemovedBodyImage = true;
              }
            }
          }
        }

        // 本次导入是否涉及本地图——谓词与 content 的 usesLocalImage 完全一致(blocks 里的
        // local 图,或本地路径封面)。涉及则 content 会在导入结束后清 vault handle(B5),
        // 成功收尾时需同步校准文件夹 UI 并提示用户(真机回归 T2)。
        const usesLocalImage =
          blocks.some((b) => b.kind === 'image' && classifyImageSource(b.source) === 'local') ||
          (coverSource !== null && classifyImageSource(coverSource) === 'local');

        // 远程图 / 封面 host 权限:必须在用户手势内、任何其它 await 之前(上面全同步)。
        await requestRemoteImagePermissions(md, coverSource ? [coverSource] : []);

        // review B1 + B2-1:正文写入前解析目标 X 标签**一次**并全程钉死。ask 流程传入
        // pinnedTarget(writeX 探测时已钉的 tabId+articleId 双钥)则直接用——目标在弹窗
        // 弹出**之前**就定死,挂起期间切 tab/切文章都写不到别处(articleId 由 injector
        // 在 commit 前终验)。未传时(非 ask 路径)维持原逻辑:放在权限申请(首个 await)
        // 之后解析——权限申请必须是手势链首个 await(见 imagePermissions 注释),此处再解析
        // 不消耗手势;且权限弹窗结束时焦点仍在当前 X 草稿,此刻定位即准。拿不到(切走了/非 X)
        // → 按 disconnected 提前返回,importing 由 finally 复位。
        const pinnedTabId = pinnedTarget?.tabId ?? (await resolveTargetXTab());
        if (pinnedTabId === null) {
          showToast(importErrorText('disconnected', t));
          return;
        }
        const expectedArticleId = pinnedTarget?.articleId ?? null;

        // 写入中(等待 content → injector 直写)
        setStageLabel(t.stBody);
        setStagePct(75);
        // 压缩参数:compress 开时传 { maxEdge, quality };关时 null(content 侧不压)。
        const compress = opts.compress ? { maxEdge: opts.maxEdge, quality: Number(opts.quality) } : null;
        const res = await importToXTab(blocks, mode, coverSource, opts.scrollTop, compress, pinnedTabId, expectedArticleId);
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
            // 标题 ask 询问弹窗 × B1 钉 tabId 的整合:三处 setTitleOnXTab **全部复用 pinnedTabId**,
            // 标题绝不落到用户中途切过去的另一篇文章(尤其 ask 弹窗无限期挂起期间)。
            let titleRes: SetTitleResponse;
            if (opts.titleConflict === 'overwrite') {
              titleRes = await setTitleOnXTab(extracted.title, 'overwrite', pinnedTabId);
            } else if (opts.titleConflict === 'keep') {
              titleRes = await setTitleOnXTab(extracted.title, 'keep', pinnedTabId);
            } else {
              // ask:先以 keep 探测——编辑器本无标题则顺便设好(applied=true,无冲突不打扰);
              // 已有标题则被跳过(applied=false)→ 弹窗问用户,选覆盖才二次 overwrite。
              titleRes = await setTitleOnXTab(extracted.title, 'keep', pinnedTabId);
              if (titleRes.ok && titleRes.applied === false) {
                const overwrite = await askTitleConflict(extracted.title);
                if (overwrite) titleRes = await setTitleOnXTab(extracted.title, 'overwrite', pinnedTabId);
              }
            }
            toastMsg = `${toastMsg} · ${titleResultText(titleRes, t)}`;
          }
          // B5 的 UI 同步:content 已在导入尾声清掉用过的 vault handle,这里(a)就地重新校准
          // 素材板/设置的文件夹状态(否则要等组件重新挂载才刷新,UI 撒谎),(b)若确有文件夹
          // 曾处于连接态,toast 里明确告知已断开——安全清理是既定代价,但不能默默变化。
          if (usesLocalImage) {
            if (opts.activeFolder || opts.folder) toastMsg = `${toastMsg} · ${t.folderAutoCleared}`;
            void recalibrateFolders();
          }
          // 序号还原:首图被抽走当封面(coverKeep=remove)后,引擎回传的正文图 index 整体 +1
          // 才对应用户文档顺序;封面哨兵(index=-1)不动。
          const imageFailures = coverRemovedBodyImage
            ? res.imageFailures?.map((f) => (f.index >= 0 ? { ...f, index: f.index + 1 } : f))
            : res.imageFailures;
          finishImport(toastMsg, res.imageFail, res.blockCount, imageFailures);
        } else {
          // 失败:不写成功记录,以可读中文/英文提示错误(复位在 finally 统一处理)。
          // B2-2:提交后失败(committed)或通道超时(injector 可能仍在后台完成提交,content
          // 无从得知)→ 用「正文可能已写入」文案族,阻止用户按「失败」直觉重试造成整篇重复;
          // 并重探一次让状态条反映编辑器真实内容。
          const maybeCommitted = res.committed === true || res.error === 'timeout';
          if (maybeCommitted) {
            showToast(t.errFailedButCommitted);
            void refreshProbe();
          } else if (res.error === 'article-switched') {
            showToast(t.errArticleSwitched);
          } else {
            showToast(importErrorText(res.error, t));
          }
          // B5 的失败路径同步(review 修复):content 对「涉本地图的导入」**无论成败**都会清
          // vault handle,此前只有成功分支校准文件夹 UI——失败后素材板仍显示「已连接」,
          // 下次导入本地图静默找不到文件。失败也就地校准,UI 不撒谎。
          if (usesLocalImage) void recalibrateFolders();
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
    [md, en, t, opts, finishImport, showToast, askTitleConflict, recalibrateFolders, refreshProbe],
  );

  const writeX = useCallback(async () => {
    if (!md.trim() || importing || !connected) return;
    if (opts.onExisting === 'ask') {
      // review #5:陈旧探针快照可能把用户刚在 X 手打的内容误判为空 → 决定 ask/replace 前
      // 即时探一次拿新鲜 hasContent,而非依赖 useConnection 的 editorHasContent 快照。
      // 这几个 tab-API await 不消耗手势(仅 permissions.request 消耗),后续 startImport 里
      // 权限申请仍在手势窗口内(见其内注释)。
      // B2-1:探测的同时拿到 {tabId, articleId} 双钥并钉死——此前 pinnedTabId 在用户点
      // 「覆盖」**之后**才解析,确认弹窗挂起期间切到另一篇草稿 B,hasContent 检查的是 A、
      // blockMap.clear() 砸的却是 B(B1 修过标题通道的同款竞态,正文通道当时没堵)。
      const fresh = await probeXTabContent();
      void refreshProbe(); // 同步刷新共享状态条,与写入决策使用同一真相
      if (!fresh.connected || fresh.tabId === null) {
        // 新鲜探测发现已断开 → 中止,并明确告知(P2-20:此前静默 return,按钮「点了没反应」)。
        showToast(importErrorText('disconnected', t));
        return;
      }
      const pinned = { tabId: fresh.tabId, articleId: fresh.articleId };
      if (fresh.hasContent) {
        pendingAskTarget.current = pinned; // 弹窗确认后透传给 startImport,取消时清掉
        setAskOverwrite(true);
        return;
      }
      // 编辑器确为空 → 直接整体写入(与原空态行为一致:replace),沿用刚探测的目标。
      void startImport('replace', pinned);
      return;
    }
    // 非询问模式:按设置直接决定模式(总是追加 / 总是覆盖)。同样先探测钉死双钥
    // (review 修复):此路径虽无确认弹窗,但 startImport 里的 host 权限申请是**无限期**
    // 等用户决定的挂起窗口,期间切文章同样会「探 A 写 B」。probe 的 tab-API await 不消耗
    // 手势,权限申请仍是 startImport 内手势链首个 await,约束不破坏。
    const mode: ImportMode = opts.onExisting === 'append' ? 'append' : 'replace';
    const freshDirect = await probeXTabContent();
    if (!freshDirect.connected || freshDirect.tabId === null) {
      showToast(importErrorText('disconnected', t));
      return;
    }
    void startImport(mode, { tabId: freshDirect.tabId, articleId: freshDirect.articleId });
  }, [md, importing, connected, opts.onExisting, startImport, refreshProbe, showToast, t]);

  const overwriteAppend = useCallback(() => {
    setAskOverwrite(false);
    const pinned = pendingAskTarget.current;
    pendingAskTarget.current = null;
    void startImport('append', pinned ?? undefined);
  }, [startImport]);
  const overwriteConfirm = useCallback(() => {
    setAskOverwrite(false);
    const pinned = pendingAskTarget.current;
    pendingAskTarget.current = null;
    void startImport('replace', pinned ?? undefined);
  }, [startImport]);
  const overwriteCancel = useCallback(() => {
    setAskOverwrite(false);
    pendingAskTarget.current = null; // 必须清:否则下一次写入可能误用陈旧目标
  }, []);
  const titleOverwriteConfirm = useCallback(() => settleTitleAsk(true), [settleTitleAsk]);
  const titleOverwriteKeep = useCallback(() => settleTitleAsk(false), [settleTitleAsk]);

  // ── 记录 ──
  const loadHistoryItem = useCallback(
    (item: HistoryItem) => {
      const incoming = item.md || '';
      const apply = () => {
        setMd(incoming);
        setTab('draft');
        setMode('edit');
        showToast(t.loadedToast);
      };
      // review B3:当前草稿非空且与将载入内容不同 → 弹确认(覆盖不可逆);否则直接载入。
      if (md.trim() && incoming !== md) setPendingLoad(() => apply);
      else apply();
    },
    [md, setMd, showToast, t.loadedToast],
  );
  // 确认:执行挂起的覆盖动作并清空 pending;取消:仅清空(什么都不覆盖)。
  const loadConfirm = useCallback(() => {
    const apply = pendingLoad;
    setPendingLoad(null);
    apply?.();
  }, [pendingLoad]);
  const loadCancel = useCallback(() => setPendingLoad(null), []);
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
    (id: string | number) => commitHistory(history.filter((h) => h.id !== id)),
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
      storageError,
      exportDraft,
      save,
      clear,
      clearArm,
      loadSample,
      readFile,
      loadConfirmOpen: pendingLoad !== null,
      loadConfirm,
      loadCancel,
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
      tab, toast, showToast, md, setMd, mode, dragging, storageError, exportDraft, save, clear, clearArm, loadSample, readFile,
      pendingLoad, loadConfirm, loadCancel,
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
