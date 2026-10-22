import { Component, useState, type ErrorInfo, type ReactNode } from 'react';

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
 * 恢复屏的自救出口(P1-9):把全部本地数据 dump 成 JSON 下载。
 * **必须自包含**——不 import 任何业务模块(它们可能正是崩溃源),chrome 环境读
 * chrome.storage.local,预览环境回退遍历 localStorage 的 markflow: 前缀(对齐 resetAllData
 * 的双分支)。成功 resolve true;任何失败 resolve false(恢复屏没有 toast 体系,由调用方处理)。
 */
export function dumpAllDataToFile(): Promise<boolean> {
  // 导出成**可被「设置 → 恢复备份」直接吃下的 BackupData 形状**(review 修复:此前 dump 成
  // {data:{'markflow:prefs':…}} 嵌套,importBackup 找不到 prefs/options/history/draft,
  // 「按提示导出的备份」根本恢复不回去)。四个 key 与各 store 一致——此处必须自包含
  // (不 import store 模块,它们可能正是崩溃源),接受这份镜像的漂移风险并以注释互指。
  const download = (all: Record<string, unknown>): boolean => {
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const payload = {
        app: 'markflow',
        kind: 'backup',
        version: 2,
        exportedAt: new Date().toISOString(),
        prefs: all['markflow:prefs'],
        options: all['markflow:opts'],
        history: all['markflow:history'],
        draft: all['markflow:draft'],
        // 全量原始 dump 一并附上:恢复通道只认上面四个切片,这里保证任何数据都不丢在文件外。
        raw: all,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `markflow-backup-recovery-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 延迟 revoke:立即 revoke 会让部分浏览器取消尚未落盘的下载。
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return true;
    } catch {
      return false;
    }
  };
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(null, (all) => {
          if (chrome.runtime?.lastError) {
            resolve(false);
            return;
          }
          resolve(download(all ?? {}));
        });
        return;
      }
    } catch {
      /* 回退 localStorage */
    }
    try {
      const data: Record<string, unknown> = {};
      // localStorage 存的是 JSON 串:解析后再交给 download,让四个切片与 chrome 路径同形状
      // (否则 prefs 等是字符串,importBackup 的逐字段校验全部落空)。解析失败的 key 保留原串。
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key?.startsWith('markflow:')) continue;
        const raw = localStorage.getItem(key);
        try {
          data[key] = raw === null ? null : JSON.parse(raw);
        } catch {
          data[key] = raw;
        }
      }
      resolve(download(data));
    } catch {
      resolve(false);
    }
  });
}

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
  // 导出结果反馈(review 修复:此前丢弃 dumpAllDataToFile 的布尔结果,导出失败零反馈,
  // 用户以为拿到备份就去点重置)。恢复屏无 toast 体系,用内联状态行呈现。
  const [note, setNote] = useState<'exported' | 'export-failed' | null>(null);
  // 重置前自动导出失败 → 不直接清,亮出警告并要求再点一次才强制重置。
  const [forceResetArmed, setForceResetArmed] = useState(false);

  const handleExport = () => {
    void dumpAllDataToFile().then((ok) => setNote(ok ? 'exported' : 'export-failed'));
  };
  const handleReset = () => {
    if (forceResetArmed) {
      resetAllData();
      return;
    }
    void dumpAllDataToFile().then((ok) => {
      if (ok) {
        setNote('exported');
        // 稍等下载真正发起后再清——立即 clear+reload 会打断尚未落盘的下载。
        setTimeout(resetAllData, 600);
      } else {
        setNote('export-failed');
        setForceResetArmed(true);
      }
    });
  };
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
            ? '面板加载失败——这可能是数据损坏,也可能只是程序缺陷,你的草稿与历史未必有问题。建议先导出备份,再考虑重置(重置会清空草稿、历史与设置)。'
            : 'The panel failed to load — this may be corrupted data, or just a bug; your draft and history may be intact. Export a backup first, then reset if needed (reset clears your draft, history and settings).'}
        </div>
        {note && (
          <div
            style={{
              fontSize: 12,
              marginBottom: 12,
              color: note === 'exported' ? '#7ee2a8' : '#ffb4a8',
            }}
          >
            {note === 'exported'
              ? zh
                ? '已导出数据备份'
                : 'Data backup exported'
              : zh
                ? forceResetArmed
                  ? '导出失败——再次点击「重置」将不导出直接清空'
                  : '导出失败'
                : forceResetArmed
                  ? 'Export failed — click Reset again to wipe without a backup'
                  : 'Export failed'}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleExport}
            style={{
              appearance: 'none',
              border: '1px solid #e9ebee',
              cursor: 'pointer',
              padding: '9px 18px',
              borderRadius: 8,
              background: 'transparent',
              color: '#e9ebee',
              font: '600 13px system-ui,sans-serif',
            }}
          >
            {zh ? '导出数据备份' : 'Export data backup'}
          </button>
          <button
            onClick={handleReset}
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
