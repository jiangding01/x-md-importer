import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useProbe, type ProbeStatus } from '@/lib/bridge/useProbe';
import type { ProbeResult } from '@/lib/bridge/protocol';
import type { Dict } from '@/lib/i18n/dict';

const wrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  margin: '0 18px 10px',
  padding: '7px 11px',
  background: 'var(--p2)',
  borderRadius: 'var(--rEl)',
};

const probeStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  font: '500 9px var(--fMono)',
  color: 'var(--ink2)',
  letterSpacing: '.4px',
  whiteSpace: 'nowrap', // 中文标签禁止断字折行
  flex: 'none', // 三灯是主信息,空间不足时不收缩(让右侧长文案去省略)
};

/** 右侧状态文案:空间不足时收缩出省略号(hover 有 title 看全文),把宽度让给三灯。 */
const labelStyle: CSSProperties = {
  font: '500 8.5px var(--fMono)',
  color: 'var(--ink3)',
  letterSpacing: '.4px',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * 三灯的点色:只有拿到真实探针结果(status === 'ready')时才判定绿/红;
 * 其余状态(探测中 / 未连接 / 未就绪 / 超时)一律灰,表示「未知」而非「失败」。
 */
function dot(status: ProbeStatus, on: boolean): CSSProperties {
  const known = status === 'ready';
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: known ? (on ? 'var(--ok)' : 'var(--dgr)') : 'var(--ink3)',
    flex: 'none',
    animation: status === 'probing' ? 'pulse 1.1s ease infinite' : 'none',
  };
}

/** 把探针状态翻译为状态条右侧的一行文案。 */
function statusLabel(t: Dict, status: ProbeStatus, result: ProbeResult | null): string {
  switch (status) {
    case 'probing':
      return t.probeChecking;
    case 'disconnected':
      return t.probeDisconnected;
    case 'needs-refresh':
      return t.probeNeedsRefresh;
    case 'no-injector':
      return t.probeNoInjector;
    case 'timeout':
      return t.probeTimeout;
    case 'ready':
      return result?.articleId ? `${t.probeArticle} #${result.articleId}` : t.probeNoArticle;
  }
}

export function StatusBar() {
  const { t } = useI18n();
  const { status, result, loading, refresh } = useProbe();

  const lights: Array<{ label: string; on: boolean }> = [
    { label: t.pbEditor, on: result?.hasEditor ?? false },
    { label: t.pbDraft, on: result?.hasDraftNode ?? false },
    { label: t.pbUpload, on: result?.hasOnFilesAdded ?? false },
  ];

  return (
    <div style={wrap}>
      {lights.map((probe) => (
        <span key={probe.label} style={probeStyle}>
          <span style={dot(status, probe.on)} />
          {probe.label}
        </span>
      ))}
      <span style={{ flex: 1 }} />
      <span style={labelStyle} title={statusLabel(t, status, result)}>
        {statusLabel(t, status, result)}
      </span>
      <button
        className="mf-btn mf-hover-soft"
        onClick={refresh}
        disabled={loading}
        aria-label={t.probeRefresh}
        title={t.probeRefresh}
        style={{
          width: 18,
          height: 18,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'calc(var(--rEl) - 2px)',
          color: 'var(--ink3)',
          flex: 'none',
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 14 14"
          style={{ animation: loading ? 'pulse 1.1s ease infinite' : 'none' }}
        >
          <path
            d="M12.2 7A5.2 5.2 0 1 1 10.6 3.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path d="M12.4 2.6v3.4h-3.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
