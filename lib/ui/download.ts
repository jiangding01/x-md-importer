/**
 * 统一文件下载通道(全局定案 3):唯一的「把内容交给用户保存」实现。
 * **失败必须向上抛**——此前各处 downloadJson 自吞异常后调用方照弹「已导出」toast,
 * 用户拿着不存在的备份去清数据是备份功能最危险的失败形态(P2-17)。
 * revokeObjectURL 延迟执行:立即 revoke 会让部分浏览器取消尚未落盘的下载。
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** 便捷封装:文本内容按给定 MIME 下载。失败同样向上抛。 */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}
