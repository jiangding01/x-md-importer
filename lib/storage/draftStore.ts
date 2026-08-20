import { getItem, removeItem, setItem } from './store';
import { validateDraft } from './schema';

/** 导出供 storage.onChanged 监听器引用——禁止在别处硬编码这串字面量(防第二套实现漂移)。 */
export const DRAFT_KEY = 'markflow:draft';
const KEY = DRAFT_KEY;

/**
 * 读取当前草稿。**读出即校验**:`getItem` 只在值为 `undefined` 时用 fallback,
 * 故 storage 里若躺着 number / object / null 会被原样返回,下游 `md.trim()` 之类
 * 在渲染期抛错、卸载整树。非字符串一律回落空串。
 */
export async function loadDraft(): Promise<string> {
  return validateDraft(await getItem<unknown>(KEY, ''));
}

export function saveDraft(md: string): Promise<void> {
  return setItem(KEY, md);
}

/** 删除草稿(B4-4/P2-19,供 wipeAll 用):对齐「清除所有数据」的文案承诺——此前只清
 * history+draft 的内存态,storage 里的旧值仍在,与「删除全部草稿…」的措辞不符。 */
export function removeDraft(): Promise<void> {
  return removeItem(KEY);
}
