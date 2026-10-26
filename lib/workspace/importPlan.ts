import { classifyImageSource, type ImageBlock, type ImportBlock } from '@/lib/bridge/protocol';
import { extractCover } from '@/lib/markdown/frontmatter';

/**
 * 封面来源(frontmatter cover > 正文首图)——素材板展示与写入流程共用(第二批 W6)。
 * 首图取自**已解析 blocks 的首个 ImageBlock**,与实际上传 / 移除同源(review #1)。
 * bodyIndex:取自正文首图时为该块在 blocks 中的下标(coverKeep=remove 据此删掉),frontmatter 来源为 null。
 * 关掉「设置文章封面」返回 null。
 */
export function pickCoverSource(
  md: string,
  blocks: ImportBlock[],
  setCover: boolean,
): { source: string; bodyIndex: number | null } | null {
  if (!setCover) return null;
  const fm = extractCover(md);
  if (fm) return { source: fm, bodyIndex: null };
  const i = blocks.findIndex((b) => b.kind === 'image');
  return i >= 0 ? { source: (blocks[i] as ImageBlock).source, bodyIndex: i } : null;
}

/**
 * 本次导入是否涉及本地图(正文里的本地图,或本地路径的封面)——谓词与 content 的 usesLocalImage 完全一致
 * (涉及则 content 导入后清 vault handle,B5)。素材板据此决定是否展示「本篇图片文件夹」行(第二批 W6:
 * 此前只看正文图,`cover: ./c.png` 时不显示入口,导入才报 local-no-folder)。
 */
export function usesLocalImage(blocks: ImportBlock[], coverSource: string | null): boolean {
  return (
    blocks.some((b) => b.kind === 'image' && classifyImageSource(b.source) === 'local') ||
    (coverSource !== null && classifyImageSource(coverSource) === 'local')
  );
}
