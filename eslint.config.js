// ESLint(第三批 O9):只开 React hooks 两条规则——拦下第一批 W1 那类 useCallback / useEffect 依赖遗漏。
// 不用 eslint-plugin-react-hooks 的 recommended 预设:v7 起它带 React Compiler 系列规则,与本项目无关。
// 类型检查仍由 `pnpm compile`(tsc)负责,这里不重复开 TS 规则。
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**'] },
  {
    files: ['entrypoints/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    // 有意省略依赖处须写 eslint-disable 并附理由;豁免不再需要时报错,防注释过期。
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
