import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // 框架提供的全局变量
        Bot: 'readonly',
        redis: 'readonly',
        logger: 'readonly',
        plugin: 'readonly',
        Renderer: 'readonly',
        segment: 'readonly',

        // Node.js 全局变量
        global: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        performance: 'readonly',

        // Jest 测试全局变量
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly'
      }
    },
    rules: {
      // 关闭一些严格的规则
      'eqeqeq': 'off',
      'prefer-const': 'off',
      'arrow-body-style': 'off',
      
      // 允许未使用的变量（以 _ 开头）
      'no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_' 
      }]
    }
  },
  {
    // 忽略某些文件
    ignores: [
      'node_modules/**',
      'coverage/**',
      'temp/**'
    ]
  }
];
