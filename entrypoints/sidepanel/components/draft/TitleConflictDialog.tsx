import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

/**
 * 标题冲突询问弹窗:titleConflict='ask' 且编辑器已有标题时,写入正文后按需弹出。
 * 用户选「覆盖」→ 用新标题覆盖;「保留」→ 保持编辑器原标题(startImport 中的 askTitleConflict 兑现选择)。
 */
export function TitleConflictDialog() {
  const { t } = useI18n();
  const { askTitleOverwrite, pendingTitle, titleOverwriteConfirm, titleOverwriteKeep } = useWorkspace();

  if (!askTitleOverwrite) return null;

  // 注意:遮罩与内层 div **有意不设** onClick / ESC 关闭——弹窗挂起着 startImport 的 async 流程,
  // 唯一出口是覆盖/保留两个按钮(都经 settleTitleAsk 兑现 Promise)。日后若要加关闭路径,
  // **必须**同样调 settleTitleAsk,否则 resolver 悬挂、importing 永久 true、写入按钮卡死。
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', padding: 32 }}>
      <div
        style={{
          width: '100%',
          background: 'var(--p)',
          border: '1px solid var(--pBorder)',
          borderRadius: 'calc(var(--rEl) + 6px)',
          padding: 20,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,.4)',
          animation: 'fadeUp .22s ease',
        }}
      >
        <div style={{ font: '600 13px var(--fUI)', color: 'var(--ink)' }}>{t.tcTitle}</div>
        <div style={{ font: '400 11px/1.7 var(--fUI)', color: 'var(--ink2)', marginTop: 6 }}>{t.tcDesc}</div>
        {pendingTitle && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'var(--p2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rEl)',
            }}
          >
            <span style={{ font: '500 9px var(--fMono)', color: 'var(--ink3)', letterSpacing: '.5px' }}>{t.tcNewLabel}</span>
            <div style={{ font: '500 11.5px var(--fUI)', color: 'var(--ink)', marginTop: 2, wordBreak: 'break-word' }}>{pendingTitle}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            className="mf-btn mf-hover-soft"
            onClick={titleOverwriteKeep}
            style={{ flex: 1, border: '1px solid var(--line)', padding: '8px 0', borderRadius: 'var(--rEl)', font: '500 11.5px var(--fUI)', color: 'var(--ink)' }}
          >
            {t.tcKeep}
          </button>
          <button
            className="mf-btn"
            onClick={titleOverwriteConfirm}
            style={{ flex: 1, background: 'var(--btnBg)', color: 'var(--btnFg)', padding: '8px 0', borderRadius: 'var(--rEl)', font: '500 11.5px var(--fUI)' }}
          >
            {t.tcOverwrite}
          </button>
        </div>
      </div>
    </div>
  );
}
