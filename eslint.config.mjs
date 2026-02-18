import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', '*.config.cjs', '*.config.mjs'] },
    eslint.configs.recommended,
    {
        files: ['src/**/*.ts', 'src/**/*.test.ts'],
        extends: [...tseslint.configs.recommended],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            curly: 'error',
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['./**/*.js', '../**/*.js'],
                            message: 'Use .ts extension for relative imports within src.',
                        },
                    ],
                },
            ],
        },
    },
);
