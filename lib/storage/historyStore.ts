import { getItem, setItem } from './store';

export interface HistoryItem {
  id: number;
  title: string;
  date: string;
  ok: number;
  deg: number;
  fail: number;
  md: string;
}

const KEY = 'markflow:history';

export function loadHistory(): Promise<HistoryItem[]> {
  return getItem<HistoryItem[]>(KEY, []);
}

export function saveHistory(items: HistoryItem[]): Promise<void> {
  return setItem(KEY, items);
}
