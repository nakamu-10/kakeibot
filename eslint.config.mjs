import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules/', '.wrangler/', 'scripts/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 金額や日付の数値を文字列に埋め込むことが多いので、数値だけは許す
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // ハンドラは「return reply(...)」で返信して抜ける書き方にそろえている
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreVoidReturningFunctions: true }],
    },
  },
  {
    files: ['eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
