/* ESLint flat config。运行时依赖保持为 0：eslint 只在 dev/CI 用。
 * 分组给 globals：服务端 = node，前端 = browser + serviceworker（sw.js）。 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'public/vendor/', 'dist/', 'data/'],
  },
  js.configs.recommended,
  {
    rules: {
      // `_` 是本代码库「有意忽略的回调/异常参数」惯例（含 catch (_)）；
      // ignoreRestSiblings 支持 `const { id, ...rest } = x` 的删字段惯用法
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // 文案里用全角空格（U+3000）排版：字符串与模板串内不算问题
      'no-irregular-whitespace': ['error', {
        skipStrings: true,
        skipTemplates: true,
        skipRegExps: true,
        skipComments: true,
      }],
    },
  },
  {
    files: ['server.js', 'lib/**/*.js', 'test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },
];
