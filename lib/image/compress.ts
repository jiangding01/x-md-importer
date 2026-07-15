/**
 * 图片压缩(canvas 缩放 + JPEG 重编码)—— 运行于 **content(ISOLATED world,有 DOM)**:
 * 在图片准备阶段对准备好的 File 就地压缩,减小上传体积、更快、更抗 X 限流。
 *
 * 策略(与设置项 compress/maxEdge/quality 对应):
 *  - 仅压 jpeg/png/webp;**gif 跳过**(动图转 JPEG 会丢帧)、其它类型原样返回;
 *  - 小于阈值(150KB)不压(收益小);
 *  - 透明区**铺白底**再画(JPEG 无 alpha,否则透明变黑);
 *  - `maxEdge='orig'` 不缩放尺寸、仅按 quality 重编码;否则等比缩放到长边上限;
 *  - **压完更大 / 失败 → 返回原 File**(不帮倒忙);任何异常都吞掉、退回原图。
 */

/** 可压缩的位图类型;gif(动图)与其它一律跳过。 */
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** 小于此体积不压(收益小、还可能越压越大)。 */
const MIN_COMPRESS_BYTES = 150 * 1024;

/** 长边上限档 → 像素;'orig' 表示不限尺寸(不缩放,仅重编码)。 */
function maxEdgePx(maxEdge: string): number {
  return maxEdge === 'orig' ? Number.POSITIVE_INFINITY : Number(maxEdge);
}

/**
 * 压缩单张图片。gate 不满足 / 压后更大 / 任何异常 → 原样返回入参 File(绝不抛错)。
 * @param file    已准备好的图片 File。
 * @param maxEdge 长边上限档('960' | '1280' | '1600' | 'orig')。
 * @param quality JPEG 质量(0-100)。
 */
export async function compressImage(file: File, maxEdge: string, quality: number): Promise<File> {
  if (!COMPRESSIBLE.has(file.type) || file.size <= MIN_COMPRESS_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const max = maxEdgePx(maxEdge);
    const longEdge = Math.max(width, height);
    if (longEdge > max) {
      const scale = max / longEdge;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    // 铺白底:JPEG 无 alpha,透明区不铺白会变黑。
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const q = Math.min(1, Math.max(0, quality / 100));
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', q),
    );
    // 压完更大 / 失败 → 用原图(小图、已压过的照片常越压越大)。
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file; // 压缩是锦上添花,任何异常退回原图,绝不影响上传。
  }
}
