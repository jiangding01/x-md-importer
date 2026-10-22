import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

/**
 * 载入二次确认弹窗(review B3)。
 *
 * 「载入历史 / 导入 .md」与「清空」有同等破坏力——都会经 setMd 立即覆盖 storage 且不可撤销——
 * 但此前只有「清空」二次确认、「载入」直接生效。此弹窗补齐:仅当当前草稿非空且与将载入内容
 * 不同(requestLoad 判定)时弹出,确认才覆盖。样式仿 OverwriteDialog,与 arm 无关的即时确认。
 * 挂在 App 层级(而非 DraftTab),以便从「记录」Tab 触发载入时也可见(review B6-UI 同理)。
 */
export function LoadConfirmDialog() {
  const { t } = useI18n();
  const { loadConfirmOpen, loadConfirm, loadCancel } = useWorkspace();

  if (!loadConfirmOpen) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', padding: 32 }}>
      <div
        style={{
          width: '100%',
          // P2-30:同 OverwriteDialog——弹窗无 backdrop-filter,半透明 --p 会透字,改不透明 --pSolid。
          background: 'var(--pSolid)',
          border: '1px solid var(--pBorder)',
          borderRadius: 'calc(var(--rEl) + 6px)',
          padding: 20,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,.4)',
          animation: 'fadeUp .22s ease',
        }}
      >
        <div style={{ font: '600 13px var(--fUI)', color: 'var(--ink)' }}>{t.lcTitle}</div>
        <div style={{ font: '400 11px/1.7 var(--fUI)', color: 'var(--ink2)', marginTop: 6 }}>{t.lcDesc}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            className="mf-btn"
            onClick={loadConfirm}
            style={{ flex: 1, background: 'var(--btnBg)', color: 'var(--btnFg)', padding: '8px 0', borderRadius: 'var(--rEl)', font: '500 11.5px var(--fUI)' }}
          >
            {t.lcConfirm}
          </button>
          <button
            className="mf-btn mf-hover-ink"
            onClick={loadCancel}
            style={{ padding: '8px 14px', borderRadius: 'var(--rEl)', font: '500 11.5px var(--fUI)', color: 'var(--ink2)' }}
          >
            {t.lcCancel}
          </button>
        </div>
      </div>
    </div>
  );
}
