export default defineBackground(() => {
  // 点击工具栏图标即打开侧边栏
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[MarkFlow] setPanelBehavior failed', err));
});
