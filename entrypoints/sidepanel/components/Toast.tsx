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
        // 单行时 toast 高约 35px（半高 17.7px），18 仍 ≥ 半高，浏览器按半高钳制后与原来的 99
        // 渲染完全一致（短文案截图逐字节相同，零视觉回归）；而文案换行成多行后，99 的超大圆角
        // 会侵入首尾行的文字区域，18 才能保持圆角矩形的正常观感。
        borderRadius: 18,
        boxShadow: '0 14px 34px -10px rgba(0,0,0,.4)',
        animation: 'toastIn .32s cubic-bezier(.2,.9,.3,1.15)',
        font: '500 12px var(--fUI)',
        // 长文案（多段用 · 拼接）需要换行显示，而不是一路撑宽超出侧边栏
        whiteSpace: 'normal',
        // 中文默认逐字可断行，但长英文 URL/文件名等无空格 token 也要能在必要时断开，避免撑破容器
        overflowWrap: 'anywhere',
        // 侧边栏内 100vw 等于面板宽度，两侧各留 16px 安全边距，防止贴边溢出
        maxWidth: 'calc(100vw - 32px)',
        lineHeight: 1.45,
        textAlign: 'left',
        zIndex: 8,
      }}
    >
      {/* 父容器是 flex，文字换行后 svg 会被压扁变形，禁止收缩以保持 15×15 图标尺寸 */}
      <svg width="15" height="15" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
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
