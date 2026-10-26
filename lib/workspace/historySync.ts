import type { EchoQueue } from '@/lib/storage/echoQueue';

/**
 * 历史列表的签名(第三批 H1):id 序列按顺序拼接。条目不可变(只有增删、裁剪),id 序列即可区分内容。
 * 与旧的「长度 + id 逐一相等」判定同口径,只是变成可放进回声队列的字符串。
 */
export function historySignature(list: ReadonlyArray<{ id: string | number }>): string {
  return list.map((h) => String(h.id)).join('\u0001');
}

/**
 * 历史 `chrome.storage.onChanged` 的采纳判定(第三批 H1,与第一批 W2 的 decideDraftChange 同形):
 *  1. 本实例自己写入的回声(含迟到的旧回声)→ 'echo';此前只看「与当前不同」,连续两次 commitHistory 时
 *     前一次较慢写入的回声晚到,会被当外部变更采纳、列表短暂回退(后一次回声到达时自愈,不丢数据)。
 *  2. 与当前相同 → 'ignore'。
 *  3. 其余 → 'adopt'(另一窗口的增删)。
 */
export function decideHistoryChange(args: {
  incoming: ReadonlyArray<{ id: string | number }>;
  current: ReadonlyArray<{ id: string | number }>;
  echoes: EchoQueue<string>;
}): 'echo' | 'adopt' | 'ignore' {
  const sig = historySignature(args.incoming);
  if (args.echoes.consume(sig)) return 'echo';
  return sig === historySignature(args.current) ? 'ignore' : 'adopt';
}
