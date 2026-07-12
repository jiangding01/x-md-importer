import { getItem, setItem } from './store';

const KEY = 'markflow:draft';

export function loadDraft(): Promise<string> {
  return getItem<string>(KEY, '');
}

export function saveDraft(md: string): Promise<void> {
  return setItem(KEY, md);
}
