import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Tabs } from './components/Tabs';
import { Toast } from './components/Toast';
import { DraftTab } from './components/draft/DraftTab';
import { HistoryTab } from './components/history/HistoryTab';
import { SettingsTab } from './components/settings/SettingsTab';
import { OverwriteDialog } from './components/draft/OverwriteDialog';
import { TitleConflictDialog } from './components/draft/TitleConflictDialog';
import { LoadConfirmDialog } from './components/draft/LoadConfirmDialog';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';

export function App() {
  const { tab, setTab } = useWorkspace();

  return (
    <>
      <Header />
      <StatusBar />
      <Tabs tab={tab} onTab={setTab} />
      {tab === 'draft' && <DraftTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'settings' && <SettingsTab />}
      <Toast />
      {/* review B6:弹窗提升到 App 层(Tabs 之外),渲染于整个面板之上——导入期用户切到
          「记录/设置」Tab 时 DraftTab 卸载也不再隐形挂起;载入确认从任何 Tab 触发都可见。
          两者均 position:absolute inset:0 遮罩覆盖整个面板。 */}
      <OverwriteDialog />
      <TitleConflictDialog />
      <LoadConfirmDialog />
    </>
  );
}
