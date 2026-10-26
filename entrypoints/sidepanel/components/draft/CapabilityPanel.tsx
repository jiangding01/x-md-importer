import { useMemo, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useDraftAnalysis } from '@/lib/workspace/DraftAnalysis';
import { capabilityFromAnalysis, type CapBadge } from '@/lib/markdown/capability';

const badgeVar: Record<CapBadge, string> = { native: 'ok', special: 'acc', image: 'accInk', warn: 'warn' };

const card: CSSProperties = {
  margin: '10px 18px 0',
  border: '1px solid var(--line)',
  borderRadius: 'calc(var(--rEl) + 4px)',
  overflow: 'hidden',
};

export function CapabilityPanel() {
  const { t, lang } = useI18n();
  const { capOpen, toggleCap } = useWorkspace();
  // 第三批 C2:取草稿页共享的那一次(延后的)解析。解析开关由 DraftAnalysisProvider 按当前设置传入——
  // 面板计数须与「实际会写入的内容」同一套开关,否则关掉 obsidianImg/wikilink/taskList 后口径不一致。
  const { md, analysis } = useDraftAnalysis();
  const en = lang === 'en';

  // useMemo 须在任何 return 之前(Hooks 规则);计数只遍历块,不再解析全文。
  const items = useMemo(() => capabilityFromAnalysis(analysis, en), [analysis, en]);

  if (!md.trim()) return null;

  const count = (badge: CapBadge) =>
    items.filter((c) => c.badge === badge).reduce((a, c) => a + c.count, 0);
  const summary =
    `${count('native')} ${t.capNative} · ${count('special')} ${t.capSpecial} · ${count('image')} ${t.capImage}` +
    (count('warn') ? ` · ${count('warn')} ${t.capDegrade}` : '');

  return (
    <div style={card}>
      <button
        className="mf-btn"
        onClick={toggleCap}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'var(--p2)', textAlign: 'left' }}
      >
        <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.4px' }}>
          {t.capTitle}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ font: '500 10px var(--fUI)', color: 'var(--ink2)' }}>{summary}</span>
        <span style={{ color: 'var(--ink3)', fontSize: 9, transform: capOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          ▾
        </span>
      </button>

      {capOpen &&
        items.map((ci, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', borderTop: '1px solid var(--lsoft)' }}>
            <span style={{ width: 7, height: 7, flex: 'none', borderRadius: 2, background: `var(--${badgeVar[ci.badge]})` }} />
            <span style={{ flex: 'none', font: '500 11px var(--fUI)', color: 'var(--ink)' }}>{ci.label}</span>
            <span style={{ flex: 'none', font: '500 9px var(--fMono)', color: 'var(--ink3)' }}>×{ci.count}</span>
            <span style={{ flex: 1, textAlign: 'right', font: '400 10px var(--fUI)', color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ci.note}
            </span>
          </div>
        ))}
    </div>
  );
}
