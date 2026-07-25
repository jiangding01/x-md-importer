import { useMemo, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { capability, type CapBadge } from '@/lib/markdown/capability';

const badgeVar: Record<CapBadge, string> = { native: 'ok', special: 'acc', image: 'accInk', warn: 'warn' };

const card: CSSProperties = {
  margin: '10px 18px 0',
  border: '1px solid var(--line)',
  borderRadius: 'calc(var(--rEl) + 4px)',
  overflow: 'hidden',
};

export function CapabilityPanel() {
  const { t, lang } = useI18n();
  const { md, capOpen, toggleCap } = useWorkspace();
  const { opts } = useSettings();
  const en = lang === 'en';

  // review B6-UI:useMemo 缓存 capability 解析(必须在任何 return 之前,遵守 Hooks 规则)。
  // 长文时避免每次渲染重解析卡顿;解析抛错由 App 层 ErrorBoundary 兜底。
  // 传入 parseOpts:面板计数须与「实际会写入的内容」同一套解析开关,否则关掉
  // obsidianImg/wikilink/taskList 后面板仍按默认口径统计,与真实写入不一致。
  const items = useMemo(
    () => capability(md, en, { obsidianImg: opts.obsidianImg, wikilink: opts.wikilink, taskList: opts.taskList }),
    [md, en, opts.obsidianImg, opts.wikilink, opts.taskList],
  );

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
