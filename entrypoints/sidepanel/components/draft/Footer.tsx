import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { useConnection } from '@/lib/bridge/useConnection';
import { useProbe } from '@/lib/bridge/useProbe';
import { Celebration } from './Celebration';

const barTrack: CSSProperties = {
  height: 4,
  borderRadius: 99,
  background: 'var(--p2)',
  marginTop: 9,
  overflow: 'hidden',
};

export function Footer() {
  const { t } = useI18n();
  const { md, importing, stageLabel, stagePct, runCheck, writeX, celebrating, lastRunSnapshot, reportVisible, openReport } =
    useWorkspace();
  const { connected } = useConnection();
  const { refresh: refreshProbe, loading: probing } = useProbe();

  // 展开预检卡片的同时触发一轮真实探测,而不是只展示上一轮的旧结果。
  const handleCheck = () => {
    runCheck();
    refreshProbe();
  };

  const empty = !md.trim();
  const writeDisabled = empty || importing || !connected;
  const stats = `${md.length.toLocaleString()} ${t.chars} · ${empty ? 0 : md.split('\n').length} ${t.lines} · UTF-8`;

  const barFill: CSSProperties = {
    height: '100%',
    width: `${stagePct}%`,
    borderRadius: 99,
    background: 'repeating-linear-gradient(90deg,var(--acc) 0 12px,color-mix(in oklab,var(--acc),transparent 35%) 12px 24px)',
    backgroundSize: '24px 100%',
    animation: 'barSlide .7s linear infinite',
    transition: 'width .35s ease',
  };

  const writeBtn: CSSProperties = {
    appearance: 'none',
    border: 'none',
    cursor: writeDisabled ? 'default' : 'pointer',
    padding: '7px 17px',
    borderRadius: 'var(--btnR)',
    background: writeDisabled ? 'var(--p2)' : 'var(--btnBg)',
    color: writeDisabled ? 'var(--ink3)' : 'var(--btnFg)',
    boxShadow: writeDisabled ? 'none' : 'var(--btnShadow)',
    font: '600 11.5px var(--fUI)',
    letterSpacing: '.3px',
    transition: 'all .2s',
  };

  return (
    <div style={{ position: 'relative', borderTop: '1px solid var(--line)' }}>
      {importing ? (
        <div style={{ padding: '11px 18px 13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ font: '500 10px var(--fMono)', color: 'var(--accInk)', animation: 'pulse 1.2s ease infinite' }}>{stageLabel}</span>
            <span style={{ flex: 1 }} />
            <span style={{ font: '500 9.5px var(--fMono)', color: 'var(--ink3)' }}>{stagePct}%</span>
          </div>
          <div style={barTrack}>
            <div style={barFill} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 18px 13px' }}>
          <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '.5px' }}>{stats}</span>
          <span style={{ flex: 1 }} />
          {/* C4:autoReport='never'(或 anomaly 下无异常)时报告不会自动弹出,失败明细此前永远
              看不到。有上次快照且报告卡未展开时给出手动入口;快照随草稿变更清空,入口随之消失。 */}
          {lastRunSnapshot && !reportVisible && (
            <button
              className="mf-btn mf-hover-soft"
              onClick={openReport}
              title={t.viewLastReportTip}
              aria-label={t.viewLastReportTip}
              style={{
                border: '1px solid var(--line)',
                padding: '7px 11px',
                borderRadius: 'var(--btnR)',
                font: '500 11.5px var(--fUI)',
                color: lastRunSnapshot.fail > 0 || (lastRunSnapshot.imageFailures?.length ?? 0) > 0 ? 'var(--dgr)' : 'var(--ink2)',
                cursor: 'pointer',
              }}
            >
              {t.viewLastReport}
              {lastRunSnapshot.fail > 0 ? ` · ${lastRunSnapshot.fail}` : ''}
            </button>
          )}
          <button
            className="mf-btn mf-hover-soft"
            onClick={handleCheck}
            disabled={probing}
            style={{
              border: '1px solid var(--line)',
              padding: '7px 14px',
              borderRadius: 'var(--btnR)',
              font: '500 11.5px var(--fUI)',
              color: probing ? 'var(--ink3)' : 'var(--ink2)',
              cursor: probing ? 'default' : 'pointer',
              opacity: probing ? 0.7 : 1,
            }}
          >
            {t.check}
          </button>
          <button className="mf-btn" onClick={writeX} disabled={writeDisabled} style={writeBtn}>
            {t.writeX}
          </button>
        </div>
      )}

      {celebrating && (
        <div style={{ position: 'absolute', right: 60, top: 8, pointerEvents: 'none' }}>
          <Celebration />
        </div>
      )}
    </div>
  );
}
