import { createRoot } from 'react-dom/client';
import { PrefsProvider } from '@/lib/prefs/PrefsProvider';
import { SettingsProvider } from '@/lib/settings/SettingsProvider';
import { WorkspaceProvider } from '@/lib/workspace/WorkspaceProvider';
import { ProbeProvider } from '@/lib/bridge/useProbe';
import { loadPrefs } from '@/lib/storage/prefs';
import { loadOptions } from '@/lib/storage/optionsStore';
import { loadDraft } from '@/lib/storage/draftStore';
import { loadHistory } from '@/lib/storage/historyStore';
import { applyThemeVars, resolveDark, skinVars } from '@/lib/theme/themes';
import { App } from './App';
import { ErrorBoundary, RecoveryScreen } from './components/ErrorBoundary';
import './styles/global.css';

async function bootstrap() {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');

  // review B2:整个引导(读 storage → 解析主题 → 挂树)用 try/catch 包裹。损坏的 storage
  // (如非法 skin 让 resolveDark→skinMeta[skin] 越界抛)以往会白屏、设置页不可达;此处兜底
  // 渲染最小恢复 UI(可一键清空本地数据后重载),而非把面板卡死。
  try {
    const [prefs, opts, md, history] = await Promise.all([
      loadPrefs(),
      loadOptions(),
      loadDraft(),
      loadHistory(),
    ]);

    // 首帧前同步应用主题变量，避免闪烁
    applyThemeVars(skinVars(prefs.skin, resolveDark(prefs.skin, prefs.theme), prefs.accent));

    createRoot(container).render(
      // ErrorBoundary 包住整棵树:任一 Provider / 组件渲染期抛错(如坏 history 项让
      // HistoryTab h.title.toLowerCase() 抛)都被兜底为恢复 UI,不再卸载整树白屏。
      <ErrorBoundary>
        <PrefsProvider initial={prefs}>
          <SettingsProvider initial={opts}>
            {/* ProbeProvider 必须在 WorkspaceProvider 外层:后者内部 useConnection 依赖 probe context。 */}
            <ProbeProvider>
              <WorkspaceProvider initialMd={md} initialHistory={history}>
                <App />
              </WorkspaceProvider>
            </ProbeProvider>
          </SettingsProvider>
        </PrefsProvider>
      </ErrorBoundary>,
    );
  } catch (err) {
    console.error('[MarkFlow] bootstrap failed:', err);
    createRoot(container).render(<RecoveryScreen />);
  }
}

void bootstrap();
