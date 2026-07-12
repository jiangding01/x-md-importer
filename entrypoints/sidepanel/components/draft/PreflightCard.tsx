import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useConnection } from '@/lib/bridge/useConnection';
import { images } from '@/lib/markdown/capability';

const card: CSSProperties = {
  margin: '10px 18px 0',
  border: '1px solid var(--line)',
  borderRadius: 'calc(var(--rEl) + 4px)',
  overflow: 'hidden',
  animation: 'fadeUp .25s ease',
};

export function PreflightCard() {
  const { t } = useI18n();
  const { opts } = useSettings();
  const { checkVisible, checkStep, closeCheck, md, editorHasContent } = useWorkspace();
  const { connected } = useConnection();

  if (!checkVisible) return null;

  const imgs = images(md);
  const assetsReady = imgs.every((im) => (im.kind === 'local' ? opts.folder : true));

  const items = [
    { label: t.ckPage, ok: connected, note: connected ? t.ckPageOk : t.ckFail },
    { label: t.ckEditor, ok: connected, note: connected ? t.ckEditorOk : '—' },
    { label: t.ckUpload, ok: connected, note: connected ? t.ckUploadOk : '—' },
    { label: t.ckContent, ok: true, note: editorHasContent ? t.ckContentHas : t.ckContentEmpty },
    { label: t.ckAssets, ok: assetsReady, note: assetsReady ? t.ckAssetsOk : t.stNeedFolder },
  ];

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', background: 'var(--p2)' }}>
        <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.4px' }}>{t.checkTitle}</span>
        <span style={{ flex: 1 }} />
        <button className="mf-btn mf-hover-ink" onClick={closeCheck} style={{ font: '500 12px var(--fUI)', color: 'var(--ink3)', padding: '0 2px' }}>
          ×
        </button>
      </div>
      {items.map((ck, i) => {
        const done = checkStep > i;
        const colorVar = ck.ok ? 'ok' : 'dgr';
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', borderTop: '1px solid var(--lsoft)' }}>
            <span
              style={{
                width: 15,
                height: 15,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                font: '600 9px var(--fMono)',
                color: done ? `var(--${colorVar})` : 'var(--ink3)',
                background: done ? `color-mix(in oklab,var(--${colorVar}),transparent 88%)` : 'var(--p2)',
                animation: done ? 'none' : 'pulse 1s ease infinite',
              }}
            >
              {done ? (ck.ok ? '✓' : '✕') : '·'}
            </span>
            <span style={{ flex: 'none', font: '500 11px var(--fUI)', color: 'var(--ink)' }}>{ck.label}</span>
            <span style={{ flex: 1, textAlign: 'right', font: '400 10px var(--fUI)', color: 'var(--ink2)' }}>
              {done ? ck.note : '…'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
