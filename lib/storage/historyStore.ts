import { getItem, removeItem, setItem } from './store';
import { validateHistory, type HistoryItem } from './schema';

// HistoryItem 结构定义已下沉 schema.ts(与校验器同处一地,避免 loader ↔ backup 循环依赖);
// 此处 re-export 保持既有导入点(WorkspaceProvider / HistoryTab / backup 等)不变。
export { type HistoryItem } from './schema';

/** 导出供 storage.onChanged 监听器引用——禁止在别处硬编码这串字面量(防第二套实现漂移)。 */
export const HISTORY_KEY = 'markflow:history';
const KEY = HISTORY_KEY;

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

/** 删除全部历史记录(B4-4/P2-19,供 wipeAll 用)。见 draftStore.removeDraft 同款注释。 */
export function removeHistory(): Promise<void> {
  return removeItem(KEY);
}
