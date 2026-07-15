import { useRef } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useConnection } from '@/lib/bridge/useConnection';
import { useProbe } from '@/lib/bridge/useProbe';
import { DraftRow } from './DraftRow';
import { EditorCard } from './EditorCard';
import { AssetsCard } from './AssetsCard';
import { CapabilityPanel } from './CapabilityPanel';
import { PreflightCard } from './PreflightCard';
import { ReportCard } from './ReportCard';
import { OverwriteDialog } from './OverwriteDialog';
import { TitleConflictDialog } from './TitleConflictDialog';
import { Footer } from './Footer';

/** X Articles 编辑器入口(新建/继续文章)。点「打开 X Articles」在新标签打开。 */
const X_ARTICLES_URL = 'https://x.com/compose/articles';

export function DraftTab() {
  const { t } = useI18n();
  const { readFile } = useWorkspace();
  const { connected } = useConnection();
  const { status } = useProbe();
  const fileRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => fileRef.current?.click();

  // 打开 X Articles:扩展环境走 chrome.tabs.create(当前窗口新开并激活);
  // 纯 UI 预览(无 chrome.tabs)降级为 window.open,不崩(与 store.ts 的环境守卫同思路)。
  const openXArticles = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url: X_ARTICLES_URL });
    } else {
      window.open(X_ARTICLES_URL, '_blank', 'noopener');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'fadeUp .3s ease' }}>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          readFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingBottom: 8 }}>
        {!connected && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              margin: '12px 18px 0',
              padding: '12px 14px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rEl)',
              background: 'var(--p2)',
            }}
          >
            <span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: 'var(--dgr)', animation: 'blinkDot 1.6s ease infinite' }} />
            <span style={{ flex: 1, font: '400 11px/1.5 var(--fUI)', color: 'var(--ink2)' }}>
              {status === 'needs-refresh' ? t.probeNeedsRefresh : t.noPageDesc}
            </span>
            <button
              className="mf-btn"
              onClick={openXArticles}
              style={{ flex: 'none', background: 'var(--btnBg)', color: 'var(--btnFg)', padding: '6px 13px', borderRadius: 'var(--btnR)', font: '500 11px var(--fUI)' }}
            >
              {t.openX}
            </button>
          </div>
        )}

        <DraftRow onImport={openFilePicker} />
        <EditorCard onImport={openFilePicker} />
        <AssetsCard />
        <CapabilityPanel />
        <PreflightCard />
        <ReportCard />
      </div>

      <OverwriteDialog />
      <TitleConflictDialog />
      <Footer />
    </div>
  );
}
