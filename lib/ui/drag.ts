/**
 * 拖拽是否携带文件(第二批 W4)。编辑框只在拖入文件时拦截默认行为、显示「拖入文件」遮罩并读取文件;
 * 拖文字(从网页拖进来、框内拖动选中文字)交给 textarea 原生处理——此前无条件 preventDefault,
 * 文字拖放被吞掉、`readFile(undefined)` 什么也不做。
 */
export function isFileDrag(types: ReadonlyArray<string> | undefined): boolean {
  return !!types && Array.from(types).includes('Files');
}
