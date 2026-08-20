import { useEffect, useMemo, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { parseMarkdown } from '@/lib/markdown/parser';
import { classifyImageSource, type ImageBlock, type ImageSourceKind } from '@/lib/bridge/protocol';
import { extractCover } from '@/lib/markdown/frontmatter';
import { clearFolder, connectFolder, getFolderStatus } from '@/lib/bridge/importArticle';

const card: CSSProperties = {
  margin: '10px 18px 0',
  border: '1px solid var(--line)',
  borderRadius: 'calc(var(--rEl) + 4px)',
  overflow: 'hidden',
};

function chip(colorVar: string): CSSProperties {
  return {
    flex: 'none',
    font: '500 8.5px var(--fMono)',
    padding: '2px 7px',
    borderRadius: 99,
    color: `var(--${colorVar})`,
    background: `color-mix(in oklab,var(--${colorVar}),transparent 90%)`,
  };
}

/** 文件夹操作错误码 → 可读文案(与 SettingsTab 一致,不把英文诊断码弹给用户)。 */
function folderErrText(t: ReturnType<typeof useI18n>['t'], error: string): string {
  if (error === 'disconnected') return t.folderNeedXToast;
  if (error === 'permission-denied') return t.folderDeniedToast;
  if (error === 'timeout') return t.folderTimeoutToast;
  return t.folderFailToast;
}

/**
 * 素材板「本篇图片文件夹」入口(active 作用域,优先级高于设置默认文件夹)。仅当存在本地图时渲染。
 * 挂载时按 active 作用域向 content 校准真相(opts.activeFolder 只是 sidepanel 缓存);
 * 连接/更换走 connectFolder('active')、清除走 clearFolder('active')。未连接时若设置默认文件夹
 * 已连接,提示「将用默认文件夹」——与导入时 active>persistent 的读取优先级一致。
 */
function LocalFolderRow() {
  const { t } = useI18n();
  const { opts, setOpt } = useSettings();
  const { showToast } = useWorkspace();

  // 真相在 content 侧的 x.com IndexedDB(handle + 读权限);需已打开 X 页才能查,查不到则保持现状。
  useEffect(() => {
    void getFolderStatus('active').then((res) => {
      if (!res.ok) return;
      if (res.connected !== opts.activeFolder) setOpt('activeFolder', res.connected);
      if (res.folderName !== opts.activeFolderName) setOpt('activeFolderName', res.folderName);
    });
    // persistent 也校准:素材卡「就绪」判定依赖 opts.folder,若只靠 SettingsTab 挂载校准,用户
    // 不打开设置 tab 时 opts.folder 可能过期(重启后权限回落却仍缓存 true)→ 就绪撒谎、导入却降级。
    void getFolderStatus('persistent').then((res) => {
      if (!res.ok) return;
      if (res.connected !== opts.folder) setOpt('folder', res.connected);
      if (res.folderName !== opts.folderName) setOpt('folderName', res.folderName);
    });
    // 仅挂载校准一次;有意不依赖 opts,避免回填触发重复校准。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // forcePick=true=「更换」强制重选;false=「连接 / 恢复」,存量文件夹仅权限回落时一键复用。
  const doConnect = async (forcePick: boolean) => {
    showToast(t.folderGuideToast);
    const res = await connectFolder('active', forcePick);
    if (res.ok && res.connected) {
      setOpt('activeFolder', true);
      setOpt('activeFolderName', res.folderName);
      showToast(`${t.folderConnectedToast}${res.folderName ?? ''}`);
      return;
    }
    if (!res.ok && res.error !== 'cancelled') showToast(folderErrText(t, res.error), 'error');
  };

  const doClear = async () => {
    const res = await clearFolder('active');
    if (res.ok) {
      setOpt('activeFolder', false);
      setOpt('activeFolderName', null);
      showToast(t.folderClearedToast);
    } else {
      showToast(folderErrText(t, res.error), 'error');
    }
  };

  const connected = opts.activeFolder;
  // 未连接但仍有文件夹名 = 浏览器重启后权限回落、handle 仍在 → 可一键「恢复」(不必重选)。
  const resumable = !connected && opts.activeFolderName !== null;
  const statusText = connected
    ? (opts.activeFolderName ?? t.folderRowName)
    : resumable
      ? `${opts.activeFolderName} · ${t.folderReauth}`
      : opts.folder
        ? t.folderUsingDefault
        : t.folderNotConnected;

  const btn: CSSProperties = {
    border: '1px solid var(--line)',
    padding: '4px 10px',
    borderRadius: 'var(--rEl)',
    font: '500 10px var(--fUI)',
    color: 'var(--ink2)',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderTop: '1px solid var(--lsoft)' }}>
      <div
        style={{
          width: 44,
          height: 30,
          flex: 'none',
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'var(--p2)',
          display: 'grid',
          placeItems: 'center',
          font: '500 7.5px var(--fMono)',
          color: connected ? 'var(--ok)' : 'var(--ink3)',
        }}
      >
        DIR
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ font: '500 11.5px var(--fUI)', color: 'var(--ink)' }}>{t.folderRowName}</span>
        <span style={{ font: '400 10px var(--fUI)', color: connected ? 'var(--ink2)' : 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {statusText}
        </span>
      </div>
      {connected ? (
        <>
          {/* 更换 = 强制重选文件夹(forcePick) */}
          <button className="mf-btn mf-hover-soft" onClick={() => void doConnect(true)} style={btn}>
            {t.change}
          </button>
          <button className="mf-btn mf-hover-soft" onClick={() => void doClear()} style={btn}>
            {t.folderClear}
          </button>
        </>
      ) : resumable ? (
        <>
          {/* 恢复 = 复用存量 handle 一键重授权(非 forcePick);清除可彻底断开 */}
          <button className="mf-btn mf-hover-soft" onClick={() => void doConnect(false)} style={btn}>
            {t.folderResume}
          </button>
          <button className="mf-btn mf-hover-soft" onClick={() => void doClear()} style={btn}>
            {t.folderClear}
          </button>
        </>
      ) : (
        <button className="mf-btn mf-hover-soft" onClick={() => void doConnect(false)} style={btn}>
          {t.folderConnect}
        </button>
      )}
    </div>
  );
}

export function AssetsCard() {
  const { t } = useI18n();
  const { opts } = useSettings();
  const { md, showToast } = useWorkspace();

  // 口径与真实上传行为对齐:只有「独占行块级图」(parser 产出的 ImageBlock)才会被上传/选作封面,
  // 段落内的行内图不会——故这里必须用 parseMarkdown 的块级结果计数/渲染,而不是全文正则 images()。
  // 传 obsidianImg:关时 ![[x]] 不算图片块,素材计数与实际写入一致。
  // review B6-UI:用 useMemo 缓存解析——组件每次渲染都重跑 parseMarkdown 会在长文卡顿;
  // 且靠 App 层 ErrorBoundary 兜底 parser 抛错(不连累整树)。仅 md/obsidianImg 变化时重算。
  const imgs = useMemo(
    () => parseMarkdown(md, { obsidianImg: opts.obsidianImg }).filter((b): b is ImageBlock => b.kind === 'image'),
    [md, opts.obsidianImg],
  );
  if (!md.trim() || (imgs.length === 0 && !opts.setCover)) return null;

  // 是否含本地图(相对路径):有才展示「本篇图片文件夹」入口 + 就绪判定才涉及文件夹连接。
  const hasLocal = imgs.some((im) => classifyImageSource(im.source) === 'local');
  // 本地图就绪 = active(本篇)或 persistent(默认)任一已连接——与导入时 resolveLocalImageAcrossScopes 逐文件兜底一致。
  const folderReady = opts.activeFolder || opts.folder;

  const kindLabel: Record<ImageSourceKind, string> = { local: t.kindLocal, remote: t.kindRemote, data: t.kindData };
  // 与 extractCover 一致(仅 frontmatter、支持 Cover/封面),避免预览标签与实际行为不符。
  const fmCover = extractCover(md) !== null;
  const coverSource = opts.setCover ? (fmCover ? t.coverFm : imgs.length ? t.coverFirst : t.coverNone) : t.coverNone;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', background: 'var(--p2)' }}>
        <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.4px' }}>{t.assets}</span>
        <span style={{ flex: 1 }} />
        <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)' }}>{imgs.length} IMG</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderTop: '1px solid var(--lsoft)' }}>
        <div
          style={{
            width: 44,
            height: 30,
            flex: 'none',
            borderRadius: 6,
            border: '1px solid var(--line)',
            background: 'repeating-linear-gradient(45deg,var(--p2) 0 8px,transparent 8px 16px)',
            display: 'grid',
            placeItems: 'center',
            font: '500 7.5px var(--fMono)',
            color: 'var(--ink3)',
          }}
        >
          COVER
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ font: '500 11.5px var(--fUI)', color: 'var(--ink)' }}>{t.cover}</span>
          <span style={{ font: '400 10px var(--fUI)', color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {coverSource}
          </span>
        </div>
      </div>

      {hasLocal && <LocalFolderRow />}

      {imgs.map((im, i) => {
        const kind = classifyImageSource(im.source);
        // 本地图片(相对路径)现已支持:content 的 prepareOneImage local 分支从已连接文件夹读取。
        // 「就绪」取决于 active(本篇)或 persistent(默认)任一已连接;实际能否读到仍在写入时校验。
        const ready = kind !== 'local' || folderReady;
        const status = ready ? t.stReady : t.stNeedFolder;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', borderTop: '1px solid var(--lsoft)' }}>
            <span style={{ width: 5, height: 5, flex: 'none', borderRadius: '50%', background: 'var(--ink3)' }} />
            <span
              style={{
                flex: 1,
                font: '400 10.5px var(--fMono)',
                color: 'var(--ink2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                direction: 'rtl',
                textAlign: 'left',
              }}
            >
              {im.source}
            </span>
            <span style={chip('ink2')}>{kindLabel[kind]}</span>
            <span style={chip(ready ? 'ok' : 'warn')}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}
