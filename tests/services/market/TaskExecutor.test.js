/**
 * TaskExecutor 单元测试
 */

import { TaskExecutor } from '../../../services/market/TaskExecutor.js';

// 模拟global.logger
global.logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

describe('TaskExecutor', () => {
  let mockMarketService;
  let mockConfig;
  let taskExecutor;

  beforeEach(() => {
    mockMarketService = {
      updateDynamicPrices: jest.fn().mockResolvedValue({ success: true, updated: 5 }),
      resetDailyStats: jest.fn().mockResolvedValue({ success: true, reset: 10 }),
      monitorMarket: jest.fn().mockResolvedValue({ success: true, status: 'healthy' })
    };

    mockConfig = {
      market: {
        scheduler: {
          retry_attempts: 2
        }
      }
    };

    taskExecutor = new TaskExecutor(mockMarketService, mockConfig);

    // 清除mock调用记录
    jest.clearAllMocks();
  });

  describe('构造函数和基础功能', () => {
    test('应该能创建TaskExecutor实例', () => {
      expect(taskExecutor).toBeInstanceOf(TaskExecutor);
      expect(taskExecutor.marketService).toBe(mockMarketService);
      expect(taskExecutor.config).toBe(mockConfig);
    });

    test('应该正确映射任务函数', () => {
      expect(taskExecutor.taskMapping).toHaveProperty('priceUpdate');
      expect(taskExecutor.taskMapping).toHaveProperty('statsReset');
      expect(taskExecutor.taskMapping).toHaveProperty('monitoring');
    });
  });

  describe('任务执行', () => {
    test('应该成功执行priceUpdate任务', async () => {
      const result = await taskExecutor.execute('priceUpdate');
      
      expect(mockMarketService.updateDynamicPrices).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, updated: 5 });
      expect(global.logger.debug).toHaveBeenCalledWith('[TaskExecutor] 执行任务 priceUpdate, 尝试 1/2');
    });

    test('应该成功执行statsReset任务', async () => {
      const result = await taskExecutor.execute('statsReset');
      
      expect(mockMarketService.resetDailyStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, reset: 10 });
    });

    test('应该成功执行monitoring任务', async () => {
      const result = await taskExecutor.execute('monitoring');
      
      expect(mockMarketService.monitorMarket).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, status: 'healthy' });
    });

    test('应该抛出未知任务错误', async () => {
      await expect(taskExecutor.execute('unknownTask')).rejects.toThrow('Unknown task: unknownTask');
    });
  });

  describe('重试机制', () => {
    test('应该在第一次失败后重试', async () => {
      mockMarketService.updateDynamicPrices
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({ success: true, updated: 3 });

      const result = await taskExecutor.execute('priceUpdate');
      
      expect(mockMarketService.updateDynamicPrices).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, updated: 3 });
      expect(global.logger.warn).toHaveBeenCalledWith(
        '[TaskExecutor] 任务 priceUpdate 第 1 次尝试失败，1000ms后重试',
        { error: 'Network timeout' }
      );
      expect(global.logger.info).toHaveBeenCalledWith(
        '[TaskExecutor] 任务 priceUpdate 重试成功，尝试次数: 2'
      );
    });

    test('应该在达到最大重试次数后失败', async () => {
      const error = new Error('Persistent failure');
      mockMarketService.updateDynamicPrices.mockRejectedValue(error);

      await expect(taskExecutor.execute('priceUpdate')).rejects.toThrow('Persistent failure');
      
      expect(mockMarketService.updateDynamicPrices).toHaveBeenCalledTimes(2); // 原始尝试 + 1次重试
      expect(global.logger.error).toHaveBeenCalledWith(
        '[TaskExecutor] 任务 priceUpdate 最终失败，已尝试 2 次',
        { error: 'Persistent failure' }
      );
    });

    test('应该正确判断可重试错误', () => {
      const timeoutError = new Error('Task timeout after 5000ms');
      const networkError = new Error('Network connection failed');
      const resetError = new Error('Connection ECONNRESET');
      const timedoutError = new Error('Request ETIMEDOUT');
      const businessError = new Error('Invalid data format');

      expect(taskExecutor._shouldRetry(timeoutError, 1)).toBe(true);
      expect(taskExecutor._shouldRetry(networkError, 1)).toBe(true);
      expect(taskExecutor._shouldRetry(resetError, 1)).toBe(true);
      expect(taskExecutor._shouldRetry(timedoutError, 1)).toBe(true);
      expect(taskExecutor._shouldRetry(businessError, 1)).toBe(false);
    });

    test('应该在遇到不可重试错误时立即失败', async () => {
      const error = new Error('Invalid data format');
      mockMarketService.updateDynamicPrices.mockRejectedValue(error);

      await expect(taskExecutor.execute('priceUpdate')).rejects.toThrow('Invalid data format');
      
      expect(mockMarketService.updateDynamicPrices).toHaveBeenCalledTimes(1); // 只尝试一次
      expect(global.logger.error).toHaveBeenCalledWith(
        '[TaskExecutor] 任务 priceUpdate 遇到不可重试错误',
        { error: 'Invalid data format' }
      );
    });
  });

  describe('配置处理', () => {
    test('应该使用配置中的重试次数', async () => {
      const customConfig = {
        market: {
          scheduler: {
            retry_attempts: 3
          }
        }
      };
      
      const customExecutor = new TaskExecutor(mockMarketService, customConfig);
      mockMarketService.updateDynamicPrices.mockRejectedValue(new Error('Network timeout'));

      await expect(customExecutor.execute('priceUpdate')).rejects.toThrow('Network timeout');
      
      expect(mockMarketService.updateDynamicPrices).toHaveBeenCalledTimes(3); // 原始尝试 + 2次重试
    });

    test('应该使用默认重试次数当配置缺失时', async () => {
      const emptyConfig = {};
      const defaultExecutor = new TaskExecutor(mockMarketService, emptyConfig);
      mockMarketService.updateDynamicPrices.mockRejectedValue(new Error('Network timeout'));

      await expect(defaultExecutor.execute('priceUpdate')).rejects.toThrow('Network timeout');
      
      expect(mockMarketService.updateDynamicPrices).toHaveBeenCalledTimes(2); // 默认重试1次
    });
  });

  describe('错误处理和日志', () => {
    test('应该记录任务执行日志', async () => {
      await taskExecutor.execute('priceUpdate');
      
      expect(global.logger.debug).toHaveBeenCalledWith('[TaskExecutor] 执行任务 priceUpdate, 尝试 1/2');
    });

    test('应该记录重试警告日志', async () => {
      mockMarketService.updateDynamicPrices
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({ success: true });

      await taskExecutor.execute('priceUpdate');
      
      expect(global.logger.warn).toHaveBeenCalledWith(
        '[TaskExecutor] 任务 priceUpdate 第 1 次尝试失败，1000ms后重试',
        { error: 'Network timeout' }
      );
    });

    test('应该记录最终失败错误日志', async () => {
      mockMarketService.updateDynamicPrices.mockRejectedValue(new Error('Final error'));

      await expect(taskExecutor.execute('priceUpdate')).rejects.toThrow('Final error');
      
      expect(global.logger.error).toHaveBeenCalledWith(
        '[TaskExecutor] 任务 priceUpdate 最终失败，已尝试 2 次',
        { error: 'Final error' }
      );
    });
  });
});
