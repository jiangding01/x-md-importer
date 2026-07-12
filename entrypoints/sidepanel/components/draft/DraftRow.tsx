import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '12px 18px 9px',
};

const importBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid var(--line)',
  background: 'none',
  padding: '5px 10px',
  borderRadius: 'var(--rEl)',
  font: '500 11px var(--fUI)',
  color: 'var(--accInk)',
  cursor: 'pointer',
};

export function DraftRow({ onImport }: { onImport: () => void }) {
  const { t } = useI18n();
  const { save, clear, clearArm } = useWorkspace();

  return (
    <div style={row}>
      <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.4px' }}>
        {t.draftLabel}
      </span>
      <span style={{ flex: 1 }} />
      <button
        className="mf-btn mf-hover-soft"
        onClick={save}
        style={{ padding: '5px 8px', borderRadius: 'var(--rEl)', font: '500 11px var(--fUI)', color: 'var(--ink2)' }}
      >
        {t.save}
      </button>
      <button
        className="mf-btn"
        onClick={clear}
        style={{
          padding: '5px 8px',
          borderRadius: 'var(--rEl)',
          font: '500 11px var(--fUI)',
          background: clearArm ? 'color-mix(in oklab,var(--dgr),transparent 88%)' : 'none',
          color: clearArm ? 'var(--dgr)' : 'var(--ink2)',
          transition: 'all .18s',
        }}
      >
        {clearArm ? t.clearConfirm : t.clear}
      </button>
      <button className="mf-btn mf-hover-acc" onClick={onImport} style={importBtn}>
        <svg width="10" height="10" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="8" />
          <path d="M3 5.5L6 8.5L9 5.5" />
          <line x1="1.5" y1="10.8" x2="10.5" y2="10.8" />
        </svg>
        {t.import}
      </button>
    </div>
  );
}
