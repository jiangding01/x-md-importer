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
  },
});
