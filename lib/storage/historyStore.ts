import { getItem, setItem } from './store';
import type { ImageFailure } from '@/lib/bridge/protocol';

export interface HistoryItem {
  id: number;
  title: string;
  date: string;
  ok: number;
  deg: number;
  fail: number;
  md: string;
  /** 图片失败明细(fail=0 或旧记录时缺省)——存进历史供事后排查,不只当次展示。 */
  imageFailures?: ImageFailure[];
}

const KEY = 'markflow:history';

export function loadHistory(): Promise<HistoryItem[]> {
  return getItem<HistoryItem[]>(KEY, []);
}

export function saveHistory(items: HistoryItem[]): Promise<void> {
  return setItem(KEY, items);
}
