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
import { getFolderStatus, importToXTab, probeXTabContent, setTitleOnXTab } from '@/lib/bridge/importArticle';
import { resolveTargetXTab } from '@/lib/bridge/locateXTab';
import { requestRemoteImagePermissions } from '@/lib/bridge/imagePermissions';
import { classifyImageSource, type ImageBlock, type ImportMode, type SetTitleResponse } from '@/lib/bridge/protocol';
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
  const finishImport = useCallback((toastMsg: string = t.writtenToast, imageFail = 0, blockCount = 0) => {
    const cap = capability(md, en);
    const ok = Math.max(0, blockCount - imageFail);
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

        // 本次导入是否涉及本地图——谓词与 content 的 usesLocalImage 完全一致(blocks 里的
        // local 图,或本地路径封面)。涉及则 content 会在导入结束后清 vault handle(B5),
        // 成功收尾时需同步校准文件夹 UI 并提示用户(真机回归 T2)。
        const usesLocalImage =
          blocks.some((b) => b.kind === 'image' && classifyImageSource(b.source) === 'local') ||
          (coverSource !== null && classifyImageSource(coverSource) === 'local');

        // 远程图 / 封面 host 权限:必须在用户手势内、任何其它 await 之前(上面全同步)。
        await requestRemoteImagePermissions(md, coverSource ? [coverSource] : []);

        // review B1:正文写入前解析目标 X 标签**一次**并全程钉死。放在权限申请(首个 await)
        // 之后而非之前——权限申请必须是手势链首个 await(见 imagePermissions 注释),此处再解析
        // 不消耗手势;且权限弹窗结束时焦点仍在当前 X 草稿,此刻定位即准。拿不到(切走了/非 X)
        // → 按 disconnected 提前返回,importing 由 finally 复位。
        const pinnedTabId = await resolveTargetXTab();
        if (pinnedTabId === null) {
          showToast(importErrorText('disconnected', t));
          return;
        }

        // 写入中(等待 content → injector 直写)
        setStageLabel(t.stBody);
        setStagePct(75);
        // 压缩参数:compress 开时传 { maxEdge, quality };关时 null(content 侧不压)。
        const compress = opts.compress ? { maxEdge: opts.maxEdge, quality: Number(opts.quality) } : null;
        const res = await importToXTab(blocks, mode, coverSource, opts.scrollTop, compress, pinnedTabId);
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
          finishImport(toastMsg, res.imageFail, res.blockCount);
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
    [md, en, t, opts, finishImport, showToast, askTitleConflict, recalibrateFolders],
  );

  const writeX = useCallback(async () => {
    if (!md.trim() || importing || !connected) return;
    if (opts.onExisting === 'ask') {
      // review #5:陈旧探针快照可能把用户刚在 X 手打的内容误判为空 → 决定 ask/replace 前
      // 即时探一次拿新鲜 hasContent,而非依赖 useConnection 的 editorHasContent 快照。
      // 这几个 tab-API await 不消耗手势(仅 permissions.request 消耗),后续 startImport 里
      // 权限申请仍在手势窗口内(见其内注释)。
      const fresh = await probeXTabContent();
      void refreshProbe(); // 同步刷新共享状态条,与写入决策使用同一真相
      if (!fresh.connected) return; // 新鲜探测发现已断开 → 中止,不误写
      if (fresh.hasContent) {
        setAskOverwrite(true);
        return;
      }
      // 编辑器确为空 → 直接整体写入(与原空态行为一致:replace)。
      void startImport('replace');
      return;
    }
    // 非询问模式:按设置直接决定模式(总是追加 / 总是覆盖)。
    const mode: ImportMode = opts.onExisting === 'append' ? 'append' : 'replace';
    void startImport(mode);
  }, [md, importing, connected, opts.onExisting, startImport, refreshProbe]);

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
      tab, toast, showToast, md, setMd, mode, dragging, save, clear, clearArm, loadSample, readFile,
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
