import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    // 国际化:文案在 public/_locales/{en,zh_CN}/messages.json(D5)。description ≤132 字符(商店上限)。
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    // chrome.sidePanel.setPanelBehavior 需 Chrome 116+(B14)。
    minimum_chrome_version: '116',
    // unlimitedStorage:历史记录持久化整篇 md 全文,默认 10MB 配额重度使用数月即满,
    // 之后所有写入静默失败(P1-8)。storage 权限本就有,加这一项零额外弹窗成本。
    // 不申请 tabs(B4):它触发「读取您的浏览记录」安装警告。判断当前标签是否 X 只需读
    // tab.url,改由下方与 content_scripts 同域的 host_permissions 提供(不新增安装警告)。
    permissions: ['storage', 'unlimitedStorage', 'sidePanel'],
    host_permissions: ['*://x.com/*', '*://twitter.com/*'],
    // 远程图片下载:不静态声明广域 host 权限(利于商店审核 + 最小权限),
    // 改为运行时按图片来源 origin 通过 chrome.permissions.request 申请(见 WorkspaceProvider)。
    optional_host_permissions: ['*://*/*'],
    action: { default_title: '__MSG_actionTitle__' },
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
