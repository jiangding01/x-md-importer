import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useTheme } from '@/lib/theme/useTheme';

const wrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '14px 18px 11px',
};

const logo: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  background: 'var(--ink)',
  color: 'var(--p)',
  display: 'grid',
  placeItems: 'center',
  font: "700 14px var(--fDisp)",
  position: 'relative',
  transition: 'background .35s',
  flex: 'none',
};

const logoDot: CSSProperties = {
  position: 'absolute',
  right: -3,
  bottom: -3,
  width: 11,
  height: 11,
  borderRadius: '50%',
  background: 'var(--acc)',
  border: '2.5px solid var(--p)',
};

const segWrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'var(--p2)',
  borderRadius: 'var(--rEl)',
  padding: 2,
};

function segStyle(active: boolean, font: string): CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    borderRadius: 'calc(var(--rEl) - 2px)',
    padding: '3px 8px',
    cursor: 'pointer',
    font,
    transition: 'all .18s',
    background: active ? 'var(--p)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink2)',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
  };
}

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { dark, canToggleTheme, toggleTheme } = useTheme();

  return (
    <div style={wrap}>
      <div style={logo}>
        M
        <span style={logoDot} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: '600 13.5px var(--fDisp)', color: 'var(--ink)', letterSpacing: '-.2px' }}>
          MarkFlow
        </span>
        <span style={{ font: '500 8px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.6px' }}>
          {t.brandSub}
        </span>
      </div>

      <span style={{ flex: 1 }} />

      <div style={segWrap}>
        <button
          className="mf-btn"
          onClick={() => setLang('zh')}
          style={segStyle(lang === 'zh', '600 9.5px var(--fUI)')}
        >
          中
        </button>
        <button
          className="mf-btn"
          onClick={() => setLang('en')}
          style={segStyle(lang === 'en', '600 9px var(--fDisp)')}
        >
          EN
        </button>
      </div>

      {canToggleTheme && (
        <button
          className="mf-btn mf-hover-soft"
          onClick={toggleTheme}
          aria-label="toggle theme"
          style={{
            width: 27,
            height: 27,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid var(--line)',
            borderRadius: 'var(--rEl)',
            background: 'none',
            color: 'var(--ink2)',
            cursor: 'pointer',
          }}
        >
          {dark ? (
            // 当前暗色 → 显示太阳（点击切浅色）
            <svg width="12" height="12" viewBox="0 0 14 14">
              <circle cx="7" cy="7" r="3" fill="currentColor" />
              <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                <line x1="7" y1="0.8" x2="7" y2="2.4" />
                <line x1="7" y1="11.6" x2="7" y2="13.2" />
                <line x1="0.8" y1="7" x2="2.4" y2="7" />
                <line x1="11.6" y1="7" x2="13.2" y2="7" />
              </g>
            </svg>
          ) : (
            // 当前浅色 → 显示月牙（点击切暗色）
            <span style={{ position: 'relative', width: 11, height: 11, display: 'block' }}>
              <span
                style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'currentColor' }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: -4,
                  top: -3,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: 'var(--p)',
                }}
              />
            </span>
          )}
        </button>
      )}
    </div>
  );
}
