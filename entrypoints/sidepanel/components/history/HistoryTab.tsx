import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

const smallBtn: CSSProperties = {
  flex: 'none',
  padding: '4px 5px',
  borderRadius: 6,
  font: '500 10px var(--fUI)',
  color: 'var(--ink3)',
};

/** 单删武装态保持时长:超时未确认自动回落为「×」。 */
const ARM_MS = 2600;
/**
 * 武装后的确认保护期:此期间点「确认删除?」不生效,且每次无效点击都重新计时。快速双击「×」
 * (两击间隔通常 < 400ms)第二击会落在原位出现的确认按钮上,不加保护就等于「双击即删」,
 * 二次确认形同虚设;连续狂点也只保持武装,停顿后单击才删除。删掉一条后下一行上移到光标下,
 * 继续点也只会先武装下一条。
 */
const CONFIRM_GUARD_MS = 400;

/** 记录行按钮的选择器(焦点跟随用;id 经 CSS.escape 转义)。 */
const delSel = (id: string | number): string => `[data-hist-del="${CSS.escape(String(id))}"]`;
const confirmSel = (id: string | number): string => `[data-hist-confirm="${CSS.escape(String(id))}"]`;

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
  const armedAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  // 武装 / 回落时被 visibility:hidden 藏起的按钮会丢焦点:记下「切换后该把焦点交给谁」,
  // 在 layout effect 里(新样式生效、浏览器修正焦点之前)交接,键盘用户不会失去焦点。
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);
  useLayoutEffect(() => {
    const sel = pendingFocus.current;
    if (!sel) return;
    pendingFocus.current = null;
    listRef.current?.querySelector<HTMLButtonElement>(sel)?.focus();
  }, [armedId]);

  const armDelete = (id: string | number, e: MouseEvent<HTMLButtonElement>) => {
    if (document.activeElement === e.currentTarget) pendingFocus.current = confirmSel(id);
    armedAt.current = Date.now();
    setArmedId(id);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => {
      // 回落时焦点若在确认按钮上,还给同一行的「×」
      if (listRef.current?.querySelector(confirmSel(id)) === document.activeElement) {
        pendingFocus.current = delSel(id);
      }
      setArmedId(null);
    }, ARM_MS);
  };
  const confirmDelete = (id: string | number) => {
    if (armedId !== id) return;
    // 保护期内的点击不算确认,并从这一击重新计时:一直连点只会保持武装、不会删除,
    // 必须停顿 ≥ CONFIRM_GUARD_MS 后再单击才确认(实测:仅从武装时刻起算时,间隔约 150ms
    // 连点 5 下会在第 3 下越过保护期而删掉一条)。
    if (Date.now() - armedAt.current < CONFIRM_GUARD_MS) {
      armedAt.current = Date.now();
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

      <div ref={listRef}>
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
                  <span
                    style={{
                      font: '400 9px var(--fMono)',
                      color: 'var(--ink3)',
                      letterSpacing: '.3px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {meta}
                  </span>
                </div>
                {/* 操作区:常态「载入 / 复制 / ×」与武装态「确认删除?」叠放在同一 grid 格内,只切
                    visibility——容器宽度恒为两者较宽者(常态更宽),武装 / 回落时整行零位移。
                    此前武装态把 × 换成「确认删除?」,按钮变宽把标题与「载入/复制」整体往左推。
                    确认按钮靠右、盖住 × 原位,原地连点两下的操作习惯不变(第二击受保护期约束)。 */}
                <div style={{ flex: 'none', display: 'grid', alignItems: 'center' }}>
                  <div
                    style={{
                      gridArea: '1 / 1',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      visibility: armedId === h.id ? 'hidden' : 'visible',
                    }}
                  >
                    <button
                      className="mf-btn mf-hover-acc"
                      onClick={() => loadHistoryItem(h)}
                      title={t.histLoad}
                      style={{ flex: 'none', border: '1px solid var(--line)', padding: '4px 9px', borderRadius: 6, font: '500 10px var(--fUI)', color: 'var(--ink2)', whiteSpace: 'nowrap' }}
                    >
                      {t.histLoad}
                    </button>
                    <button className="mf-btn mf-hover-ink" onClick={() => copyHistoryItem(h)} title={t.histCopy} style={{ ...smallBtn, whiteSpace: 'nowrap' }}>
                      {t.histCopy}
                    </button>
                    <button
                      className="mf-btn mf-hover-danger-text"
                      data-hist-del={String(h.id)}
                      onClick={(e) => armDelete(h.id, e)}
                      title={t.histDelete}
                      aria-label={t.histDelete}
                      style={{ ...smallBtn, font: '500 11px var(--fUI)' }}
                    >
                      ×
                    </button>
                  </div>
                  {/* 武装态直接显示「确认删除?」文字(对齐「清空全部→确认清空?」):此前只把 × 染成淡红底,
                      与 hover 的红字几乎无法区分,用户以为点了没反应、2.6s 后又自动回落。
                      淡入时长 ≈ 保护期,视觉上「按钮出现完」才可确认。 */}
                  <button
                    className="mf-btn"
                    data-hist-confirm={String(h.id)}
                    onClick={() => confirmDelete(h.id)}
                    title={t.histDeleteConfirm}
                    aria-label={t.histDeleteConfirm}
                    tabIndex={armedId === h.id ? 0 : -1}
                    style={{
                      gridArea: '1 / 1',
                      justifySelf: 'end',
                      padding: '4px 8px',
                      borderRadius: 6,
                      font: '500 10px var(--fUI)',
                      whiteSpace: 'nowrap',
                      color: 'var(--dgr)',
                      background: 'color-mix(in oklab,var(--dgr),transparent 88%)',
                      visibility: armedId === h.id ? 'visible' : 'hidden',
                      opacity: armedId === h.id ? 1 : 0,
                      transition: armedId === h.id ? `opacity ${CONFIRM_GUARD_MS}ms ease` : 'none',
                    }}
                  >
                    {t.histDeleteConfirm}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
