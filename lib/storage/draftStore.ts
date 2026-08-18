import { getItem, setItem } from './store';
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
