import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 全局崩溃兜底(review B2)。
 *
 * 背景:坏备份/损坏 storage 会让 bootstrap 或某个组件在渲染期抛错(如非法 skin 导致
 * resolveDark→skinMeta[skin] 越界、history 项缺 title 导致 h.title.toLowerCase() 抛)。
 * 无边界时 React 会卸载整棵树 → 白屏、设置页不可达、用户无从恢复。
 *
 * 这是本项目**唯一**允许的 class 写法例外——React ErrorBoundary 依赖 componentDidCatch /
 * getDerivedStateFromError 生命周期,函数组件无等价 API,必须 class。
 */

/**
 * 清空全部本地数据后重载面板。恢复 UI 的「重置」按钮唯一入口:
 * 优先清 chrome.storage.local(扩展环境),否则回退 localStorage(纯预览环境),再 reload。
 */
export function resetAllData(): void {
  const reload = () => {
    try {
      location.reload();
    } catch {
      /* noop */
    }
  };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.clear(() => reload());
      return;
    }
  } catch {
    /* 回退 localStorage */
  }
  try {
    localStorage.clear();
  } catch {
    /* 忽略隐私模式写入失败 */
  }
  reload();
}

/**
 * 最小恢复屏:不依赖任何 Provider / 主题变量(它们可能正是崩溃源),
 * 用内联中性配色自持渲染,保证在任何失败状态下都能显示并提供「重置」出口。
 * bootstrap 失败(main.tsx catch)与运行时渲染抛错(ErrorBoundary fallback)共用此屏。
 */
export function RecoveryScreen(): ReactNode {
  const zh =
    typeof navigator !== 'undefined' && !!navigator.language?.toLowerCase().startsWith('zh');
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#15181c',
        color: '#e9ebee',
        font: '14px/1.6 -apple-system,system-ui,sans-serif',
      }}
    >
      <div style={{ maxWidth: 320, textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          {zh ? '加载失败' : 'Failed to load'}
        </div>
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 20 }}>
          {zh
            ? '面板数据可能已损坏。可重置本地数据后重试(会清空草稿、历史与设置)。'
            : 'Panel data may be corrupted. Reset local data and retry (this clears your draft, history and settings).'}
        </div>
        <button
          onClick={resetAllData}
          style={{
            appearance: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '9px 18px',
            borderRadius: 8,
            background: '#e9ebee',
            color: '#15181c',
            font: '600 13px system-ui,sans-serif',
          }}
        >
          {zh ? '重置数据并重载' : 'Reset data & reload'}
        </button>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 兜底渲染抛错:落 console 便于诊断,展示恢复 UI 而非白屏卸载整树。
    console.error('[MarkFlow] render error caught by ErrorBoundary:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) return <RecoveryScreen />;
    return this.props.children;
  }
}
