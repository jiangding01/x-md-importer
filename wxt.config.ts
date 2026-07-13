import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    name: 'MarkFlow — X 文章 Markdown 导入器',
    description: '把 Markdown 一键导入 X 文章编辑器，全格式自动排版。本地优先，不上传数据。',
    permissions: ['storage', 'sidePanel', 'tabs'],
    action: { default_title: 'MarkFlow' },
    // MAIN world 引擎经 content.ts 的 injectScript('/injector.js') 注入,
    // 页面需能加载它 → 显式声明为 web-accessible(仅对 x.com/twitter.com 开放)。
    web_accessible_resources: [
      {
        resources: ['injector.js'],
        matches: ['*://x.com/*', '*://twitter.com/*'],
      },
    ],
  },
});
