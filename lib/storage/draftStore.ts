import { getItem, setItem } from './store';
import { validateDraft } from './schema';

const KEY = 'markflow:draft';

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
