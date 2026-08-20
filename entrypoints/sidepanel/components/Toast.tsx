import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

export function Toast() {
  const { toast } = useWorkspace();
  if (!toast) return null;
  // B4-5(P2-27):error 型换叉图标 + 危险色(--dgr,主题里没有 --bad),success/中性沿用原勾图标。
  const isError = toast.kind === 'error';
  const iconColor = isError ? 'var(--dgr)' : 'var(--acc)';

  return (
    <div
      // B4-5(P2-27):toast 是屏幕阅读器需要主动感知的即时反馈,role+aria-live 让它被朗读
      // (polite 不打断当前朗读,排队等空隙播报;错误提示同样用 polite——assertive 会打断
      // 用户正在听的其他内容,toast 本身已用更长时长换取被看到/听到的机会,无需抢占)。
      role="status"
      aria-live="polite"
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
        // P2-30:同 Header logo——玻璃主题下 --p 半透明,前景文字被 --ink 底透出、可读性下降,
        // 改用不透明的 --pSolid(其余主题与 --p 同值,视觉零变化)。
        color: 'var(--pSolid)',
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
        <circle cx="8" cy="8" r="7" fill="none" stroke={iconColor} strokeWidth="1.4" />
        {isError ? (
          <path
            d="M5.4 5.4L10.6 10.6M10.6 5.4L5.4 10.6"
            fill="none"
            stroke={iconColor}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M4.8 8.2L7 10.4L11.2 5.8"
            fill="none"
            stroke={iconColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="10"
            strokeDashoffset="10"
            style={{ animation: 'drawCheck .4s .15s ease forwards' }}
          />
        )}
      </svg>
      {toast.msg}
    </div>
  );
}
