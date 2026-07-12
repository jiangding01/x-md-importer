import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Tabs } from './components/Tabs';
import { Toast } from './components/Toast';
import { DraftTab } from './components/draft/DraftTab';
import { HistoryTab } from './components/history/HistoryTab';
import { SettingsTab } from './components/settings/SettingsTab';
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
    </>
  );
}
