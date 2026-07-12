import { createRoot } from 'react-dom/client';
import { PrefsProvider } from '@/lib/prefs/PrefsProvider';
import { SettingsProvider } from '@/lib/settings/SettingsProvider';
import { WorkspaceProvider } from '@/lib/workspace/WorkspaceProvider';
import { loadPrefs } from '@/lib/storage/prefs';
import { loadOptions } from '@/lib/storage/optionsStore';
import { loadDraft } from '@/lib/storage/draftStore';
import { loadHistory } from '@/lib/storage/historyStore';
import { applyThemeVars, resolveDark, skinVars } from '@/lib/theme/themes';
import { App } from './App';
import './styles/global.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

async function bootstrap() {
  const [prefs, opts, md, history] = await Promise.all([
    loadPrefs(),
    loadOptions(),
    loadDraft(),
    loadHistory(),
  ]);

  // 首帧前同步应用主题变量，避免闪烁
  applyThemeVars(skinVars(prefs.skin, resolveDark(prefs.skin, prefs.theme), prefs.accent));

  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');

  createRoot(container).render(
    <PrefsProvider initial={prefs}>
      <SettingsProvider initial={opts}>
        <WorkspaceProvider initialMd={md} initialHistory={history}>
          <App />
        </WorkspaceProvider>
      </SettingsProvider>
    </PrefsProvider>,
  );
}

void bootstrap();
