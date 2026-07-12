import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

export function Toast() {
  const { toast } = useWorkspace();
  if (!toast) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 64,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '9px 15px 9px 11px',
        background: 'var(--ink)',
        color: 'var(--p)',
        borderRadius: 99,
        boxShadow: '0 14px 34px -10px rgba(0,0,0,.4)',
        animation: 'toastIn .32s cubic-bezier(.2,.9,.3,1.15)',
        font: '500 12px var(--fUI)',
        whiteSpace: 'nowrap',
        zIndex: 8,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="none" stroke="var(--acc)" strokeWidth="1.4" />
        <path
          d="M4.8 8.2L7 10.4L11.2 5.8"
          fill="none"
          stroke="var(--acc)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="10"
          strokeDashoffset="10"
          style={{ animation: 'drawCheck .4s .15s ease forwards' }}
        />
      </svg>
      {toast}
    </div>
  );
}
