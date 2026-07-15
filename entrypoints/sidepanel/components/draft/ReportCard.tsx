import { useMemo, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { capability } from '@/lib/markdown/capability';

const card: CSSProperties = {
  margin: '10px 18px 0',
  border: '1px solid var(--line)',
  borderRadius: 'calc(var(--rEl) + 4px)',
  overflow: 'hidden',
  animation: 'fadeUp .25s ease',
};

export function ReportCard() {
  const { t, lang } = useI18n();
  const { reportVisible, closeReport, md, history } = useWorkspace();
  const en = lang === 'en';
  const lastRun = history[0];

  // review B6-UI:useMemo 缓存 capability 解析(须在 return 之前,遵守 Hooks 规则);
  // 解析抛错由 App 层 ErrorBoundary 兜底。
  const items = useMemo(() => capability(md, en), [md, en]);

  if (!reportVisible || !lastRun) return null;

  const summary = `${lastRun.ok} ${t.rOk} · ${lastRun.deg} ${t.rDeg} · ${lastRun.fail} ${t.rFail}`;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'color-mix(in oklab,var(--ok),transparent 92%)' }}>
        <svg width="13" height="13" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" fill="none" stroke="var(--ok)" strokeWidth="1.4" />
          <path d="M4.8 8.2L7 10.4L11.2 5.8" fill="none" stroke="var(--ok)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ font: '600 11.5px var(--fUI)', color: 'var(--ink)' }}>{t.reportTitle}</span>
        <span style={{ flex: 1 }} />
        <span style={{ font: '500 10px var(--fUI)', color: 'var(--ink2)' }}>{summary}</span>
        <button className="mf-btn mf-hover-ink" onClick={closeReport} style={{ font: '500 12px var(--fUI)', color: 'var(--ink3)', padding: '0 2px' }}>
          ×
        </button>
      </div>
      {items.map((ci, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', borderTop: '1px solid var(--lsoft)' }}>
          <span style={{ width: 7, height: 7, flex: 'none', borderRadius: '50%', background: ci.badge === 'warn' ? 'var(--warn)' : 'var(--ok)' }} />
          <span style={{ flex: 'none', font: '500 11px var(--fUI)', color: 'var(--ink)' }}>{ci.label}</span>
          <span style={{ flex: 1, textAlign: 'right', font: '400 10px var(--fUI)', color: 'var(--ink2)' }}>
            {ci.badge === 'warn' ? ci.note : `${en ? 'ok' : '成功'} · ${ci.note}`}
          </span>
        </div>
      ))}
    </div>
  );
}
