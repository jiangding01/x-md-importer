import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

const smallBtn: CSSProperties = {
  flex: 'none',
  padding: '4px 5px',
  borderRadius: 6,
  font: '500 10px var(--fUI)',
  color: 'var(--ink3)',
};

export function HistoryTab() {
  const { t } = useI18n();
  const {
    history,
    histQ,
    setHistQ,
    loadHistoryItem,
    copyHistoryItem,
    deleteHistoryItem,
    clearHistory,
    histClearArm,
  } = useWorkspace();

  // P2-26:单条删除此前一点即删,记录可能是文章唯一副本。改 arm 式二次确认,对齐清空
  // 全部(histClearArm)的既有模式——但按 id 记录武装态(而非一个全局布尔),否则点开
  // 任意一条的删除会把整份列表都变成「确认?」态。2.6s 超时未二次点击则自动回落。
  const [armedId, setArmedId] = useState<string | number | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);
  const handleDelete = (id: string | number) => {
    if (armedId !== id) {
      setArmedId(id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedId(null), 2600);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmedId(null);
    deleteHistoryItem(id);
  };

  const q = histQ.trim().toLowerCase();
  const filtered = history.filter(
    (h) => !q || h.title.toLowerCase().includes(q) || (h.md || '').toLowerCase().includes(q),
  );

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '6px 12px 18px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 6px 10px' }}>
        <span style={{ font: '600 13px var(--fUI)', color: 'var(--ink)' }}>{t.historyTitle}</span>
        <span style={{ font: '500 9.5px var(--fMono)', color: 'var(--ink3)' }}>
          {String(filtered.length).padStart(2, '0')}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="mf-btn"
          onClick={clearHistory}
          style={{
            padding: '4px 9px',
            borderRadius: 'var(--rEl)',
            font: '500 10.5px var(--fUI)',
            background: histClearArm ? 'color-mix(in oklab,var(--dgr),transparent 88%)' : 'none',
            color: histClearArm ? 'var(--dgr)' : 'var(--ink3)',
            transition: 'all .18s',
          }}
        >
          {histClearArm ? t.histClearConfirm : t.histClear}
        </button>
      </div>

      <input
        value={histQ}
        onChange={(e) => setHistQ(e.target.value)}
        placeholder={t.searchPh}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: '1px solid var(--line)',
          background: 'var(--p2)',
          borderRadius: 'var(--rEl)',
          padding: '8px 12px',
          font: '400 11.5px var(--fUI)',
          color: 'var(--ink)',
          marginBottom: 6,
        }}
      />

      {filtered.length === 0 ? (
        <div style={{ padding: '44px 0', textAlign: 'center', font: '400 11px var(--fUI)', color: 'var(--ink3)' }}>
          {t.histEmpty}
        </div>
      ) : (
        filtered.map((h) => {
          const meta = `${h.date} · ✓${h.ok}${h.deg ? ` · ~${h.deg}` : ''}${h.fail ? ` · ✕${h.fail}` : ''}`;
          return (
            <div
              key={h.id}
              className="mf-hist-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '11px 8px',
                borderRadius: 'var(--rEl)',
                borderBottom: '1px solid var(--lsoft)',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  flex: 'none',
                  borderRadius: 'var(--rEl)',
                  background: 'var(--p2)',
                  display: 'grid',
                  placeItems: 'center',
                  font: '600 8.5px var(--fMono)',
                  color: 'var(--ink2)',
                }}
              >
                MD
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ font: '600 12px var(--fUI)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.title}
                </span>
                <span style={{ font: '400 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '.3px' }}>{meta}</span>
              </div>
              <button
                className="mf-btn mf-hover-acc"
                onClick={() => loadHistoryItem(h)}
                title={t.histLoad}
                style={{ flex: 'none', border: '1px solid var(--line)', padding: '4px 9px', borderRadius: 6, font: '500 10px var(--fUI)', color: 'var(--ink2)' }}
              >
                {t.histLoad}
              </button>
              <button className="mf-btn mf-hover-ink" onClick={() => copyHistoryItem(h)} title={t.histCopy} style={smallBtn}>
                {t.histCopy}
              </button>
              <button
                className="mf-btn mf-hover-danger-text"
                onClick={() => handleDelete(h.id)}
                title={armedId === h.id ? t.histDeleteConfirm : t.histDelete}
                aria-label={armedId === h.id ? t.histDeleteConfirm : t.histDelete}
                style={{
                  ...smallBtn,
                  font: '500 11px var(--fUI)',
                  ...(armedId === h.id
                    ? { color: 'var(--dgr)', background: 'color-mix(in oklab,var(--dgr),transparent 88%)' }
                    : null),
                }}
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
