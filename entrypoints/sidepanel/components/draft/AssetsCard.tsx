import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { images, type ImageKind } from '@/lib/markdown/capability';

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

export function AssetsCard() {
  const { t } = useI18n();
  const { opts } = useSettings();
  const { md, showToast } = useWorkspace();

  const imgs = images(md);
  if (!md.trim() || (imgs.length === 0 && !opts.setCover)) return null;

  const kindLabel: Record<ImageKind, string> = { local: t.kindLocal, remote: t.kindRemote, data: t.kindData };
  const fmCover = /^cover\s*:/m.test(md);
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
        <button
          className="mf-btn mf-hover-soft"
          onClick={() => showToast(t.demoToast)}
          style={{ border: '1px solid var(--line)', padding: '4px 10px', borderRadius: 'var(--rEl)', font: '500 10px var(--fUI)', color: 'var(--ink2)' }}
        >
          {t.change}
        </button>
      </div>

      {imgs.map((im, i) => {
        const ready = im.kind === 'remote' ? true : im.kind === 'local' ? opts.folder : true;
        const status = ready ? t.stReady : im.kind === 'local' ? t.stNeedFolder : t.stNeedAuth;
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
              {im.src}
            </span>
            <span style={chip('ink2')}>{kindLabel[im.kind]}</span>
            <span style={chip(ready ? 'ok' : 'warn')}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}
