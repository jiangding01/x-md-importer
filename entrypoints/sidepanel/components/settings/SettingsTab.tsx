import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useTheme } from '@/lib/theme/useTheme';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useProbe } from '@/lib/bridge/useProbe';
import { settingsConfig, type SettingRow } from '@/lib/settings/config';
import { skinSwatch, SKINS, type Skin, type ThemeMode } from '@/lib/theme/themes';
import type { LangPref } from '@/lib/i18n/dict';
import type { Options } from '@/lib/settings/options';
import { clearFolder, connectFolder, getFolderStatus } from '@/lib/bridge/importArticle';
import { exportBackup, importBackup } from '@/lib/storage/backup';

/** 触发浏览器下载一个 JSON 文件(备份 / 诊断快照共用)。纯前端,失败静默。 */
function downloadJson(filename: string, data: unknown): void {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* 下载失败(极少见):静默,不影响其它设置 */
  }
}

function pill(on: boolean): CSSProperties {
  return {
    position: 'relative',
    width: 34,
    height: 20,
    flex: 'none',
    borderRadius: 99,
    border: 'none',
    cursor: 'pointer',
    background: on ? 'var(--acc)' : 'var(--p2)',
    boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--line)',
    transition: 'background .2s',
    padding: 0,
    marginTop: 2,
  };
}
function knob(on: boolean): CSSProperties {
  return {
    position: 'absolute',
    top: 3,
    left: on ? 17 : 3,
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,.25)',
    transition: 'left .2s cubic-bezier(.3,1.4,.4,1)',
  };
}

const defaultOpen: Record<string, boolean> = {
  ui: true,
  behavior: false,
  title: false,
  convert: false,
  media: false,
  feedback: false,
  data: false,
  keys: false,
  adv: false,
};

export function SettingsTab() {
  const { t, lang, langPref, setLang } = useI18n();
  const { skin, setSkin, theme, setTheme } = useTheme();
  const { opts, setOpt } = useSettings();
  const { showToast, wipeAll } = useWorkspace();
  const { status, result } = useProbe();

  const [openSec, setOpenSec] = useState<Record<string, boolean>>(defaultOpen);
  const [wipeArm, setWipeArm] = useState(false);
  // 备份「恢复」用的隐藏文件选择器(点「恢复」按钮触发)。
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const en = lang === 'en';
  const setOptRaw = setOpt as (k: string, v: unknown) => void;
  const sections = settingsConfig({ en, folderConnected: opts.folder, folderName: opts.folderName, wipeArm });

  const swatchLabel: Record<Skin, string> = {
    minimal: t.skinMinimal,
    console: t.skinConsole,
    paper: t.skinPaper,
    glass: t.skinGlass,
  };

  // 挂载时与真相校准:真实连接状态在 content 侧的 x.com IndexedDB(handle + 读权限),
  // opts.folder 只是 sidepanel 缓存。修「旧版演示遗留 folder:true」「浏览器重启后权限失效但仍显示已连接」
  // 这类撒谎态。需已打开 X 页才能查(getFolderStatus 走 content);查不到则保持现状,不误清。
  useEffect(() => {
    void getFolderStatus('persistent').then((res) => {
      if (!res.ok) return;
      if (res.connected !== opts.folder) setOpt('folder', res.connected);
      if (res.folderName !== opts.folderName) setOpt('folderName', res.folderName);
    });
    // 仅挂载校准一次;有意不依赖 opts,避免回填触发的重复校准。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 文件夹操作错误码 → 可读文案(不把英文诊断码直接弹给用户)。 */
  const folderErrText = (error: string): string => {
    if (error === 'disconnected') return t.folderNeedXToast;
    if (error === 'permission-denied') return t.folderDeniedToast;
    if (error === 'timeout') return t.folderTimeoutToast;
    return t.folderFailToast;
  };

  // 本地图片文件夹「连接 / 清除」——浮层出现在 X 页面(需页面手势触发 showDirectoryPicker),
  // sidepanel 侧只负责发消息、透传结果、更新 opts.folder(连接状态)+ opts.folderName(显示名)。
  const handleFolderAction = async () => {
    if (opts.folder) {
      const res = await clearFolder('persistent');
      if (res.ok) {
        setOpt('folder', false);
        setOpt('folderName', null);
        showToast(t.folderClearedToast);
      } else {
        showToast(folderErrText(res.error));
      }
      return;
    }

    showToast(t.folderGuideToast);
    const res = await connectFolder('persistent');
    if (res.ok && res.connected) {
      setOpt('folder', true);
      setOpt('folderName', res.folderName);
      showToast(`${t.folderConnectedToast}${res.folderName ?? ''}`);
      return;
    }
    if (!res.ok && res.error !== 'cancelled') showToast(folderErrText(res.error));
  };

  /** 快捷键:打开 Chrome 的扩展快捷键设置页(纯 UI 预览无 chrome.tabs 时提示地址)。 */
  const openShortcuts = () => {
    const url = 'chrome://extensions/shortcuts';
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) void chrome.tabs.create({ url });
    else showToast(t.shortcutsHint);
  };

  /** 诊断:导出探针快照 + 设置 + 环境信息的 JSON(报障用)。 */
  const exportDiagnostics = () => {
    const version =
      typeof chrome !== 'undefined' && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest().version
        : 'preview';
    downloadJson(`markflow-diagnostics-${Date.now()}.json`, {
      app: 'markflow',
      kind: 'diagnostics',
      at: new Date().toISOString(),
      version,
      ua: navigator.userAgent,
      probe: { status, result },
      prefs: { skin, theme, langPref },
      options: opts,
    });
    showToast(t.diagExported);
  };

  /** 备份:导出全部本地数据(偏好/设置/记录/草稿)为 JSON。 */
  const doExportBackup = async () => {
    try {
      downloadJson(`markflow-backup-${Date.now()}.json`, await exportBackup());
      showToast(t.backupExported);
    } catch {
      showToast(t.backupExportFail);
    }
  };

  /** 恢复:读用户选的备份 JSON → 写回 storage → 刷新面板重读生效。 */
  const doRestoreBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许再次选同一文件
    if (!file) return;
    try {
      await importBackup(JSON.parse(await file.text()));
      showToast(t.backupRestored);
      setTimeout(() => window.location.reload(), 700); // reload 后 main.tsx 重新从 storage 读取
    } catch {
      showToast(t.backupRestoreFail);
    }
  };

  const renderControl = (row: SettingRow) => {
    if (row.t === 'toggle') {
      // 装饰开关(未接实现)→ 置灰 + 固定显示 off、不可点(诚实呈现「未生效」)。
      const on = row.disabled ? false : Boolean(opts[row.k as keyof Options]);
      return (
        <button
          className="mf-btn"
          disabled={row.disabled}
          onClick={row.disabled ? undefined : () => setOptRaw(row.k, !on)}
          style={{ ...pill(on), ...(row.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null) }}
        >
          <span style={knob(on)} />
        </button>
      );
    }
    if (row.t === 'select') {
      let val = String(opts[row.k as keyof Options] ?? '');
      if (row.k === 'lang') val = langPref;
      if (row.k === 'appearance') val = theme;
      // 装饰 select 置灰:固定展示「生效档」(opts 首位),不读可能过期的存储值。
      if (row.disabled) val = row.opts[0]?.v ?? val;
      const onChange = (v: string) => {
        if (row.k === 'lang') setLang(v as LangPref);
        else if (row.k === 'appearance') setTheme(v as ThemeMode);
        else setOptRaw(row.k, v);
      };
      return (
        <div style={{ position: 'relative', flex: 'none', ...(row.disabled ? { opacity: 0.4 } : null) }}>
          <select
            value={val}
            disabled={row.disabled}
            onChange={(e) => onChange(e.target.value)}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              border: '1px solid var(--line)',
              background: 'var(--p)',
              borderRadius: 'var(--rEl)',
              padding: '5px 24px 5px 10px',
              font: '500 11px var(--fUI)',
              color: 'var(--ink)',
              cursor: row.disabled ? 'not-allowed' : 'pointer',
              maxWidth: 150,
            }}
          >
            {row.opts.map((op) => (
              <option key={op.v} value={op.v}>
                {op.label}
              </option>
            ))}
          </select>
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-55%)', pointerEvents: 'none', color: 'var(--ink3)', fontSize: 7.5 }}>
            ▼
          </span>
        </div>
      );
    }
    // action
    const danger = Boolean(row.danger);
    // 备份行:特殊渲染「导出 + 恢复」双按钮 + 隐藏文件选择器(单 actLabel 装不下两个动作)。
    if (row.k === 'backup') {
      const actBtn: CSSProperties = {
        flex: 'none',
        border: '1px solid var(--line)',
        background: 'none',
        padding: '5px 12px',
        borderRadius: 'var(--rEl)',
        font: '500 10.5px var(--fUI)',
        color: 'var(--ink2)',
      };
      return (
        <div style={{ display: 'flex', gap: 6, flex: 'none', marginTop: 2 }}>
          <button className="mf-btn mf-hover-soft" onClick={() => void doExportBackup()} style={actBtn}>
            {t.backupExport}
          </button>
          <button className="mf-btn mf-hover-soft" onClick={() => restoreInputRef.current?.click()} style={actBtn}>
            {t.backupRestore}
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => void doRestoreBackup(e)}
          />
        </div>
      );
    }
    const onAct = () => {
      if (row.k === 'folder') {
        void handleFolderAction();
        return;
      }
      if (row.k === 'wipe') {
        if (!wipeArm) {
          setWipeArm(true);
          setTimeout(() => setWipeArm(false), 2600);
          return;
        }
        setWipeArm(false);
        wipeAll();
        showToast(en ? 'All data erased' : '所有数据已清除');
        return;
      }
      if (row.k === 'shortcuts') return openShortcuts();
      if (row.k === 'diag') return exportDiagnostics();
      showToast(t.demoToast);
    };
    return (
      <button
        className={danger ? 'mf-btn mf-hover-danger' : 'mf-btn mf-hover-soft'}
        onClick={onAct}
        style={{
          flex: 'none',
          border: `1px solid ${danger ? 'var(--dgr)' : 'var(--line)'}`,
          background: 'none',
          padding: '5px 12px',
          borderRadius: 'var(--rEl)',
          font: '500 10.5px var(--fUI)',
          color: danger ? 'var(--dgr)' : 'var(--ink2)',
          marginTop: 2,
        }}
      >
        {row.actLabel}
      </button>
    );
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '4px 18px 22px', animation: 'fadeUp .3s ease' }}>
      {/* 界面主题四宫格（常驻） */}
      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ font: '500 12.5px var(--fUI)', color: 'var(--ink)' }}>{t.stSkin}</span>
          <span style={{ font: '400 10.5px/1.5 var(--fUI)', color: 'var(--ink2)' }}>{t.stSkinDesc}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
          {SKINS.map((id) => {
            const sw = skinSwatch[id];
            const active = skin === id;
            return (
              <button
                key={id}
                className="mf-btn"
                onClick={() => setSkin(id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 4px 7px',
                  cursor: 'pointer',
                  borderRadius: 'var(--rEl)',
                  border: active ? '1.5px solid var(--acc)' : '1px solid var(--line)',
                  background: active ? 'var(--accSoft)' : 'transparent',
                  transition: 'all .18s',
                }}
              >
                <span style={{ position: 'relative', width: 40, height: 26, borderRadius: 6, background: sw.desk, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden', display: 'block' }}>
                  <span style={{ position: 'absolute', right: 4, top: 4, bottom: 4, width: 14, borderRadius: 3, background: sw.panel, boxShadow: `0 0 0 1px ${sw.pBorder}`, display: 'block' }}>
                    <span style={{ position: 'absolute', left: 4, top: 4, width: 4, height: 4, borderRadius: '50%', background: sw.dot, display: 'block' }} />
                  </span>
                </span>
                <span style={{ font: `${active ? 600 : 500} 10px var(--fUI)`, color: active ? 'var(--ink)' : 'var(--ink2)' }}>
                  {swatchLabel[id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 九组折叠分区 */}
      {sections.map((sec) => {
        const open = openSec[sec.id];
        return (
          <div key={sec.id} style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 'calc(var(--rEl) + 4px)', overflow: 'hidden' }}>
            <button
              className="mf-btn"
              onClick={() => setOpenSec((s) => ({ ...s, [sec.id]: !s[sec.id] }))}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', background: 'var(--p2)', textAlign: 'left' }}
            >
              <span style={{ font: '600 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.6px' }}>{sec.num}</span>
              <span style={{ font: '600 12px var(--fUI)', color: 'var(--ink)' }}>{sec.title}</span>
              <span style={{ flex: 1 }} />
              <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)' }}>{String(sec.rows.length).padStart(2, '0')}</span>
              <span style={{ color: 'var(--ink3)', fontSize: 9, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
            </button>
            {open &&
              sec.rows.map((row) => (
                <div key={row.k} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 13px', borderTop: '1px solid var(--lsoft)' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ font: '500 12px var(--fUI)', color: 'var(--ink)' }}>{row.label}</span>
                    <span style={{ font: '400 10.5px/1.5 var(--fUI)', color: 'var(--ink2)' }}>{row.desc}</span>
                  </div>
                  {renderControl(row)}
                </div>
              ))}
          </div>
        );
      })}

      <div style={{ padding: '24px 0 0', textAlign: 'center', font: '400 8.5px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.2px' }}>
        MARKFLOW v3.0 · MD → X · LOCAL ONLY, NO TELEMETRY
      </div>
    </div>
  );
}
