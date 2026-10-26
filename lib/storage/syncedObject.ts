import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createEchoQueue, type EchoQueue } from './echoQueue';

/**
 * 「整对象存一个 chrome.storage key、多窗口互相跟随」的切片同步(第三批 C4 / O4)。设置(SettingsProvider)
 * 与偏好(PrefsProvider)此前各写一份逐字相同的实现;草稿 / 历史语义不同(未落盘编辑闸门、导入闸门、
 * 退避重试、toast),不走这里。
 */

/**
 * 键序无关的序列化:chrome.storage 回读的对象键序未必与写入时一致(底层字典可能按键排序),
 * 直接 JSON.stringify 比较会把自己的回声误判成外部变更。**只适用于扁平对象**(replacer 数组只列顶层键)。
 */
export function stableJson(v: object): string {
  return JSON.stringify(v, Object.keys(v).sort());
}

/**
 * onChanged 的采纳判定(纯函数):
 *  1. 本实例写入的回声(含快速连改 A→B 时 A 的迟到回声)→ 'echo',连同更早的登记一并出队;
 *  2. 与「已与 storage 一致」的值相同 → 'ignore';
 *  3. 其余 → 'adopt'(另一窗口的改动)。
 */
export function decideSyncedChange(args: { incoming: string; synced: string; echoes: EchoQueue<string> }): 'echo' | 'ignore' | 'adopt' {
  if (args.echoes.consume(args.incoming)) return 'echo';
  return args.incoming === args.synced ? 'ignore' : 'adopt';
}

export interface SyncedObjectOptions<T extends object> {
  /** chrome.storage key(由所属 store 导出,别处不硬编码)。 */
  storageKey: string;
  /** 初值(来自 storage 的加载结果)。 */
  initial: T;
  /** key 被删除(另一窗口 wipeAll)时采纳的值。 */
  defaults: T;
  /** storage 读出值的校验 / 修正(lib/storage/schema)。 */
  validate: (raw: unknown) => T;
  save: (v: T) => Promise<void>;
  /** 写失败日志用的名字。 */
  label: string;
}

export function useSyncedObject<T extends object>(o: SyncedObjectOptions<T>): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(o.initial);
  // 「已与 storage 一致」的值(序列化):初值来自 storage、外部变更采纳后同步更新——
  // 持久化 effect 见到相等即跳过,既跳过首渲染,也不把刚采纳的外部值再写回去(避免乒乓)。
  const synced = useRef(stableJson(o.initial));
  // 本实例已发出、尚未收到 onChanged 回声的写入;上限防 storage 值未变(不发事件)时堆积。
  const [echoes] = useState(() => createEchoQueue<string>(20));
  // 选项里的函数 / 默认值按挂载时的一份使用(调用方传的是模块级常量),不随渲染重建监听。
  const opts = useRef(o).current;

  // 只改内存态;持久化放在 effect 里(C13):StrictMode 下 setState 更新函数会被调用两次,且应保持纯净。
  useEffect(() => {
    const json = stableJson(value);
    if (json === synced.current) return;
    synced.current = json;
    echoes.push(json);
    // 写失败低危(下次改动会重写),不占 UI,但不许静默吞——落 console 便于诊断(P0-1 配套)。
    opts.save(value).catch((err) => console.error(`[MarkFlow] ${opts.label} persist failed:`, err));
  }, [value, echoes, opts]);

  // ── 多窗口同步(C2)── 每个浏览器窗口一个 sidePanel 实例;订阅 onChanged 直接采纳外部变更
  // (这类切片无「未落盘编辑」概念,无需草稿那样的 pending 闸门)。
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes[opts.storageKey];
      if (!change) return;
      // newValue 为 undefined = key 被删除(另一窗口 wipeAll)→ 按默认值采纳。
      const incoming = change.newValue === undefined ? opts.defaults : opts.validate(change.newValue);
      const json = stableJson(incoming);
      if (decideSyncedChange({ incoming: json, synced: synced.current, echoes }) !== 'adopt') return;
      synced.current = json;
      setValue(incoming);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, [echoes, opts]);

  return [value, setValue];
}
