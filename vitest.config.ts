import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 单测配置(纯函数层:parser / frontmatter / capability / backup validate / localVault 路径器 / protocol)。
 *
 * - environment 'node':被测模块均为零 DOM 依赖的纯函数;浏览器 API(chrome/indexedDB)在
 *   各模块内都有 typeof 守卫或仅在函数体内触达,node 下 import 安全。
 * - alias '@' → 项目根:backup.ts / historyStore.ts 等用 `@/lib/...` 导入(WXT 生成的
 *   tsconfig paths 提供),Vitest 不读 tsconfig paths,必须在此显式映射。
 * - 不开 globals:测试文件显式 `import { describe, it, expect } from 'vitest'`——
 *   免去往 extends WXT 生成配置的 tsconfig 里塞 types 的漂移风险。
 * - injector.ts / content.ts **有意不在单测范围**:依赖页面 Draft.js fiber 环境,无诚实
 *   单测缝隙(硬 mock 是跑不到真实失败的空心绿灯),回归靠 docs/qa/ 真机用例。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
