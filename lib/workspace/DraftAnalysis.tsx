import { createContext, useContext, useDeferredValue, useMemo, type ReactNode } from 'react';
import { analyzeDraft, type DraftAnalysis } from '@/lib/markdown/frontmatter';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

/**
 * 草稿页共享的一次解析(第三批 C2 / O1)。此前能力面板与素材板在每次按键时各解析一遍全文(160 KB 文档
 * 约 30 + 30 ms,输入明显发顿);现在只解析一次,并用 `useDeferredValue` 把它推到输入之后——编辑框
 * 保持跟手,派生面板允许落后一拍。挂在 DraftTab 里:切到「记录 / 设置」时随之卸载、不再解析(与此前
 * 两个面板只在草稿页解析一致)。
 *
 * `md` 是这份结果对应的(延后的)草稿文本:消费方凡要再看原文(如 frontmatter cover)都用它,
 * 不要混用 useWorkspace().md,否则会拿新原文配旧解析。
 */
interface DraftAnalysisValue {
  md: string;
  analysis: DraftAnalysis;
}

const DraftAnalysisContext = createContext<DraftAnalysisValue | null>(null);

export function DraftAnalysisProvider({ children }: { children: ReactNode }) {
  const { md } = useWorkspace();
  const { opts } = useSettings();
  const deferredMd = useDeferredValue(md);
  const { obsidianImg, wikilink, taskList } = opts;
  const value = useMemo(
    () => ({ md: deferredMd, analysis: analyzeDraft(deferredMd, { obsidianImg, wikilink, taskList }) }),
    [deferredMd, obsidianImg, wikilink, taskList],
  );
  return <DraftAnalysisContext.Provider value={value}>{children}</DraftAnalysisContext.Provider>;
}

export function useDraftAnalysis(): DraftAnalysisValue {
  const ctx = useContext(DraftAnalysisContext);
  if (!ctx) throw new Error('useDraftAnalysis must be used within <DraftAnalysisProvider>');
  return ctx;
}
