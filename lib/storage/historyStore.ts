import { getItem, setItem } from './store';
import { validateHistory, type HistoryItem } from './schema';

// HistoryItem 结构定义已下沉 schema.ts(与校验器同处一地,避免 loader ↔ backup 循环依赖);
// 此处 re-export 保持既有导入点(WorkspaceProvider / HistoryTab / backup 等)不变。
export { type HistoryItem } from './schema';

const KEY = 'markflow:history';

/**
 * 读取导入历史。**读出即校验**:此前裸信任 storage —— 非数组会让下游 `.map()` 抛,
 * 缺 `title` 的项会让 HistoryTab 的 `h.title.toLowerCase()` 抛,两者都卸载整树。
 * 校验后**只丢弃坏项、保留其余历史**,而不是整个面板崩掉后让用户清空全部数据。
 */
export async function loadHistory(): Promise<HistoryItem[]> {
  return validateHistory(await getItem<unknown>(KEY, []));
}

export function saveHistory(items: HistoryItem[]): Promise<void> {
  return setItem(KEY, items);
}
