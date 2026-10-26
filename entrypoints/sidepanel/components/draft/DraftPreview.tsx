import { useI18n } from '@/lib/i18n/useI18n';
import { BlockList } from '@/lib/markdown/BlockPreview';
import { useDraftAnalysis } from '@/lib/workspace/DraftAnalysis';

/**
 * 编辑卡的预览(第三批 C3):读草稿页共享的那一次解析(C2),与能力面板 / 写入同一份块序列,
 * 渲染「写进 X 的样子」(见 lib/markdown/BlockPreview)。frontmatter 由解析器跳过,不再单独剥离。
 */
export function DraftPreview() {
  const { lang, t } = useI18n();
  const { md, analysis } = useDraftAnalysis();
  if (!md.trim()) {
    return (
      <div style={{ padding: '30px 0', textAlign: 'center', font: '400 11px var(--fUI)', color: 'var(--ink3)' }}>
        {lang === 'en' ? 'Nothing to preview yet' : '暂无内容可预览'}
      </div>
    );
  }
  return (
    <>
      <div
        style={{
          font: '400 10px/1.6 var(--fUI)',
          color: 'var(--ink3)',
          margin: '0 0 12px',
          paddingBottom: 8,
          borderBottom: '1px dashed var(--line)',
        }}
      >
        {t.previewNote}
      </div>
      <BlockList blocks={analysis.blocks} />
    </>
  );
}
