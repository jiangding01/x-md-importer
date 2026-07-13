import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useProbe, type ProbeStatus } from '@/lib/bridge/useProbe';
import type { ProbeResult } from '@/lib/bridge/protocol';
import type { Dict } from '@/lib/i18n/dict';

const card: CSSProperties = {
  margin: '10px 18px 0',
  border: '1px solid var(--line)',
  borderRadius: 'calc(var(--rEl) + 4px)',
  overflow: 'hidden',
  animation: 'fadeUp .25s ease',
};

interface PreflightItem {
  label: string;
  ok: boolean;
  note: string;
}

/** status === 'ready' 时,把探针结果拆成四项真实预检行(目标页面/编辑器/Draft 实例/上传通道)。 */
function buildItems(t: Dict, result: ProbeResult): PreflightItem[] {
  const hasArticle = result.articleId !== null;
  return [
    {
      label: t.ckPage,
      ok: hasArticle,
      note: hasArticle ? `${t.ckPageOk} #${result.articleId}` : t.probeNoArticle,
    },
    { label: t.pbEditor, ok: result.hasEditor, note: result.hasEditor ? t.stReady : t.ckFail },
    { label: t.pbDraft, ok: result.hasDraftNode, note: result.hasDraftNode ? t.stReady : t.ckFail },
    { label: t.pbUpload, ok: result.hasOnFilesAdded, note: result.hasOnFilesAdded ? t.stReady : t.ckFail },
  ];
}

/** 非 ready 态(探测中/未连接/未就绪/超时)对应的全局提示文案,与 StatusBar 三灯条一致。 */
function globalMessage(t: Dict, status: ProbeStatus): string {
  switch (status) {
    case 'probing':
      return t.probeChecking;
    case 'disconnected':
      return t.probeDisconnected;
    case 'no-injector':
      return t.probeNoInjector;
    case 'timeout':
      return t.probeTimeout;
    case 'ready':
      return t.probeChecking; // 理论上不会走到(ready 必带 result),兜底用探测中文案
  }
}

export function PreflightCard() {
  const { t } = useI18n();
  const { checkVisible, closeCheck } = useWorkspace();
  const { status, result } = useProbe();

  if (!checkVisible) return null;

  const items = status === 'ready' && result ? buildItems(t, result) : null;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', background: 'var(--p2)' }}>
        <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '1.4px' }}>{t.checkTitle}</span>
        <span style={{ flex: 1 }} />
        <button className="mf-btn mf-hover-ink" onClick={closeCheck} style={{ font: '500 12px var(--fUI)', color: 'var(--ink3)', padding: '0 2px' }}>
          ×
        </button>
      </div>
      {items ? (
        items.map((it, i) => {
          const colorVar = it.ok ? 'ok' : 'dgr';
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
                  color: `var(--${colorVar})`,
                  background: `color-mix(in oklab,var(--${colorVar}),transparent 88%)`,
                }}
              >
                {it.ok ? '✓' : '✕'}
              </span>
              <span style={{ flex: 'none', font: '500 11px var(--fUI)', color: 'var(--ink)' }}>{it.label}</span>
              <span style={{ flex: 1, textAlign: 'right', font: '400 10px var(--fUI)', color: 'var(--ink2)' }}>{it.note}</span>
            </div>
          );
        })
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', borderTop: '1px solid var(--lsoft)' }}>
          <span
            style={{
              width: 6,
              height: 6,
              flex: 'none',
              borderRadius: '50%',
              background: status === 'probing' ? 'var(--accInk)' : 'var(--dgr)',
              animation: status === 'probing' ? 'pulse 1.1s ease infinite' : 'none',
            }}
          />
          <span style={{ font: '500 10.5px var(--fUI)', color: status === 'probing' ? 'var(--accInk)' : 'var(--dgr)' }}>
            {globalMessage(t, status)}
          </span>
        </div>
      )}
    </div>
  );
}
