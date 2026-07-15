/**
 * 图片压缩(canvas 缩放 + JPEG 重编码)—— 运行于 **content(ISOLATED world,有 DOM)**:
 * 在图片准备阶段对准备好的 File 就地压缩,减小上传体积、更快、更抗 X 限流。
 *
 * 策略(与设置项 compress/maxEdge/quality 对应):
 *  - **只压 `image/jpeg` 照片**;PNG(截图/文字/UI 图——转 JPEG 会糊、缩放让文字变小)、
 *    WebP(本身已是压缩格式)、GIF(动图)一律**保持原样返回**,保护清晰度。这是实测
 *    「截图压完糊掉」后的取舍:JPEG 为连续色调照片而生,对锐利边缘/文字天生不友好。
 *  - 小于阈值(150KB)不压(收益小);
 *  - `maxEdge='orig'` 不缩放尺寸、仅按 quality 重编码;否则等比缩放到长边上限;
 *  - **压完更大 / 失败 → 返回原 File**(不帮倒忙);任何异常都吞掉、退回原图。
 */

/** 只压 JPEG 照片;PNG(截图/文字,转 JPEG 会糊)/ WebP(已压)/ GIF(动图)保持原样。 */
const COMPRESSIBLE = new Set(['image/jpeg']);
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
