import { useRef, type CSSProperties, type DragEvent } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useWorkspace } from '@/lib/workspace/WorkspaceProvider';
import { Preview } from '@/lib/markdown/Preview';

const toolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  padding: '5px 8px',
  borderBottom: '1px solid var(--lsoft)',
  background: 'var(--p2)',
};

const iconBtn: CSSProperties = {
  width: 25,
  height: 25,
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  background: 'none',
  borderRadius: 6,
  color: 'var(--ink2)',
  cursor: 'pointer',
};

const editorFontSize: Record<string, string> = { sm: '11px', md: '12px', lg: '13.5px' };

function seg(active: boolean): CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    borderRadius: 'calc(var(--rEl) - 2px)',
    padding: '3px 9px',
    cursor: 'pointer',
    font: '500 10px var(--fUI)',
    transition: 'all .18s',
    background: active ? 'var(--p2)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink2)',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
  };
}

const stepNum: CSSProperties = {
  width: 17,
  height: 17,
  flex: 'none',
  borderRadius: '50%',
  background: 'var(--p2)',
  display: 'grid',
  placeItems: 'center',
  font: '600 9px var(--fMono)',
  color: 'var(--ink2)',
};

export function EditorCard({ onImport }: { onImport: () => void }) {
  const { t } = useI18n();
  const { opts } = useSettings();
  const { md, setMd, mode, setMode, dragging, setDragging, readFile, loadSample } = useWorkspace();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const insert = (before: string, after: string) => {
    const ta = taRef.current;
    // P2-23 收尾(review 修复):工具栏在预览模式已整体禁用,ta 不该为 null;万一未来某个
    // 调用路径在无编辑器时触达,这里必须是 no-op——旧的「拼到全文末尾」兜底正是当年
    // 静默污染文档尾部的元凶,不能把危险行为留作 fallback。
    if (!ta) return;
    const s = ta.selectionStart || 0;
    const e = ta.selectionEnd || 0;
    const next = md.slice(0, s) + before + md.slice(s, e) + after + md.slice(e);
    setMd(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + before.length + (e - s);
    });
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!dragging) setDragging(true);
  };
  // P2-24:onDrop 无条件先清 dragging——此前只在 readFile 内部的 onload 里清,若拖入的
  // 不是文件(files 为空)或读取失败,遮罩会永久卡住。readFile 自身对空 file 直接 no-op,
  // 这里的清除与它互不冲突,只是把「拖拽态收起」从异步回调里提前到同步事件处理。
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer.files?.[0]);
  };
  // P2-24:dragLeave 在容器内滑过子元素(工具栏/文本框)时也会触发,若不判断 relatedTarget
  // 是否仍在容器内,遮罩会一路闪烁。relatedTarget 为 null(拖出窗口外)按“离开”处理。
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setDragging(false);
  };

  const empty = !md.trim();
  const showEmpty = empty && mode === 'edit';
  // P2-23:预览模式下 textarea 已卸载(taRef.current 为 null),点工具栏按钮会走 insert()
  // 的兜底分支——把 `**`/表格模板等直接拼到 md 末尾,预览区又看不出正文被静默改动。
  // 工具栏在预览态整体禁用 + 置灰,而不是让用户凭空点出一个看不见的改动。
  const toolsDisabled = mode === 'preview';

  const tools: { key: string; label: React.ReactNode; onClick: () => void; font?: string }[] = [
    { key: 'b', label: 'B', onClick: () => insert('**', '**'), font: "700 11px var(--fDisp)" },
    { key: 'i', label: 'I', onClick: () => insert('*', '*'), font: 'italic 600 11px Georgia,serif' },
    { key: 'h', label: 'H#', onClick: () => insert('\n## ', ''), font: '600 10px var(--fMono)' },
    { key: 'code', label: '</>', onClick: () => insert('`', '`'), font: '500 8.5px var(--fMono)' },
  ];
  const toolBtnStyle: CSSProperties = {
    ...iconBtn,
    ...(toolsDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : null),
  };

  return (
    <div style={{ margin: '0 18px', border: '1px solid var(--line)', borderRadius: 'calc(var(--rEl) + 4px)', overflow: 'hidden' }}>
      <div style={toolbar}>
        {tools.map((tool) => (
          <button key={tool.key} className="mf-btn mf-hover-soft" disabled={toolsDisabled} onClick={tool.onClick} style={{ ...toolBtnStyle, font: tool.font }}>
            {tool.label}
          </button>
        ))}
        <button className="mf-btn mf-hover-soft" disabled={toolsDisabled} onClick={() => insert('[', '](https://)')} style={toolBtnStyle} aria-label="link">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M5.5 8.5l3-3" />
            <path d="M6.8 3.8l1-1a2.3 2.3 0 013.3 3.3l-1 1" />
            <path d="M7.2 10.2l-1 1a2.3 2.3 0 01-3.3-3.3l1-1" />
          </svg>
        </button>
        <button className="mf-btn mf-hover-soft" disabled={toolsDisabled} onClick={() => insert('\n![alt](image.png)\n', '')} style={toolBtnStyle} aria-label="image">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="2" width="11" height="10" rx="2" />
            <circle cx="5" cy="5.6" r="1.1" />
            <path d="M2.5 10.5L6 7.5L9 10" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="mf-btn mf-hover-soft"
          disabled={toolsDisabled}
          onClick={() => insert(t.tableTemplate, '')}
          style={toolBtnStyle}
          aria-label="table"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="2" width="11" height="10" rx="2" />
            <line x1="1.5" y1="5.5" x2="12.5" y2="5.5" />
            <line x1="7" y1="2" x2="7" y2="12" />
          </svg>
        </button>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', background: 'var(--p)', borderRadius: 7, padding: 2 }}>
          <button className="mf-btn" onClick={() => setMode('edit')} style={seg(mode === 'edit')}>
            {t.edit}
          </button>
          <button className="mf-btn" onClick={() => setMode('preview')} style={seg(mode === 'preview')}>
            {t.preview}
          </button>
        </div>
      </div>

      <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} style={{ position: 'relative', height: 236, display: 'flex' }}>
        {mode === 'edit' ? (
          <textarea
            ref={taRef}
            value={md}
            onChange={(e) => setMd(e.target.value)}
            placeholder={t.placeholder}
            spellCheck={false}
            wrap={opts.wrap ? 'soft' : 'off'}
            style={{
              flex: 1,
              width: '100%',
              boxSizing: 'border-box',
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              padding: '14px 16px',
              color: 'var(--ink)',
              font: `400 ${editorFontSize[opts.editorFont]}/1.8 var(--fMono)`,
            }}
          />
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px', minWidth: 0 }}>
            <Preview md={md} />
          </div>
        )}

        {showEmpty && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', padding: 16 }}>
            <div
              onClick={onImport}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                width: '100%',
                maxWidth: 262,
                padding: '18px 20px 16px',
                borderRadius: 14,
                border: `1.5px dashed ${dragging ? 'var(--acc)' : 'var(--line)'}`,
                background: dragging ? 'var(--accSoft)' : 'transparent',
                transition: 'all .2s',
                animation: 'fadeUp .35s ease',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                {[t.step1, t.step2, t.step3].map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={stepNum}>{i + 1}</span>
                    <span style={{ font: '400 11px var(--fUI)', color: 'var(--ink2)' }}>{step}</span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px dashed var(--line)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    padding: '5px 13px',
                    borderRadius: 'var(--btnR)',
                    background: 'var(--btnBg)',
                    color: 'var(--btnFg)',
                    font: '500 11px var(--fUI)',
                  }}
                >
                  {t.choose}
                </span>
                <button
                  className="mf-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadSample();
                  }}
                  style={{
                    font: '500 11px var(--fUI)',
                    color: 'var(--accInk)',
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                  }}
                >
                  {t.sample}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
