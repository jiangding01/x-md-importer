import { defaultOptions, type Options } from '@/lib/settings/options';
import { getItem, setItem } from './store';

const KEY = 'markflow:opts';

export async function loadOptions(): Promise<Options> {
  const stored = await getItem<Partial<Options>>(KEY, {});
  return { ...defaultOptions, ...stored };
}

export function saveOptions(opts: Options): Promise<void> {
  return setItem(KEY, opts);
}
