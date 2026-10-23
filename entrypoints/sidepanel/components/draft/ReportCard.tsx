import { useMemo, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { capability } from '@/lib/markdown/capability';
import type { Dict } from '@/lib/i18n/dict';
import type { ImageFailReason } from '@/lib/bridge/protocol';

/**
 * 失败原因码 → 词条键的对照表(模块级数据,与 protocol.ts IMAGE_FAIL_REASONS 一一对应,
 * 新增原因码时只改这张表);未知码(旧版本/坏备份)原样展示,不猜。
 */
const REASON_KEY: Record<ImageFailReason, keyof Dict> = {
  'remote-fetch-failed': 'rsnRemoteFetch',
  'remote-permission-denied': 'rsnRemotePermDenied',
  'local-not-found': 'rsnLocalNotFound',
  'local-no-folder': 'rsnLocalNoFolder',
  'local-permission-lapsed': 'rsnLocalPermLapsed',
  'local-ambiguous': 'rsnLocalAmbiguous',
  'local-too-large': 'rsnLocalTooLarge',
  'local-bad-type': 'rsnLocalBadType',
  'data-uri-invalid': 'rsnDataUri',
  'prepare-exception': 'rsnPrepEx',
  'prepare-missing': 'rsnPrepMissing',
  'upload-no-editor': 'rsnUpNoEditor',
  'upload-marker-lost': 'rsnUpMarkerLost',
  'upload-no-callback': 'rsnUpNoCallback',
  'upload-timeout': 'rsnUpTimeout',
  'upload-relocate-failed': 'rsnUpRelocate',
  'upload-exception': 'rsnUpEx',
  'marker-residue': 'rsnMarkerResidue',
  'cover-set-failed': 'rsnCoverSet',
  'orphan-media': 'rsnOrphanMedia',
  'media-order-uncertain': 'rsnMediaOrderUncertain',
};

function reasonText(reason: string, t: Dict): string {
  const key = (REASON_KEY as Record<string, keyof Dict | undefined>)[reason];
  return key ? t[key] : reason;
}

const card: CSSProperties = {
  margin: '10px 18px 0',
  border: '1px solid var(--line)',
  borderRadius: 'calc(var(--rEl) + 4px)',
  overflow: 'hidden',
  animation: 'fadeUp .25s ease',
};

export function ReportCard() {
  const { t, lang } = useI18n();
  const { reportVisible, closeReport, lastRunSnapshot } = useWorkspace();
  const en = lang === 'en';

  // B4-6(P2-25):明细(能力映射列表)与汇总(ok/deg/fail/imageFailures)统一读同一份
  // lastRunSnapshot——导入收尾时钉死的不可变快照,不是当前 md/当前设置(会随后续编辑/切换
  // 开关跳变),也不是 history[0](可被用户在「记录」页删除/清空,报告卡展开期间会突然
  // 失真)。此前明细读当前 md/opts、汇总读 history[0],二者数据源不一致正是 P2-25 的成因。
  // review B6-UI:useMemo 缓存 capability 解析(须在 return 之前,遵守 Hooks 规则);
  // 解析抛错由 App 层 ErrorBoundary 兜底。
  const items = useMemo(
    () => (lastRunSnapshot ? capability(lastRunSnapshot.md, en, lastRunSnapshot.parseOpts) : []),
    [lastRunSnapshot, en],
  );

  if (!reportVisible || !lastRunSnapshot) return null;

  const summary = `${lastRunSnapshot.ok} ${t.rOk} · ${lastRunSnapshot.deg} ${t.rDeg} · ${lastRunSnapshot.fail} ${t.rFail}`;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'color-mix(in oklab,var(--ok),transparent 92%)' }}>
        <svg width="13" height="13" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" fill="none" stroke="var(--ok)" strokeWidth="1.4" />
          <path d="M4.8 8.2L7 10.4L11.2 5.8" fill="none" stroke="var(--ok)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ font: '600 11.5px var(--fUI)', color: 'var(--ink)' }}>{t.reportTitle}</span>
        <span style={{ flex: 1 }} />
        <span style={{ font: '500 10px var(--fUI)', color: 'var(--ink2)' }}>{summary}</span>
        <button className="mf-btn mf-hover-ink" onClick={closeReport} style={{ font: '500 12px var(--fUI)', color: 'var(--ink3)', padding: '0 2px' }}>
          ×
        </button>
      </div>
      {items.map((ci, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', borderTop: '1px solid var(--lsoft)' }}>
          <span style={{ width: 7, height: 7, flex: 'none', borderRadius: '50%', background: ci.badge === 'warn' ? 'var(--warn)' : 'var(--ok)' }} />
          <span style={{ flex: 'none', font: '500 11px var(--fUI)', color: 'var(--ink)' }}>{ci.label}</span>
          <span style={{ flex: 1, textAlign: 'right', font: '400 10px var(--fUI)', color: 'var(--ink2)' }}>
            {ci.badge === 'warn' ? ci.note : `${en ? 'ok' : '成功'} · ${ci.note}`}
          </span>
        </div>
      ))}
      {lastRunSnapshot.imageFailures && lastRunSnapshot.imageFailures.length > 0 && (
        <div style={{ borderTop: '1px solid var(--lsoft)', padding: '8px 13px 10px', background: 'color-mix(in oklab,var(--dgr),transparent 95%)' }}>
          <div style={{ font: '600 10.5px var(--fUI)', color: 'var(--dgr)', marginBottom: 6 }}>{t.imgFailTitle}</div>
          {lastRunSnapshot.imageFailures.map((f, i) => (
            // key 用数组位置:index 语义是文档序号,坏备份可能重复,不适合当 React key。
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              <span style={{ font: '500 10.5px var(--fUI)', color: 'var(--ink)' }}>
                {/* index=-1 约定为封面(见 protocol.ts ImageFailure);≥0 为文档序号,展示 +1 */}
                {`${f.index < 0 ? t.imgFailCover : `${t.imgFailImage} ${f.index + 1}`} · ${f.stage === 'prepare' ? t.imgFailStagePrepare : t.imgFailStageUpload} · ${reasonText(f.reason, t)}`}
              </span>
              <span style={{ font: '400 9px var(--fMono)', color: 'var(--ink3)', wordBreak: 'break-all' }}>
                {f.source}
                {f.detail ? ` · ${f.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
