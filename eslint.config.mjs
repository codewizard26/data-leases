import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['**/dist/**', '**/node_modules/**', '**/.cre_build_tmp.js'] }, js.configs.recommended, ...tseslint.configs.recommended);
