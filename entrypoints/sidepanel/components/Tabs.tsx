import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import type { Tab } from '../types';

const wrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '0 12px',
  borderBottom: '1px solid var(--line)',
};

function tabStyle(active: boolean): CSSProperties {
  return {
    appearance: 'none',
    background: 'none',
    border: 'none',
    position: 'relative',
    padding: '10px 12px 12px',
    cursor: 'pointer',
    font: '500 12px var(--fUI)',
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--ink)' : 'var(--ink2)',
    transition: 'color .18s',
  };
}

function barStyle(active: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: -1,
    height: 2,
    borderRadius: 2,
    background: 'var(--tabBar)',
    opacity: active ? 1 : 0,
    transition: 'opacity .18s',
  };
}

interface TabsProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
}

export function Tabs({ tab, onTab }: TabsProps) {
  const { t } = useI18n();
  const items: { id: Tab; label: string }[] = [
    { id: 'draft', label: t.tabDraft },
    { id: 'history', label: t.tabHistory },
    { id: 'settings', label: t.tabSettings },
  ];

  return (
    <div style={wrap}>
      {items.map(({ id, label }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            className="mf-btn mf-hover-ink"
            onClick={() => onTab(id)}
            style={tabStyle(active)}
          >
            {label}
            <span style={barStyle(active)} />
          </button>
        );
      })}
    </div>
  );
}
