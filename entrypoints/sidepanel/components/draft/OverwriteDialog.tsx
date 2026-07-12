import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

export function OverwriteDialog() {
  const { t } = useI18n();
  const { askOverwrite, overwriteAppend, overwriteConfirm, overwriteCancel } = useWorkspace();

  if (!askOverwrite) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', padding: 32 }}>
      <div
        style={{
          width: '100%',
          background: 'var(--p)',
          border: '1px solid var(--pBorder)',
          borderRadius: 'calc(var(--rEl) + 6px)',
          padding: 20,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,.4)',
          animation: 'fadeUp .22s ease',
        }}
      >
        <div style={{ font: '600 13px var(--fUI)', color: 'var(--ink)' }}>{t.owTitle}</div>
        <div style={{ font: '400 11px/1.7 var(--fUI)', color: 'var(--ink2)', marginTop: 6 }}>{t.owDesc}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            className="mf-btn mf-hover-soft"
            onClick={overwriteAppend}
            style={{ flex: 1, border: '1px solid var(--line)', padding: '8px 0', borderRadius: 'var(--rEl)', font: '500 11.5px var(--fUI)', color: 'var(--ink)' }}
          >
            {t.owAppend}
          </button>
          <button
            className="mf-btn"
            onClick={overwriteConfirm}
            style={{ flex: 1, background: 'var(--btnBg)', color: 'var(--btnFg)', padding: '8px 0', borderRadius: 'var(--rEl)', font: '500 11.5px var(--fUI)' }}
          >
            {t.owOverwrite}
          </button>
          <button
            className="mf-btn mf-hover-ink"
            onClick={overwriteCancel}
            style={{ padding: '8px 10px', borderRadius: 'var(--rEl)', font: '500 11.5px var(--fUI)', color: 'var(--ink2)' }}
          >
            {t.owCancel}
          </button>
        </div>
      </div>
    </div>
  );
}
