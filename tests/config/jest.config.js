/**
 * Jest测试框架配置文件
 * 为农场游戏项目提供全面的测试配置
 */

export default {
  // 基础配置  
  testEnvironment: 'node',
  rootDir: '../../', // 设置正确的根目录
  
  // 模块路径映射
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^@services/(.*)$': '<rootDir>/services/$1',
    '^@models/(.*)$': '<rootDir>/models/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
    '^@apps/(.*)$': '<rootDir>/apps/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
    // 修复ES模块路径问题
    '^(\\.\\.?/.*)\\.(js)$': '$1'
  },
  
  // 测试文件匹配规则
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  
  // 忽略的测试文件
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/reports/'
  ],
  
  // 覆盖率收集配置
  collectCoverageFrom: [
    'services/**/*.js',
    'models/**/*.js',
    'utils/**/*.js',
    'apps/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/coverage/**',
    '!**/reports/**'
  ],
  
  // 覆盖率阈值
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90
    },
    // 核心服务要求更高覆盖率
    'services/player/PlayerService.js': {
      branches: 95,
      functions: 100,
      lines: 95,
      statements: 95
    },
    'services/planting/PlantingService.js': {
      branches: 95,
      functions: 100,
      lines: 95,
      statements: 95
    }
  },
  
  // 覆盖率报告配置
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov',
    'json'
  ],
  
  // 覆盖率输出目录
  coverageDirectory: 'tests/reports/coverage',
  
  // 测试环境设置
  setupFilesAfterEnv: [
    '<rootDir>/tests/config/test-setup.js'
  ],
  
  // 并发配置
  maxWorkers: '50%',
  
  // 超时配置
  testTimeout: 30000, // 30秒
  
  // 性能测试超时
  slowTestThreshold: 5000, // 5秒
  
  // 输出配置
  verbose: true,
  
  // 清除mock状态
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  
  // 全局变量
  globals: {
    'NODE_ENV': 'test'
  },
  
  // 转换配置
  transform: {},
  
  // 模块文件扩展名
  moduleFileExtensions: [
    'js',
    'json'
  ],
  
  // 收集覆盖率时忽略的文件
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/config/',
    '/data/',
    '/temp/',
    '/.git/',
    '/.vscode/',
    '/Docs/'
  ],
  
  // 测试结果报告
  reporters: [
    'default'
  ],
  
  // 监听模式配置
  watchman: false,
  
  // 测试环境变量
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  }
};