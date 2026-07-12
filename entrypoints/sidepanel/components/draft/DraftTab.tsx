import { useRef } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useConnection } from '@/lib/bridge/useConnection';
import { DraftRow } from './DraftRow';
import { EditorCard } from './EditorCard';
import { AssetsCard } from './AssetsCard';
import { CapabilityPanel } from './CapabilityPanel';
import { PreflightCard } from './PreflightCard';
import { ReportCard } from './ReportCard';
import { OverwriteDialog } from './OverwriteDialog';
import { Footer } from './Footer';

export function DraftTab() {
  const { t } = useI18n();
  const { readFile, showToast } = useWorkspace();
  const { connected } = useConnection();
  const fileRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => fileRef.current?.click();

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
            <span style={{ flex: 1, font: '400 11px/1.5 var(--fUI)', color: 'var(--ink2)' }}>{t.noPageDesc}</span>
            <button
              className="mf-btn"
              onClick={() => showToast(t.demoToast)}
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
      <Footer />
    </div>
  );
}
