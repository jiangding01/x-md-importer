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

export async function setItem<T>(key: string, val: T): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [key]: val });
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* 忽略配额/隐私模式写入失败 */
  }
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
