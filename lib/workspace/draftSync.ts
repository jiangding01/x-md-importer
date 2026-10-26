import type { EchoQueue } from '@/lib/storage/echoQueue';

/**
 * 草稿 `chrome.storage.onChanged` 的采纳判定(W2,纯函数,供单测直接驱动竞态时序)。顺序即优先级:
 *  1. **本实例自己写入的回声**(含迟到的旧回声)→ 'echo',不采纳。此前 flushDraft 在写入完成前就
 *     清空 pending,前一次较慢写入的回声晚于下一次 flush 才到时,下面三个条件全满足,被当成另一窗口
 *     的编辑采纳——编辑框回退、toast 误报「已从另一窗口同步」,其后键入的内容丢失。回声无论此刻是否
 *     有 pending / 是否在导入都照样出队,不在队列里滞留。
 *  2. 值与当前相同 → 'ignore'。
 *  3. 本地有未落盘编辑(pending)→ 'ignore':本地更新,随后 flush 会写回并再广播,吞掉 pending 才是丢数据。
 *  4. 导入中 → 'ignore':startImport 闭包依赖 md 一致性(blocks / 历史都取自它)。
 *  5. 其余 → 'adopt'(另一窗口的真实编辑,或另一窗口 wipeAll 删 key 时按空草稿采纳)。
 * **不看 hasFocus**:onChanged 是边沿触发,「聚焦时拒收」的更新永远不会再送达(见 WorkspaceProvider)。
 */
export function decideDraftChange(args: {
  incoming: string;
  current: string;
  hasPending: boolean;
  importing: boolean;
  echoes: EchoQueue<string>;
}): 'echo' | 'adopt' | 'ignore' {
  if (args.echoes.consume(args.incoming)) return 'echo';
  if (args.incoming === args.current || args.hasPending || args.importing) return 'ignore';
  return 'adopt';
}

/**
 * 草稿写入失败后的重试间隔(第三批 O7):第 1 / 2 / ≥3 次连续失败分别 2s / 5s / 15s 后重试,成功即复位。
 * 此前失败后不重置 max-wait、也不安排重试——存储持续失败时每次按键都整篇写一次,停手后又不再重试。
 */
export function draftRetryDelay(failCount: number): number {
  return failCount <= 1 ? 2000 : failCount === 2 ? 5000 : 15000;
}
