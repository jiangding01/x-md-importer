import { getItem, setItem } from './store';
import { validatePrefs, type Prefs } from './schema';

// 结构定义(Prefs / defaultPrefs)已下沉 schema.ts,与校验器同处一地——否则 loader 复用
// backup.ts 的校验器会形成 `prefs → backup → prefs` 循环依赖(backup 自身要 import loader
// 才能导出当前数据)。此处 re-export 保持既有导入点(PrefsProvider / backup 等)不变。
export { defaultPrefs, type Prefs } from './schema';

const KEY = 'markflow:prefs';

/**
 * 读取界面偏好。**读出即校验**——storage 里可能躺着脏数据(扩展早期版本写入 / 版本迁移
 * 遗留 / 手工篡改 / 其他扩展写入)。非法 skin 会让 bootstrap 的 `resolveDark → skinMeta[skin]`
 * 越界抛,落到「清空全部本地数据」的恢复 UI —— 为一个主题字段赔上草稿与历史,代价不成比例。
 * 校验后坏字段静默回落默认值,面板照常可用、用户数据保全。
 */
export async function loadPrefs(): Promise<Prefs> {
  return validatePrefs(await getItem<unknown>(KEY, {}));
}

export function savePrefs(prefs: Prefs): Promise<void> {
  return setItem(KEY, prefs);
}
