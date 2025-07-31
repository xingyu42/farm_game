/**
 * PriceCalculator 单元测试
 * 
 * 测试价格计算服务的核心功能：
 * - 价格计算算法
 * - 价格趋势分析
 * - 价格历史管理
 * - 缓存机制
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { PriceCalculator } from '../../../services/market/PriceCalculator.js';
import { CommonUtils } from '../../../utils/CommonUtils.js';

// 模拟依赖
jest.mock('../../../utils/CommonUtils.js');

// 模拟global.logger
global.logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('PriceCalculator', () => {
  let priceCalculator;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      market: {
        pricing: {
          sensitivity: 0.1,
          min_ratio: 0.5,
          max_ratio: 1.5,
          sell_price_ratio: 0.5,
          stability_threshold: 2,
          extreme_ratio_max: 10,
          extreme_ratio_min: 0.1
        },
        history: {
          max_records: 168,
          cache_ttl: 300
        }
      }
    };

    // 模拟CommonUtils方法
    CommonUtils.validatePrice = jest.fn((price, context) => {
      if (typeof price !== 'number' || !isFinite(price) || price < 0) {
        throw new Error(`Invalid price in ${context}: ${price}`);
      }
      return true;
    });

    CommonUtils.safeCalculation = jest.fn((calculation, fallback) => {
      try {
        const result = calculation();
        // 如果是数字，检查是否有效
        if (typeof result === 'number') {
          if (isFinite(result) && !isNaN(result)) {
            return result;
          }
          return fallback;
        }
        // 对于非数字结果，如果不是null/undefined就返回
        if (result !== null && result !== undefined) {
          return result;
        }
        return fallback;
      } catch {
        return fallback;
      }
    });

    priceCalculator = new PriceCalculator(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('构造函数', () => {
    test('应该正确初始化配置', () => {
      expect(priceCalculator.config).toBe(mockConfig);
      expect(priceCalculator.cache).toBeInstanceOf(Map);
      expect(priceCalculator.sensitivity).toBe(0.1);
      expect(priceCalculator.sellPriceRatio).toBe(0.5);
    });

    test('应该使用默认配置当配置缺失时', () => {
      const calculatorWithoutConfig = new PriceCalculator({});
      expect(calculatorWithoutConfig.sensitivity).toBe(0.1); // 默认值
    });
  });

  describe('calculatePrice', () => {
    test('应该正确计算正常供需情况的价格', async () => {
      const result = await priceCalculator.calculatePrice('item1', 100, 50, 100);

      expect(result).toHaveProperty('itemId', 'item1');
      expect(result).toHaveProperty('basePrice', 100);
      expect(result).toHaveProperty('buyPrice');
      expect(result).toHaveProperty('sellPrice');
      expect(result).toHaveProperty('demand', 50);
      expect(result).toHaveProperty('supply', 100);
      expect(result).toHaveProperty('ratio');
      expect(result).toHaveProperty('timestamp');
      expect(result).not.toHaveProperty('degraded');
      expect(result.buyPrice).toBeGreaterThan(0);
      expect(result.sellPrice).toBeCloseTo(result.buyPrice * 0.5, 2);
    });

    test('应该正确处理高需求低供应的情况', async () => {
      const result = await priceCalculator.calculatePrice('item1', 100, 200, 50);

      expect(result.buyPrice).toBeGreaterThan(100); // 价格应上涨
      expect(result).not.toHaveProperty('degraded');
    });

    test('应该正确处理低需求高供应的情况', async () => {
      const result = await priceCalculator.calculatePrice('item1', 100, 10, 200);

      expect(result.buyPrice).toBeLessThan(100); // 价格应下跌
      expect(result).not.toHaveProperty('degraded');
    });

    test('应该处理零供应的极端情况', async () => {
      const result = await priceCalculator.calculatePrice('item1', 100, 50, 0);

      expect(result.buyPrice).toBeGreaterThan(100); // 价格应上涨
      expect(result).not.toHaveProperty('degraded');
    });

    test('应该处理零需求的极端情况', async () => {
      const result = await priceCalculator.calculatePrice('item1', 100, 0, 50);

      expect(result.buyPrice).toBeLessThan(100); // 价格应下跌
      expect(result).not.toHaveProperty('degraded');
    });

    test('应该限制价格在配置范围内', async () => {
      // 测试极端高需求情况
      const highDemandResult = await priceCalculator.calculatePrice('item1', 100, 10000, 1);
      expect(highDemandResult.buyPrice).toBeLessThanOrEqual(150); // max_ratio = 1.5

      // 测试极端低需求情况
      const lowDemandResult = await priceCalculator.calculatePrice('item1', 100, 1, 10000);
      expect(lowDemandResult.buyPrice).toBeGreaterThanOrEqual(50); // min_ratio = 0.5
    });

    test('应该处理无效基准价格', async () => {
      // 模拟CommonUtils.validatePrice抛出错误来触发降级模式
      CommonUtils.validatePrice.mockImplementationOnce(() => {
        throw new Error('Invalid price');
      });
      
      const result = await priceCalculator.calculatePrice('item1', 100, 50, 100);

      expect(result).toHaveProperty('degraded', true);
      expect(result.buyPrice).toBe(100); // degraded模式返回basePrice
      expect(result.sellPrice).toBeCloseTo(100 * 0.5, 2);
    });

    test('应该使用缓存机制', async () => {
      // 第一次调用
      const result1 = await priceCalculator.calculatePrice('item1', 100, 50, 100);
      
      // 第二次调用应该使用缓存
      const result2 = await priceCalculator.calculatePrice('item1', 100, 50, 100);
      
      expect(result1).toEqual(result2);
      expect(priceCalculator.cache.size).toBeGreaterThan(0);
    });
  });

  describe('analyzePriceTrend', () => {
    test('应该识别价格上涨趋势', () => {
      const trend = priceCalculator.analyzePriceTrend(100, 110);
      expect(trend).toBe('rising');
    });

    test('应该识别价格下跌趋势', () => {
      const trend = priceCalculator.analyzePriceTrend(100, 90);
      expect(trend).toBe('falling');
    });

    test('应该识别价格稳定趋势', () => {
      const trend = priceCalculator.analyzePriceTrend(100, 101);
      expect(trend).toBe('stable');
    });

    test('应该处理零价格情况', () => {
      const trend = priceCalculator.analyzePriceTrend(0, 100);
      expect(trend).toBe('stable');
    });

    test('应该使用稳定性阈值', () => {
      // 变化1.5%，小于阈值2%，应该是稳定
      const trend1 = priceCalculator.analyzePriceTrend(100, 101.5);
      expect(trend1).toBe('stable');

      // 变化2.5%，大于阈值2%，应该是上涨
      const trend2 = priceCalculator.analyzePriceTrend(100, 102.5);
      expect(trend2).toBe('rising');
    });
  });

  describe('updatePriceHistory', () => {
    test('应该正确添加新价格到历史记录', () => {
      const historyString = JSON.stringify([100, 105, 103]);
      const result = priceCalculator.updatePriceHistory(historyString, 108);

      expect(result).toEqual([100, 105, 103, 108]);
    });

    test('应该限制历史记录长度', () => {
      // 创建超过最大记录数的历史
      const longHistory = Array(170).fill(100);
      const historyString = JSON.stringify(longHistory);
      const result = priceCalculator.updatePriceHistory(historyString, 110);

      expect(result.length).toBe(168); // 应该限制在max_records
      expect(result[result.length - 1]).toBe(110); // 最新价格应该在末尾
    });

    test('应该过滤无效价格', () => {
      const historyString = JSON.stringify([100, NaN, -50, 105, null, 'invalid']);
      const result = priceCalculator.updatePriceHistory(historyString, 108);

      expect(result).toEqual([100, 105, 108]); // 只保留有效价格
    });

    test('应该处理空历史记录', () => {
      const result = priceCalculator.updatePriceHistory('[]', 100);
      expect(result).toEqual([100]);
    });

    test('应该处理无效JSON', () => {
      const result = priceCalculator.updatePriceHistory('invalid json', 100);
      expect(result).toEqual([100]);
    });

    test('应该处理非数组历史数据', () => {
      const result = priceCalculator.updatePriceHistory('{"not": "array"}', 100);
      expect(result).toEqual([100]);
    });
  });

  describe('calculateBatchPrices', () => {
    test('应该正确批量计算价格', async () => {
      const items = [
        { itemId: 'item1', basePrice: 100, demand: 50, supply: 100 },
        { itemId: 'item2', basePrice: 200, demand: 80, supply: 60 },
        { itemId: 'item3', basePrice: 150, demand: 120, supply: 80 }
      ];

      const results = await priceCalculator.calculateBatchPrices(items);

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result).toHaveProperty('itemId', items[index].itemId);
        expect(result).toHaveProperty('buyPrice');
        expect(result).toHaveProperty('sellPrice');
        expect(result).not.toHaveProperty('degraded');
      });
    });

    test('应该处理空数组', async () => {
      const results = await priceCalculator.calculateBatchPrices([]);
      expect(results).toEqual([]);
    });
  });

  describe('clearCache', () => {
    test('应该清理所有缓存', async () => {
      // 先添加一些缓存
      await priceCalculator.calculatePrice('item1', 100, 50, 100);
      expect(priceCalculator.cache.size).toBeGreaterThan(0);

      // 清理缓存
      priceCalculator.clearCache();
      expect(priceCalculator.cache.size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    test('应该返回缓存统计信息', () => {
      const stats = priceCalculator.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('hitRate');
      expect(stats.hitRate).toBe('未实现'); // 实际API返回字符串
    });
  });

  describe('性能和边界测试', () => {
    test('应该处理大量并发价格计算', async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(priceCalculator.calculatePrice(`item${i}`, 100, 50 + i, 100 + i));
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result).toHaveProperty('buyPrice');
        expect(result).toHaveProperty('sellPrice');
        expect(result).not.toHaveProperty('degraded');
      });
    });

    test('应该处理极端数值', async () => {
      const extremeValues = [
        [Number.MAX_SAFE_INTEGER, 1, 1],
        [1, Number.MAX_SAFE_INTEGER, 1],
        [1, 1, Number.MAX_SAFE_INTEGER]
      ];

      for (const [basePrice, demand, supply] of extremeValues) {
        const result = await priceCalculator.calculatePrice('item', basePrice, demand, supply);
        expect(result).toHaveProperty('buyPrice');
        expect(result).toHaveProperty('sellPrice');
      }
    });
  });

  describe('错误处理', () => {
    test('应该处理计算过程中的异常', async () => {
      // 模拟CommonUtils.validatePrice抛出错误
      CommonUtils.validatePrice.mockImplementationOnce(() => {
        throw new Error('Validation failed');
      });

      const result = await priceCalculator.calculatePrice('item1', 100, 50, 100);

      expect(result).toHaveProperty('degraded', true);
    });

    test('应该记录错误日志当检测到异常', async () => {
      // 模拟CommonUtils.validatePrice抛出错误
      CommonUtils.validatePrice.mockImplementationOnce(() => {
        throw new Error('Validation failed');
      });
      
      await priceCalculator.calculatePrice('item1', 100, 50, 100);

      expect(logger.error).toHaveBeenCalled();
    });
  });
});