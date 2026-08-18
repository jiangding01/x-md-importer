/**
 * 统一持久化层：优先 chrome.storage.local，非扩展环境（如浏览器直开预览）回退 localStorage。
 * 全部异步，便于日后无缝换成 chrome.storage 的 onChanged 订阅。
 */

const hasChromeStorage =
  typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

export async function getItem<T>(key: string, fallback: T): Promise<T> {
  if (hasChromeStorage) {
    const res = await chrome.storage.local.get(key);
    const val = res[key];
    return val === undefined ? fallback : (val as T);
  }
  try {
    const raw = localStorage.getItem(key);
    return raw != null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 写入持久层。**失败必须向上抛**(P0-1):chrome 路径配额满/存储层错误时 reject,
 * localStorage 路径同样 rethrow——此前这里静默吞错,叠加调用方一律 `void save*(...)`,
 * 用户在「已保存」提示下丢数据。错误的可见性由各调用方决定(草稿/历史走常驻错误条,
 * 设置/偏好低危走 console),但持久层自己绝不吞。
 */
export async function setItem<T>(key: string, val: T): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [key]: val });
    return;
  }
  localStorage.setItem(key, JSON.stringify(val));
}

export async function removeItem(key: string): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.remove(key);
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
