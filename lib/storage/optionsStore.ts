import { type Options } from '@/lib/settings/options';
import { getItem, removeItem, setItem } from './store';
import { validateOptions } from './schema';

const KEY = 'markflow:opts';

/**
 * 读取导入设置。**读出即校验**:非法枚举此前会被原样合并进 opts —— 例如坏掉的
 * `onExisting` 会静默变成「总是覆盖」(用户以为写入前会先询问,结果正文被直接替换)。
 * 校验后非法值回落默认,行为可预期。
 */
export async function loadOptions(): Promise<Options> {
  return validateOptions(await getItem<unknown>(KEY, {}));
}

export function saveOptions(opts: Options): Promise<void> {
  return setItem(KEY, opts);
}

/** 删除导入设置(B4-4/P2-19,供 wipeAll 用)。见 draftStore.removeDraft 同款注释。 */
export function removeOptions(): Promise<void> {
  return removeItem(KEY);
}
