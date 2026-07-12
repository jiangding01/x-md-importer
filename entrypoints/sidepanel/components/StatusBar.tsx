import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useConnection } from '@/lib/bridge/useConnection';

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
};

function dot(on: boolean): CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: on ? 'var(--ok)' : 'var(--ink3)',
    flex: 'none',
  };
}

export function StatusBar() {
  const { t, lang } = useI18n();
  const { connected, route } = useConnection();
  const probes = [t.pbPage, t.pbEditor, t.pbUpload];

  return (
    <div style={wrap}>
      {probes.map((label) => (
        <span key={label} style={probeStyle}>
          <span style={dot(connected)} />
          {label}
        </span>
      ))}
      <span style={{ flex: 1 }} />
      <span style={{ font: '500 8.5px var(--fMono)', color: 'var(--ink3)', letterSpacing: '.4px' }}>
        {connected ? route : lang === 'en' ? 'NOT DETECTED' : '未检测'}
      </span>
    </div>
  );
}
