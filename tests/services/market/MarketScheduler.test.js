/**
 * MarketScheduler 集成测试
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import MarketScheduler from '../../../services/market/MarketScheduler.js';

// 模拟依赖组件
jest.mock('../../../services/market/taskScheduler.js');
jest.mock('../../../utils/RedisLock.js');

import { TaskScheduler } from '../../../services/market/taskScheduler.js';
import { RedisLock } from '../../../utils/RedisLock.js';

// 模拟global.logger
global.logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('MarketScheduler', () => {
  let mockMarketService;
  let mockRedisClient;
  let mockConfig;
  let marketScheduler;

  beforeEach(() => {
    mockMarketService = {
      updateDynamicPrices: jest.fn().mockResolvedValue({ success: true }),
      resetDailyStats: jest.fn().mockResolvedValue({ success: true }),
      monitorMarket: jest.fn().mockResolvedValue({ success: true })
    };

    mockRedisClient = {
      keyPrefix: 'test',
      client: {}
    };

    mockConfig = {
      market: {
        scheduler: {
          enabled: true,
          task_timeout: 300000,
          retry_attempts: 2
        }
      }
    };

    // 设置mock实现
    TaskScheduler.mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      triggerNow: jest.fn().mockResolvedValue({ success: true }),
      getTaskDefinition: jest.fn().mockReturnValue({
        name: 'testTask',
        timeout: 5000,
        retryAttempts: 2
      })
    }));

    RedisLock.mockImplementation(() => ({}));

    marketScheduler = new MarketScheduler(mockMarketService, mockRedisClient, mockConfig);

    // 清除mock调用记录
    jest.clearAllMocks();
  });

  describe('构造函数和组件集成', () => {
    test('应该能创建MarketScheduler实例', () => {
      expect(marketScheduler).toBeInstanceOf(MarketScheduler);
      expect(marketScheduler.marketService).toBe(mockMarketService);
      expect(marketScheduler.redis).toBe(mockRedisClient);
      expect(marketScheduler.config).toBe(mockConfig);
      expect(marketScheduler.isRunning).toBe(false);
    });

    test('应该正确初始化所有组件', () => {
      expect(TaskConfig).toHaveBeenCalledWith(mockConfig);
      expect(RedisLock).toHaveBeenCalledWith(mockRedisClient);
      expect(SimpleTaskScheduler).toHaveBeenCalledWith(
        marketScheduler.taskConfig,
        marketScheduler.lockManager
      );
      expect(TaskExecutor).toHaveBeenCalledWith(mockMarketService, mockConfig);
    });

    test('应该设置任务触发回调', () => {
      expect(marketScheduler.scheduler._onTaskTrigger).toBe(marketScheduler._handleTaskTrigger);
    });
  });

  describe('向后兼容的API', () => {
    test('应该能启动调度器', () => {
      marketScheduler.start();

      expect(marketScheduler.isRunning).toBe(true);
      expect(marketScheduler.scheduler.start).toHaveBeenCalledTimes(1);
      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 启动市场任务调度器');
      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 任务调度器启动成功');
    });

    test('应该能停止调度器', () => {
      marketScheduler.start();
      marketScheduler.stop();

      expect(marketScheduler.isRunning).toBe(false);
      expect(marketScheduler.scheduler.stop).toHaveBeenCalledTimes(1);
      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 停止市场任务调度器');
      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 任务调度器已停止');
    });

    test('应该防止重复启动', () => {
      marketScheduler.start();
      marketScheduler.start(); // 第二次启动

      expect(global.logger.warn).toHaveBeenCalledWith('[MarketScheduler] 调度器已在运行中');
      expect(marketScheduler.scheduler.start).toHaveBeenCalledTimes(1); // 只调用一次
    });

    test('应该能手动执行任务', async () => {
      const result = await marketScheduler.executeTask('testTask');

      expect(marketScheduler.taskConfig.getTaskDefinition).toHaveBeenCalledWith('testTask');
      expect(marketScheduler.scheduler.executeTask).toHaveBeenCalledWith(
        'manual_testTask',
        expect.any(Function),
        5000
      );
      expect(result).toEqual({ success: true });
      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 手动触发任务: testTask');
    });

    test('应该处理未知任务', async () => {
      marketScheduler.taskConfig.getTaskDefinition.mockReturnValue(null);

      await expect(marketScheduler.executeTask('unknownTask')).rejects.toThrow('未知任务: unknownTask');
    });
  });

  describe('任务触发处理', () => {
    test('应该正确处理任务触发', async () => {
      await marketScheduler._handleTaskTrigger('testTask', 5000);

      expect(marketScheduler.scheduler.executeTask).toHaveBeenCalledWith(
        'testTask',
        expect.any(Function),
        5000
      );
    });

    test('应该处理任务触发失败', async () => {
      const error = new Error('Task execution failed');
      marketScheduler.scheduler.executeTask.mockRejectedValue(error);

      // 不应该抛出错误，而是记录日志
      await expect(marketScheduler._handleTaskTrigger('testTask', 5000)).resolves.toBeUndefined();

      expect(global.logger.error).toHaveBeenCalledWith(
        '[MarketScheduler] 任务 testTask 执行失败',
        { error: 'Task execution failed' }
      );
    });
  });

  describe('组件协作', () => {
    test('手动执行任务时应该调用TaskExecutor', async () => {
      // 模拟scheduler.executeTask的实现
      marketScheduler.scheduler.executeTask.mockImplementation(async (taskName, taskFn, timeout) => {
        return await taskFn();
      });

      await marketScheduler.executeTask('testTask');

      expect(marketScheduler.executor.execute).toHaveBeenCalledWith('testTask');
    });

    test('任务触发时应该调用TaskExecutor', async () => {
      // 模拟scheduler.executeTask的实现
      marketScheduler.scheduler.executeTask.mockImplementation(async (taskName, taskFn, timeout) => {
        return await taskFn();
      });

      await marketScheduler._handleTaskTrigger('testTask', 5000);

      expect(marketScheduler.executor.execute).toHaveBeenCalledWith('testTask');
    });
  });

  describe('错误处理', () => {
    test('应该记录启动日志', () => {
      marketScheduler.start();

      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 启动市场任务调度器');
      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 任务调度器启动成功');
    });

    test('应该记录停止日志', () => {
      marketScheduler.stop();

      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 停止市场任务调度器');
      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 任务调度器已停止');
    });

    test('应该记录手动任务执行日志', async () => {
      await marketScheduler.executeTask('testTask');

      expect(global.logger.info).toHaveBeenCalledWith('[MarketScheduler] 手动触发任务: testTask');
    });

    test('应该记录任务执行失败日志', async () => {
      const error = new Error('Execution failed');
      marketScheduler.scheduler.executeTask.mockRejectedValue(error);

      await marketScheduler._handleTaskTrigger('testTask', 5000);

      expect(global.logger.error).toHaveBeenCalledWith(
        '[MarketScheduler] 任务 testTask 执行失败',
        { error: 'Execution failed' }
      );
    });
  });

  describe('向后兼容性验证', () => {
    test('应该保持相同的构造函数签名', () => {
      const scheduler = new MarketScheduler(mockMarketService, mockRedisClient, mockConfig);

      expect(scheduler.marketService).toBe(mockMarketService);
      expect(scheduler.redis).toBe(mockRedisClient);
      expect(scheduler.config).toBe(mockConfig);
    });

    test('应该保持相同的公共方法', () => {
      expect(typeof marketScheduler.start).toBe('function');
      expect(typeof marketScheduler.stop).toBe('function');
      expect(typeof marketScheduler.executeTask).toBe('function');
    });

    test('应该保持相同的属性', () => {
      expect(marketScheduler).toHaveProperty('marketService');
      expect(marketScheduler).toHaveProperty('redis');
      expect(marketScheduler).toHaveProperty('config');
      expect(marketScheduler).toHaveProperty('isRunning');
    });
  });
});
