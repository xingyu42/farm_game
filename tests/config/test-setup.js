/**
 * Jest测试环境设置文件 - 精简版
 * 只包含基础的测试环境配置
 */

import { MockRedisClient } from '../helpers/mocks/MockRedisClient.js';

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.REDIS_DB = '15'; // 使用专用的测试数据库

// 全局测试环境配置 - 简化版
global.mockRedis = null;

// 扩展Jest匹配器
expect.extend({
  /**
   * 检查Redis操作结果
   */
  toBeRedisSuccess(received) {
    const pass = received && received.success === true;
    if (pass) {
      return {
        message: () => `期望Redis操作失败，但操作成功`,
        pass: true,
      };
    } else {
      return {
        message: () => `期望Redis操作成功，但操作失败: ${received?.message || '未知错误'}`,
        pass: false,
      };
    }
  },

  /**
   * 检查玩家数据结构
   */
  toBeValidPlayer(received) {
    const requiredFields = ['userId', 'nickname', 'level', 'experience', 'money', 'energy'];
    const pass = requiredFields.every(field => received && received[field] !== undefined);
    
    if (pass) {
      return {
        message: () => `期望不是有效的玩家数据`,
        pass: true,
      };
    } else {
      const missingFields = requiredFields.filter(field => !received || received[field] === undefined);
      return {
        message: () => `玩家数据缺少必填字段: ${missingFields.join(', ')}`,
        pass: false,
      };
    }
  },

  /**
   * 检查执行时间是否在阈值内
   */
  toCompleteWithin(received, expectedTime) {
    const pass = received <= expectedTime;
    if (pass) {
      return {
        message: () => `期望执行时间超过${expectedTime}ms，但实际为${received}ms`,
        pass: true,
      };
    } else {
      return {
        message: () => `期望执行时间在${expectedTime}ms内，但实际为${received}ms`,
        pass: false,
      };
    }
  },

  /**
   * 检查土地状态
   */
  toHaveLandStatus(received, expectedStatus) {
    const pass = received && received.status === expectedStatus;
    if (pass) {
      return {
        message: () => `期望土地状态不是'${expectedStatus}'`,
        pass: true,
      };
    } else {
      return {
        message: () => `期望土地状态为'${expectedStatus}'，但实际为'${received?.status}'`,
        pass: false,
      };
    }
  }
});

// Jest全局钩子函数 - 精简版
beforeAll(async () => {
  // 只初始化基础的Redis Mock
  global.mockRedis = new MockRedisClient();
  await global.mockRedis.connect();
  console.log('✅ 精简测试环境初始化完成');
}, 10000);

afterAll(async () => {
  // 清理Redis Mock
  if (global.mockRedis) {
    await global.mockRedis.disconnect();
    global.mockRedis = null;
  }
  console.log('✅ 测试环境清理完成');
}, 10000);

// 简化的beforeEach和afterEach
beforeEach(async () => {
  // 重置Redis Mock状态
  if (global.mockRedis) {
    await global.mockRedis.flushall();
  }
});

afterEach(async () => {
  // 基础清理即可
});

// 处理未捕获的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('测试中发生未处理的Promise拒绝:', reason);
  console.error('Promise:', promise);
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('测试中发生未捕获的异常:', error);
});

// 配置测试超时 - 通过beforeAll钩子设置
// jest.setTimeout(30000); // 注释掉，因为jest在ES模块中不是全局可用的

// 配置控制台输出
if (process.env.TEST_VERBOSE !== 'true') {
  // 在非详细模式下抑制某些控制台输出
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => {
    // 过滤掉一些不重要的警告
    const message = args.join(' ');
    if (message.includes('DeprecationWarning') || 
        message.includes('ExperimentalWarning')) {
      return;
    }
    originalConsoleWarn.apply(console, args);
  };
}

// 导出测试工具函数
global.testUtils = {
  /**
   * 等待指定时间
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 生成随机用户ID
   */
  generateUserId() {
    return `test_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * 生成随机字符串
   */
  generateRandomString(length = 10) {
    return Math.random().toString(36).substring(2, 2 + length);
  },

  /**
   * 深度克隆对象
   */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  /**
   * 检查对象是否包含指定属性
   */
  hasProperties(obj, properties) {
    return properties.every(prop => obj.hasOwnProperty(prop));
  }
};

console.log('🚀 Jest测试环境设置完成');