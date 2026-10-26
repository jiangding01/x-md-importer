/**
 * 自写回声队列(W2):记下本实例已发起、尚未收到 `chrome.storage.onChanged` 回声的写入值,
 * 回声到达时按队列吞掉——快速连写 A→B 时,A 的迟到回声不会被当成外部变更采纳。
 * 与 SettingsProvider 的 pendingEchoes 同一思路(那边按序列化 JSON 比较,这里按值 `===`)。
 *
 * 存的是调用方已持有的同一值引用(草稿字符串由 pendingDraft / mdRef 持有),不额外复制;
 * 有容量上限:值未变的写入 Chrome 不发 onChanged,万一登记了也不会无限堆积。
 */
export interface EchoQueue<T> {
  /** 发起写入前登记。 */
  push(v: T): void;
  /** 回声到达:命中第 k 项则连同其前各项(更早、已被覆盖的写入)一并出队,返回 true;未命中返回 false。 */
  consume(v: T): boolean;
  /** 写入失败:该值不会有回声,移除最近一次登记。 */
  drop(v: T): void;
  readonly size: number;
}

export function createEchoQueue<T>(max: number): EchoQueue<T> {
  const q: T[] = [];
  return {
    push(v) {
      q.push(v);
      if (q.length > max) q.shift();
    },
    consume(v) {
      const k = q.indexOf(v);
      if (k < 0) return false;
      q.splice(0, k + 1);
      return true;
    },
    drop(v) {
      const k = q.lastIndexOf(v);
      if (k >= 0) q.splice(k, 1);
    },
    get size() {
      return q.length;
    },
  };
}
