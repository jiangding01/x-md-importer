import type { CSSProperties } from 'react';

export function Celebration() {
  const dots = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const style: Record<string, string | number> = {
      position: 'absolute',
      width: 5,
      height: 5,
      borderRadius: i % 3 ? '50%' : 1,
      background: i % 2 ? 'var(--acc)' : 'var(--ok)',
      '--dx': `${Math.round(Math.cos(angle) * (28 + (i % 4) * 9))}px`,
      '--dy': `${Math.round(Math.sin(angle) * (24 + (i % 3) * 9))}px`,
      animation: 'burst .85s cubic-bezier(.2,.7,.4,1) forwards',
    };
    return <span key={i} style={style as CSSProperties} />;
  });
  return <span style={{ position: 'relative', display: 'block' }}>{dots}</span>;
}
