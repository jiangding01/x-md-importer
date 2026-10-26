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
import { clearFolder, getFolderStatus, importToXTab, probeXTabContent, setTitleOnXTab } from '@/lib/bridge/importArticle';
import {
  countDeniedRemote,
  queryRemoteImagePermissions,
  relabelPermissionFailures,
  requestRemoteImagePermissions,
} from '@/lib/bridge/imagePermissions';
import { ARTICLE_SWITCHED_ERROR, type ImageFailure, type ImportMode, type SetTitleResponse } from '@/lib/bridge/protocol';
import type { CapabilityAdjust } from '@/lib/markdown/capability';
import { extractTitle, parseMarkdownWithoutTitle } from '@/lib/markdown/frontmatter';
import { parseMarkdown } from '@/lib/markdown/parser';
import { sampleEn, sampleZh } from '@/lib/markdown/sample';
import { DRAFT_KEY, removeDraft, saveDraft } from '@/lib/storage/draftStore';
import { HISTORY_KEY, removeHistory, saveHistory, type HistoryItem } from '@/lib/storage/historyStore';
import { removeOptions } from '@/lib/storage/optionsStore';
import { removePrefs } from '@/lib/storage/prefs';
import { createEchoQueue } from '@/lib/storage/echoQueue';
import { validateHistory } from '@/lib/storage/schema';
import { downloadText } from '@/lib/ui/download';
import { decideDraftChange, draftRetryDelay } from '@/lib/workspace/draftSync';
import { importErrorText, titleResultText } from '@/lib/workspace/errorText';
import { decideHistoryChange, historySignature } from '@/lib/workspace/historySync';
import { pickCoverSource, usesLocalImage } from '@/lib/workspace/importPlan';
import { buildRunRecord, pruneHistory, type LastRunSnapshot, type RunParseOpts } from '@/lib/workspace/runRecord';
import type { Tab } from '@/entrypoints/sidepanel/types';

type Mode = 'edit' | 'preview';

/** toast 的展示种类(B4-5/P2-27):error 型换图标+危险色、时长按文案长度浮动;
 * 成功/中性提示不传第二参即为缺省(沿用原有观感)。 */
export type ToastKind = 'success' | 'error';

/** 报告卡数据快照的类型定义已迁到 lib/workspace/runRecord.ts(W1),此处转导出保持既有导入点。 */
export type { LastRunSnapshot };

interface WorkspaceValue {
  // 全局
  tab: Tab;
  setTab: (tab: Tab) => void;
  toast: { msg: string; kind: ToastKind } | null;
  showToast: (msg: string, kind?: ToastKind) => void;
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
  runCheck: () => void;
  closeCheck: () => void;
  // 导入
  importing: boolean;
  stagePct: number;
  stageLabel: string;
  writeX: () => void;
  askOverwrite: boolean;
  overwriteAppend: () => void;
  overwriteConfirm: () => void;
  overwriteCancel: () => void;
  // 标题冲突询问(titleConflict='ask' 且编辑器已有标题时,写入后按需弹出)
  askTitleOverwrite: boolean;
  pendingTitle: string | null; // 待写入的新标题(弹窗内显示)
  titleOverwriteConfirm: () => void; // 覆盖为新标题
  titleOverwriteKeep: () => void; // 保留原标题
  // 报告 / 庆祝
  reportVisible: boolean;
  closeReport: () => void;
  /** 手动打开报告卡(C4):autoReport='never'/'anomaly' 未自动弹出时,从底栏入口查看上次报告。 */
  openReport: () => void;
  lastRunSnapshot: LastRunSnapshot | null;
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
  wipeAll: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

interface Timers {
  toast?: ReturnType<typeof setTimeout>;
  celebrate?: ReturnType<typeof setTimeout>;
  clearArm?: ReturnType<typeof setTimeout>;
  histArm?: ReturnType<typeof setTimeout>;
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
  const { connected } = useConnection();
  // 写入成功后需重探,让 hasContent 反映「编辑器现在有内容了」(探针默认只挂载探一次)。
  const { refresh: refreshProbe } = useProbe();
  const en = lang === 'en';

  const [tab, setTab] = useState<Tab>('draft');
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [md, setMdState] = useState(initialMd);
  const [mode, setMode] = useState<Mode>('edit');
  const [dragging, setDragging] = useState(false);
  const [clearArm, setClearArm] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [checkVisible, setCheckVisible] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stagePct, setStagePct] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [reportVisible, setReportVisible] = useState(false);
  // B4-6(P2-25):报告卡的不可变数据源,导入收尾时钉死、setMd 时随报告一起清空(见 setMd)。
  const [lastRunSnapshot, setLastRunSnapshot] = useState<LastRunSnapshot | null>(null);
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
  // 第三批 H1:历史写入的回声队列与「最近一次确认与 storage 一致的签名」,口径同草稿的 draftEchoes / lastPersisted。
  const [historyEchoes] = useState(() => createEchoQueue<string>(8));
  const lastPersistedHistory = useRef(historySignature(initialHistory));
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
  // B6:permRequested=本轮首次点击已发起过 host 权限申请——确认路径据此跳过 request 与 toast。
  const pendingAskTarget = useRef<{ tabId: number; articleId: string | null; permRequested: boolean } | null>(null);

  const showToast = useCallback((msg: string, kind: ToastKind = 'success') => {
    if (timers.current.toast) clearTimeout(timers.current.toast);
    setToast({ msg, kind });
    // 时长按文案长度浮动(B4-5/P2-27):固定 2200ms 读不完 50+ 字的拼接文案(如「文件夹已安全
    // 断开,下篇导入需重新连接」这类必读提示),但也不能无限长——钳制在 2200~6000ms。
    const duration = Math.min(6000, Math.max(2200, msg.length * 90));
    timers.current.toast = setTimeout(() => setToast(null), duration);
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
  // W2:本实例已发起、尚未收到 onChanged 回声的草稿写入(见 lib/storage/echoQueue)。迟到的旧回声
  // 按队列吞掉,不再被当成另一窗口的编辑采纳。lastPersisted = 最近一次确认与 storage 一致的值:
  // 与它相同的写入 Chrome 不发 onChanged,不登记(否则滞留在队列里)。
  const [draftEchoes] = useState(() => createEchoQueue<string>(8));
  const lastPersisted = useRef(initialMd);
  const pendingSince = useRef(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 第三批 O7:连续写入失败次数。>0 时由退避重试定时器负责落盘(draftRetryDelay),键入只更新 pending,
  // 不再每次按键都整篇重写一次;任一次成功即复位。
  const draftFailCount = useRef(0);

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = undefined;
    }
    const v = pendingDraft.current;
    if (v === null) return true;
    pendingDraft.current = null;
    const expectEcho = v !== lastPersisted.current;
    if (expectEcho) draftEchoes.push(v);
    try {
      await saveDraft(v);
      lastPersisted.current = v;
      markPersist('draft', true);
      if (draftFailCount.current > 0) {
        draftFailCount.current = 0;
        // O7:退避期间键入不排定时器(见 schedulePersist);重试成功时若又有新编辑,恢复常规防抖落盘。
        if (pendingDraft.current !== null && !persistTimer.current) {
          pendingSince.current = Date.now();
          persistTimer.current = setTimeout(() => void flushDraft(), 250);
        }
      }
      return true;
    } catch (err) {
      if (expectEcho) draftEchoes.drop(v); // 写入失败不会有回声
      console.error('[MarkFlow] draft persist failed:', err);
      // 失败值放回 pending(除非期间已有更新的编辑),下次 flush 触发时重试,不静默丢。
      if (pendingDraft.current === null) pendingDraft.current = v;
      markPersist('draft', false);
      // O7:按退避间隔自动重试(此前失败后只能等下一次键入 / 失焦才再试,停手后就不再重试)。
      draftFailCount.current += 1;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => void flushDraft(), draftRetryDelay(draftFailCount.current));
      return false;
    }
  }, [markPersist, draftEchoes]);

  const schedulePersist = useCallback(
    (v: string) => {
      if (pendingDraft.current === null) pendingSince.current = Date.now();
      pendingDraft.current = v;
      // O7:写入失败中 → 交给已排好的退避重试,重试时写入最新的 pending。
      if (draftFailCount.current > 0) return;
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
      setReportVisible(false);
      // B4-6:报告快照与 reportVisible 同生命周期——内容一变,快照就不再代表「当前草稿」,
      // 一并清空(而不是留着一份对不上号的旧快照,靠 reportVisible=false 隐藏 UI 兜底)。
      setLastRunSnapshot(null);
    },
    [schedulePersist],
  );

  const commitHistory = useCallback(
    (next: HistoryItem[]) => {
      historyRef.current = next; // 同步镜像,供挂起后的 finishImport 读最新值
      setHistory(next);
      // H1:登记回声;与已落盘签名相同的写入 Chrome 不发 onChanged,不登记(否则滞留在队列里)。
      const sig = historySignature(next);
      const expectEcho = sig !== lastPersistedHistory.current;
      if (expectEcho) historyEchoes.push(sig);
      // 写失败必须可见(P0-1):按来源记账,亮/清常驻错误条(见 persistFail 注释)。
      saveHistory(next).then(
        () => {
          lastPersistedHistory.current = sig;
          markPersist('history', true);
        },
        (err) => {
          if (expectEcho) historyEchoes.drop(sig); // 写入失败不会有回声
          console.error('[MarkFlow] history persist failed:', err);
          markPersist('history', false);
        },
      );
    },
    [markPersist, historyEchoes],
  );

  // 第二批 W8:「记录保留上限」改小(或备份恢复后 reload 带回超限历史)时立即裁剪——此前只在下一次导入
  // 收尾时裁剪,与设置说明「超出后自动清理最旧记录」不符。pruneHistory 未超限时返回原数组,不触发写入。
  useEffect(() => {
    const pruned = pruneHistory(historyRef.current, opts.histLimit);
    if (pruned !== historyRef.current) commitHistory(pruned);
  }, [opts.histLimit, history, commitHistory]);

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
      // newValue 为 undefined = key 被删除(另一窗口 wipeAll)——按空草稿采纳,否则本窗口
      // 留着旧内容,一次键入就把「已清除」的数据整份写回 storage(review 修复)。
      if (draftChange && (typeof draftChange.newValue === 'string' || draftChange.newValue === undefined)) {
        const incoming = typeof draftChange.newValue === 'string' ? draftChange.newValue : '';
        // 判定见 decideDraftChange(W2):自写回声(含迟到的旧回声)→ 不采纳;否则非同值、本地无未落盘
        // 编辑、非导入中才采纳。**不看 hasFocus**:onChanged 是边沿触发,「聚焦时拒收」的更新永远不会
        // 再送达——A 窗口 blur-flush 的广播若晚于 B 获得焦点,B 会永远停在陈旧草稿上(review 修复)。
        const adoptable =
          decideDraftChange({
            incoming,
            current: mdRef.current,
            hasPending: pendingDraft.current !== null,
            importing: importingRef.current,
            echoes: draftEchoes,
          }) === 'adopt';
        if (adoptable) {
          mdRef.current = incoming;
          lastPersisted.current = incoming;
          setMdState(incoming);
          setCheckVisible(false);
          setReportVisible(false);
          setLastRunSnapshot(null); // 与 setMd 的清空逻辑保持一致(B4-6):外部值替换同样使旧报告失真
          showToast(t.draftSynced);
        }
      }
      const histChange = changes[HISTORY_KEY];
      // 同上:undefined = 另一窗口 wipeAll 删除了 key,按空历史采纳。
      if (histChange && histChange.newValue === undefined) {
        lastPersistedHistory.current = '';
        if (historyRef.current.length > 0) {
          historyRef.current = [];
          setHistory([]);
        }
      }
      if (histChange && Array.isArray(histChange.newValue)) {
        const incoming = validateHistory(histChange.newValue);
        // 判定见 decideHistoryChange(第三批 H1):自写回声(含连续两次写入时迟到的前一次回声)→ 不采纳,
        // 此前只比「与当前是否相同」,迟到回声会让列表短暂回退。
        const decision = decideHistoryChange({ incoming, current: historyRef.current, echoes: historyEchoes });
        if (decision !== 'echo') lastPersistedHistory.current = historySignature(incoming);
        if (decision === 'adopt') {
          historyRef.current = incoming;
          setHistory(incoming);
        }
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, [showToast, t.draftSynced, draftEchoes, historyEchoes]);

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
      // P2-22:用后即关——Chrome 对同时存活的 AudioContext 有硬上限,不 close 的话
      // 多次导入攒够数量后新建会静默失败(不抛错、也不出声),音效开关看似开着却哑掉。
      // suspended 守卫(review 修复):自动播放策略下(长导入后用户激活已过期)context 可能
      // 生而 suspended——振荡器根本不会播,onended 永不触发,泄漏原样发生。suspended 直接
      // 关掉放弃这次音效;再加 1s 兜底定时关,onended 无论如何丢失都不留活 context。
      if (ctx.state === 'suspended') {
        void ctx.close();
        return;
      }
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => void ctx.close();
      setTimeout(() => {
        if (ctx.state !== 'closed') void ctx.close();
      }, 1000);
    } catch {
      /* WebAudio 不可用则静默 */
    }
  }, [opts.sound, opts.soundStyle]);

  // ── 草稿动作 ──
  // 手动保存 = 强制 flush 并如实汇报:此前无条件 toast「已保存」,写失败也谎报成功(P0-1)。
  const save = useCallback(() => {
    pendingDraft.current = mdRef.current; // 即便无变更也强制写一次,让「保存」语义真实
    void flushDraft().then((ok) => showToast(ok ? t.savedToast : t.errStorageWrite, ok ? undefined : 'error'));
  }, [flushDraft, showToast, t.savedToast, t.errStorageWrite]);

  // 常驻错误条上的自救出口:把当前草稿(读 ref,含未落盘的 pending 值)下载成 .md 文件。
  const exportDraft = useCallback(() => {
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      downloadText(`markflow-draft-${stamp}.md`, mdRef.current, 'text/markdown');
      showToast(t.draftExported);
    } catch (err) {
      console.error('[MarkFlow] draft export failed:', err);
      showToast(t.errExportFail, 'error');
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
      // P2-24:读取失败(权限被拒/文件被移动等)此前无 onerror,拖拽高亮会永久卡住——
      // 清 dragging 并如实提示。专用「文件读取失败」词条(review 修复):报「写入失败」会让
      // 用户误以为是草稿持久化出了问题,实际坏的是拖进来的文件。
      reader.onerror = () => {
        setDragging(false);
        console.error('[MarkFlow] file read failed:', reader.error);
        showToast(`${t.errReadFail}: ${String(reader.error?.message ?? reader.error)}`, 'error');
      };
      reader.readAsText(file);
    },
    [md, setMd, showToast, t.importedToast, t.errReadFail],
  );

  // ── 预检 ──
  // P3 死代码清理:此前这里有 checkStep/`260ms × 5` 的逐步动画链,但 PreflightCard 只读
  // checkVisible(见其组件,grep 全仓零消费 checkStep)——动画状态从未被任何 UI 渲染,
  // 纯粹空转定时器。runCheck/closeCheck 本身保留(预检卡仍要开合),砍掉的只是这条死链。
  const runCheck = useCallback(() => {
    setCheckVisible(true);
  }, []);

  const closeCheck = useCallback(() => {
    setCheckVisible(false);
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

  // 收尾:历史条目 / 报告快照 / 是否异常由 buildRunRecord 按**本次运行**显式传入的 md + parseOpts 计算
  // (W1)——此前读组件闭包的 opts.obsidianImg/wikilink/taskList 而依赖数组漏了它们,切开关后不改稿直接
  // 写入,报告与历史就记下旧开关。口径见 lib/workspace/runRecord.ts。
  // toastMsg:成功收尾提示,默认「已写入」;标题/空替换场景由 startImport 组合后传入。
  const finishImport = useCallback((
    run: { md: string; parseOpts: RunParseOpts; adjust: CapabilityAdjust },
    toastMsg: string = t.writtenToast,
    imageFail = 0,
    blockCount = 0,
    imageFailures?: ImageFailure[],
  ) => {
    const { item, snapshot, hasAnomaly } = buildRunRecord({
      md: run.md,
      parseOpts: run.parseOpts,
      adjust: run.adjust,
      en,
      blockCount,
      imageFail,
      imageFailures,
      // UUID 而非 Date.now():双窗口同毫秒导入会撞 number id(React key 冲突、删除连删两条)。
      id: crypto.randomUUID(),
      now: new Date(),
    });

    setImporting(false);
    // W10:导入挂起期间(如标题 ask 弹窗)草稿已被改动 / 载入了别的内容——setMd 已按约定收起报告并清空
    // 快照(B4-6:快照与报告卡同生命周期),这里不再把旧稿的报告置回;本次结果照常写进历史。
    if (mdRef.current === run.md) {
      // autoReport 三档如实生效(P1-10):「仅异常时」(默认值)只在 hasAnomaly 时展开。
      setReportVisible(opts.autoReport === 'always' || (opts.autoReport === 'anomaly' && hasAnomaly));
      // B4-6(P2-25):报告卡的数据源在此钉死,后续 md 编辑/opts 切换/history 删改都不再影响它。
      setLastRunSnapshot(snapshot);
    }

    // 读 historyRef.current(最新值)而非闭包 history:标题 ask 弹窗挂起期间用户可能已在记录页
    // 删改历史,用陈旧闭包 commit 会复活已删条目并写回 storage(review P1)。
    commitHistory(pruneHistory([item, ...historyRef.current], opts.histLimit));

    if (opts.confetti) {
      setCelebrating(true);
      timers.current.celebrate = setTimeout(() => setCelebrating(false), 950);
    }
    showToast(toastMsg);
    playSound();
    // 写入成功后重探编辑器状态,更新 hasContent——否则「只探一次」的探针会让下次
    // ask 模式误判编辑器仍为空,直接静默 replace 覆盖刚写入的正文(review #3)。
    void refreshProbe();
    // 不读 md / 解析开关 / history 闭包:前两者由 run 显式传入,history 读 historyRef.current。
  }, [en, opts.autoReport, opts.histLimit, opts.confetti, commitHistory, showToast, t.writtenToast, playSound, refreshProbe]);

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
    async (
      mode: ImportMode,
      pinnedTarget?: { tabId: number; articleId: string | null },
      // onExisting=ask 的首次点击:权限申请(手势链首个 await)+ 即时探针之后,编辑器有内容
      // 则钉住目标、弹 OverwriteDialog 并提前返回;为空则按传入 mode(replace)继续写入。
      askIfContent = false,
      // B6:ask 确认路径(首次点击已申请过权限)——跳过 request 与 toast,只用 contains 重算
      // 未授权 origin 供失败改标。避免拒绝后确认覆盖时二次弹窗 + 二次 toast。
      permAlreadyRequested = false,
    ) => {
      // 同步闸门优先于一切:极快双击时第二次调用在这里直接短路,
      // 不会重复触发下载阶段(在任何 await 之前完成拦截)。
      if (importingRef.current) return;
      importingRef.current = true;
      setImporting(true);
      // B6:报告卡不在此处收起——ask 首次点击若弹 OverwriteDialog 后用户取消,上次报告应仍在;
      // 收起时机挪到 ask 提前 return 之后(见下方 setReportVisible(false))。
      try {
        setStageLabel(t.stParse);
        setStagePct(40);
        // 以下全同步(无 await),放在权限申请(首个 await)之前不破坏用户手势。

        // 标题抽取放在解析前:既决定后续是否设置标题,也决定要不要移除正文首个 H1。
        // h1Handle=remove:按块下标去掉被抽为标题的那个块(P4,parseMarkdownWithoutTitle)——不按块类型
        // 删(parser 把 H1/H2 都映射成 header-one,无法区分),也不再删 md 源行重解析(相邻行会重新拼接)。
        // P7:标题抽取 / 移除与正文解析用**同一份**解析开关(标题判定随开关变化,如 obsidianImg
        // 决定 `![[a.png]]\n标题\n===` 是否构成单行 setext),不继承上一次 parseMarkdown 的残留开关。
        const parseOpts = { obsidianImg: opts.obsidianImg, wikilink: opts.wikilink, taskList: opts.taskList };
        const extracted = opts.setTitle ? extractTitle(md, parseOpts) : null;
        const removeTitle = extracted?.source === 'h1' && opts.h1Handle === 'remove';
        let blocks = removeTitle ? parseMarkdownWithoutTitle(md, parseOpts) : parseMarkdown(md, parseOpts);

        // 封面来源:frontmatter cover > 正文首图。首图取自**已解析 blocks 的首个 ImageBlock**——
        // 与实际上传/移除同源,避免用 images() 全文正则误选到内联图 / 代码块内的图(review #1)。
        // 来源判定与素材板共用 pickCoverSource(第二批 W6)。
        const cover = pickCoverSource(md, blocks, opts.setCover);
        const coverSource = cover?.source ?? null;
        // 正文首图被抽走当封面时置真:引擎看到的图片序列比用户文档少第一张,回传的失败明细
        // index 需 +1 还原成「文档里的第 N 张图」,否则报告指错图(review 批次三)。
        let coverRemovedBodyImage = false;
        // coverKeep=remove:直接删掉这个作封面的图片块,避免封面在正文重复(删的正是拿去当封面的同一块,
        // 不再有「选 A 删 B」的错位)。
        if (cover?.bodyIndex != null && opts.coverKeep === 'remove') {
          const idx = cover.bodyIndex;
          blocks = blocks.filter((_, i) => i !== idx);
          coverRemovedBodyImage = true;
        }

        // 本次导入是否涉及本地图——谓词与 content 的 usesLocalImage 完全一致(blocks 里的
        // local 图,或本地路径封面),素材板同用(第二批 W6)。涉及则 content 会在导入结束后清 vault
        // handle(B5),成功收尾时需同步校准文件夹 UI 并提示用户(真机回归 T2)。
        const usesLocal = usesLocalImage(blocks, coverSource);

        // 远程图 / 封面 host 权限:首次点击时必须在用户手势内、任何其它 await 之前(上面全同步)。
        // 传**已解析的 blocks**(B3-4 / P1-7):权限申请的图片来源与实际上传的来源同一份,
        // 不再走全文正则(`<>` 包裹的远程图曾被判 local → 该 origin 不申请 → 下载必被拒)。
        // B6:ask 确认路径不再申请(首次点击已申请过),只 contains 重算,不弹窗、不 toast。
        const extraUrls = coverSource ? [coverSource] : [];
        const perm = permAlreadyRequested
          ? await queryRemoteImagePermissions(blocks, extraUrls)
          : await requestRemoteImagePermissions(blocks, extraUrls);
        // C25 / B4:被拒即时提示**确实未授权**的张数(按块计,含远程封面;已授权 origin 与被拦
        // 主机不计),导入照常继续(正文不受影响)。对方 `ACAO:*` 时无权限也可能下载成功,故文案
        // 只说「可能无法下载」。确认路径首次点击已提示过,不再重复。
        if (!permAlreadyRequested) {
          const deniedCount = countDeniedRemote(blocks, coverSource, perm.deniedOrigins);
          if (deniedCount > 0) showToast(t.permDeniedToast.replace('{n}', String(deniedCount)), 'error');
        }

        // review B1 + B2-1:正文写入前把目标 X 标签**一次**钉死并全程复用。ask 流程传入
        // pinnedTarget(writeX 探测时已钉的 tabId+articleId 双钥)则直接用——目标在弹窗
        // 弹出**之前**就定死,挂起期间切 tab/切文章都写不到别处(articleId 由 injector
        // 在 commit 前终验)。未传时(直写路径与 ask 首次点击)在**权限申请之后**才即时探针钉
        // 双钥:权限申请必须是手势链首个 await(HANDOFF §8 / imagePermissions 注释),探针放在
        // 其后,不让任何 tab-API await 排在权限申请之前(它们是否消耗/拖过瞬时激活未经证实,
        // 一律不赌);且权限弹窗结束时焦点仍在当前 X 草稿,此刻探测即准。
        // 探不到(切走了/非 X/非文章编辑页)→ 按 disconnected 提前返回,importing 由 finally 复位。
        let pinnedTabId: number;
        let expectedArticleId: string | null;
        if (pinnedTarget) {
          pinnedTabId = pinnedTarget.tabId;
          expectedArticleId = pinnedTarget.articleId;
        } else {
          const fresh = await probeXTabContent();
          if (!fresh.connected || fresh.tabId === null) {
            showToast(importErrorText('disconnected', t), 'error');
            void refreshProbe(); // 同步状态条,避免「已连接」假象下反复点击
            return;
          }
          pinnedTabId = fresh.tabId;
          expectedArticleId = fresh.articleId;
          if (askIfContent) {
            // review #5:用这次新鲜探针的 hasContent 决定 ask/replace,而非 useConnection 的陈旧
            // 快照;同步刷新共享状态条,与写入决策使用同一真相。
            void refreshProbe();
            if (fresh.hasContent) {
              // B2-1:弹窗**之前**就钉死 {tabId, articleId},确认后透传给 startImport(取消时清掉),
              // 挂起期间切到另一篇草稿也写不到别处。importing 由 finally 复位。
              // B6:首次点击时 request 必须是第一个 await(上方已做);确认路径不再申请——记下
              // permRequested,确认时 startImport 跳过 request 与 toast,只 contains 重算改标依据。
              pendingAskTarget.current = { tabId: pinnedTabId, articleId: expectedArticleId, permRequested: true };
              setAskOverwrite(true);
              return;
            }
            // 编辑器确为空 → 直接按传入 mode(replace)整体写入,沿用刚探测的目标。
          }
        }
        // B6:确定要写入了才收起上次的报告卡(ask 弹窗被取消时报告仍保留)。
        setReportVisible(false);

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
            toastMsg = `${toastMsg} · ${t.toastImages} ${res.imageOk}/${totalImg}`;
          }
          if (res.coverSet) toastMsg = `${toastMsg} · ${t.toastCover}`;
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
          if (usesLocal) {
            if (opts.activeFolder || opts.folder) toastMsg = `${toastMsg} · ${t.folderAutoCleared}`;
            void recalibrateFolders();
          }
          // 序号还原:首图被抽走当封面(coverKeep=remove)后,引擎回传的正文图 index 整体 +1
          // 才对应用户文档顺序;封面哨兵(index=-1)不动。
          let imageFailures = coverRemovedBodyImage
            ? res.imageFailures?.map((f) => (f.index >= 0 ? { ...f, index: f.index + 1 } : f))
            : res.imageFailures;
          // C25 / B4:来源 origin 确实未授权的「网络层失败」(无 host 权限的跨源 fetch 表现为
          // TypeError: Failed to fetch)改标为 remote-permission-denied,报告给出真实原因。
          // 只改被拒 origin 的这一类:已授权 origin 的同类失败(真网络故障)与 http 4xx/超时/
          // 非图片等明确原因保持原样(见 relabelPermissionFailures)。
          if (imageFailures) imageFailures = relabelPermissionFailures(imageFailures, perm.deniedOrigins);
          finishImport(
            // 第三批 P11:报告按实际写入计数(去掉被移除的标题块 / 作封面的正文首图),与上面同一判定。
            { md, parseOpts, adjust: { removeTitle, removeCoverImage: coverRemovedBodyImage } },
            toastMsg,
            res.imageFail,
            res.blockCount,
            imageFailures,
          );
        } else {
          // 失败:不写成功记录,以可读中文/英文提示错误(复位在 finally 统一处理)。
          // B2-2:提交后失败(committed)或通道超时(injector 可能仍在后台完成提交,content
          // 无从得知)→ 用「正文可能已写入」文案族,阻止用户按「失败」直觉重试造成整篇重复;
          // 并重探一次让状态条反映编辑器真实内容。
          const maybeCommitted = res.committed === true || res.error === 'timeout';
          if (maybeCommitted) {
            showToast(t.errFailedButCommitted, 'error');
            void refreshProbe();
          } else if (res.error === ARTICLE_SWITCHED_ERROR) {
            showToast(t.errArticleSwitched, 'error');
          } else {
            showToast(importErrorText(res.error, t), 'error');
          }
          // B5 的失败路径同步(review 修复):content 对「涉本地图的导入」**无论成败**都会清
          // vault handle,此前只有成功分支校准文件夹 UI——失败后素材板仍显示「已连接」,
          // 下次导入本地图静默找不到文件。失败也就地校准,UI 不撒谎。
          if (usesLocal) void recalibrateFolders();
        }
      } catch (err) {
        // 解析异常(如超深嵌套导致栈溢出)等意外:兜底提示,不留残局。
        showToast(`${t.errWriteFail}: ${String(err)}`, 'error');
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
    [md, t, opts, finishImport, showToast, askTitleConflict, recalibrateFolders, refreshProbe],
  );

  const writeX = useCallback(async () => {
    if (!md.trim() || importing || !connected) return;
    if (opts.onExisting === 'ask') {
      // ask 与直写路径同构:**不在此处先探针**——startImport 内的 host 权限申请必须是写入
      // 手势链上第一个 await(HANDOFF §8)。新鲜 hasContent 探测、双钥钉死(B2-1)与是否弹
      // OverwriteDialog 的判定,统一由 startImport 在权限申请**之后**完成(askIfContent)。
      void startImport('replace', undefined, true);
      return;
    }
    // 非询问模式:按设置直接决定模式(总是追加 / 总是覆盖)。同样**不在此处先探针**(疑点 1
    // 修复):多出的 `await probeXTabContent()` 会让权限申请不再是手势链首个 await,远程图权限
    // 弹窗可能越过 Chrome 的瞬时激活窗口被直接拒绝。双钥由 startImport 在权限申请**之后**
    // 即时探针钉死(仍在 importToXTab 之前,「探 A 写 B」防线不变)。
    const mode: ImportMode = opts.onExisting === 'append' ? 'append' : 'replace';
    void startImport(mode);
  }, [md, importing, connected, opts.onExisting, startImport]);

  // B6:确认路径透传「本轮已申请过权限」——startImport 跳过 request 与 toast(不二次弹窗)。
  const overwriteAppend = useCallback(() => {
    setAskOverwrite(false);
    const pinned = pendingAskTarget.current;
    pendingAskTarget.current = null;
    void startImport('append', pinned ?? undefined, false, pinned?.permRequested ?? false);
  }, [startImport]);
  const overwriteConfirm = useCallback(() => {
    setAskOverwrite(false);
    const pinned = pendingAskTarget.current;
    pendingAskTarget.current = null;
    void startImport('replace', pinned ?? undefined, false, pinned?.permRequested ?? false);
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
      // P3:此前无条件 toast「已复制」,clipboard reject(权限被拒/非安全上下文等)也照样
      // 谎报成功。改 promise 链——成功才提示成功,失败提示真实失败(error 型 toast,
      // 专用「复制失败」词条,不误报成「写入失败」)。clipboard 本身可能整个不存在
      // (非安全上下文/精简 webview,review 修复:直接点访问会同步 TypeError),先判存在。
      if (!navigator.clipboard?.writeText) {
        showToast(t.errCopyFail, 'error');
        return;
      }
      navigator.clipboard.writeText(item.md || '').then(
        () => showToast(t.copiedToast),
        (err) => {
          console.error('[MarkFlow] clipboard write failed:', err);
          showToast(t.errCopyFail, 'error');
        },
      );
    },
    [showToast, t.copiedToast, t.errCopyFail],
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
  // B4-4(P2-19):此前只清 history+draft 的内存态(commitHistory([])+setMd('')),设置与主题
  // 仍留在 storage 里——与「删除全部草稿、记录与设置」的文案(见 settings/config.ts wipe 行)
  // 不符。改为顺序 await 四个 store 的 remove*,全部落盘后再 reload——reload 是让 UI 与
  // storage 重新对齐的唯一自然路径,不必再手动 commitHistory/setMd 更新内存态。
  // 顺序而非并发:与 importBackup 的顺序执行同一考量,避免中途失败时不清楚删到哪一步。
  const wipeAll = useCallback(async () => {
    // 先掐死草稿持久化管线(review 修复):清防抖定时器与 pending,否则 reload 触发的
    // pagehide flush 会把刚删掉的草稿原样写回 storage——「清除所有数据」变成静默无效。
    // 内存态同步清空,双窗口经 onChanged 的 key 删除分支跟随。
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = undefined;
    }
    pendingDraft.current = null;
    mdRef.current = '';
    setMdState('');
    historyRef.current = [];
    setHistory([]);
    const hadFolder = opts.folder || opts.activeFolder;
    try {
      await removeDraft();
      await removeHistory();
      await removeOptions();
      await removePrefs();
      // 第二批 W9:本地图片文件夹授权(handle)存在 x.com 的 IndexedDB,只能经 X 页面的 content 清除——当前
      // 标签是 X 页时两级都清;不是则清不到,如实提示(否则 reload 后设置页 / 素材板挂载校准又把「已连接」写回,
      // 「清除所有数据」名不副实)。放在本地数据删完**之后**:清除请求最长要等超时,不能拖住数据删除。
      const folderResults = await Promise.all([clearFolder('active'), clearFolder('persistent')]);
      const folderLeft = hadFolder && folderResults.some((r) => !r.ok);
      if (folderLeft) {
        showToast(t.wipeFolderNotCleared, 'error');
        setTimeout(() => location.reload(), 3200); // 留时间读完提示再 reload
      } else {
        location.reload();
      }
    } catch (err) {
      // 任一删除失败:不 reload(用户能看到提示),如实报错——此前静默吞掉,用户点了
      // 「确认清除」却毫无反馈、数据可能只删了一半(review 修复)。
      console.error('[MarkFlow] wipeAll failed:', err);
      showToast(t.errWipeFail, 'error');
    }
  }, [showToast, t.errWipeFail, t.wipeFolderNotCleared, opts.folder, opts.activeFolder]);

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
      runCheck,
      closeCheck,
      importing,
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
      reportVisible,
      closeReport: () => setReportVisible(false),
      // 无快照时不置位:ReportCard 本就以 lastRunSnapshot 为渲染前提,这里再守一道避免空开。
      openReport: () => {
        if (lastRunSnapshot) setReportVisible(true);
      },
      lastRunSnapshot,
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
      capOpen, checkVisible, runCheck, closeCheck, importing, stagePct, stageLabel,
      writeX, askOverwrite, overwriteAppend, overwriteConfirm, overwriteCancel,
      askTitleOverwrite, pendingTitle, titleOverwriteConfirm, titleOverwriteKeep,
      reportVisible, lastRunSnapshot, celebrating, history, histQ, loadHistoryItem, copyHistoryItem,
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
