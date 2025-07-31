/**
 * MarketDataManager 单元测试
 * 
 * 测试市场数据管理服务的核心功能：
 * - 市场数据初始化
 * - 交易统计记录
 * - 市场统计数据获取
 * - 每日统计重置
 * - 显示数据格式化
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { MarketDataManager } from '../../../services/market/MarketDataManager.js';
import ItemResolver from '../../../utils/ItemResolver.js';

// 模拟依赖
const mockItemResolver = {
  getItemInfo: jest.fn(),
  getCategoryDisplayName: jest.fn()
};

jest.mock('../../../utils/ItemResolver.js', () => {
  return jest.fn().mockImplementation(() => mockItemResolver);
});

// 模拟global.logger
global.logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('MarketDataManager', () => {
  let marketDataManager;
  let mockRedisClient;
  let mockConfig;

  beforeEach(() => {
    mockRedisClient = {
      exists: jest.fn(),
      hSet: jest.fn(),
      hGetAll: jest.fn(),
      hGet: jest.fn(),
      hIncrBy: jest.fn(),
      multi: jest.fn(),
      pipeline: jest.fn()
    };

    mockConfig = {
      market: {
        enabled: true,
        batch_size: 100,
        floating_items: {
          categories: ['seeds', 'crops'],
          items: ['special_item1', 'special_item2']
        }
      },
      items: {
        seeds: {
          wheat_seed: { 
            name: '小麦种子', 
            price: 10, 
            sellPrice: 5, 
            is_dynamic_price: true,
            category: 'seeds'
          },
          corn_seed: { 
            name: '玉米种子', 
            price: 15, 
            sellPrice: 8,
            category: 'seeds'
          }
        },
        crops: {
          wheat: { 
            name: '小麦', 
            price: 20, 
            sellPrice: 10,
            category: 'crops'
          }
        }
      }
    };

    marketDataManager = new MarketDataManager(mockRedisClient, mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('构造函数', () => {
    test('应该正确初始化配置和依赖', () => {
      expect(marketDataManager.redis).toBe(mockRedisClient);
      expect(marketDataManager.config).toBe(mockConfig);
      expect(marketDataManager.itemResolver).toBeInstanceOf(ItemResolver);
      expect(marketDataManager.batchSize).toBe(100);
    });

    test('应该使用默认配置当配置缺失时', () => {
      const managerWithoutConfig = new MarketDataManager(mockRedisClient, {});
      expect(managerWithoutConfig.batchSize).toBe(100); // 默认值
    });
  });

  describe('initializeMarketData', () => {
    test('应该成功初始化所有浮动价格物品', async () => {
      mockRedisClient.exists.mockResolvedValue(0); // 不存在
      mockItemResolver.getItemInfo
        .mockReturnValueOnce({ name: '小麦种子', price: 10, sellPrice: 5 })
        .mockReturnValueOnce({ name: '小麦', price: 20, sellPrice: 10 });
      mockRedisClient.hSet.mockResolvedValue(1);

      const result = await marketDataManager.initializeMarketData();

      expect(result.success).toBe(true);
      expect(result.totalItems).toBeGreaterThan(0);
      expect(result.initializedItems).toBeGreaterThan(0);
      expect(mockRedisClient.hSet).toHaveBeenCalled();
    });

    test('应该跳过已存在的物品数据', async () => {
      mockRedisClient.exists.mockResolvedValue(1); // 已存在

      const result = await marketDataManager.initializeMarketData();

      expect(result.success).toBe(true);
      expect(result.initializedItems).toBe(0);
    });

    test('应该处理物品配置信息缺失', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      mockItemResolver.getItemInfo.mockReturnValue(null); // 物品不存在

      const result = await marketDataManager.initializeMarketData();

      expect(result.success).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('应该验证价格数据完整性', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      mockItemResolver.getItemInfo.mockReturnValue({ 
        name: '无效物品', 
        price: undefined, // 缺失价格
        sellPrice: 5 
      });

      const result = await marketDataManager.initializeMarketData();

      expect(result.success).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('应该验证价格数据有效性', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      mockItemResolver.getItemInfo.mockReturnValue({ 
        name: '无效物品', 
        price: -10, // 负价格
        sellPrice: 5 
      });

      const result = await marketDataManager.initializeMarketData();

      expect(result.success).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('应该处理Redis操作异常', async () => {
      mockRedisClient.exists.mockRejectedValue(new Error('Redis连接失败'));

      const result = await marketDataManager.initializeMarketData();
      
      expect(result.success).toBe(true);
      expect(result.errors.some(error => error.includes('Redis连接失败'))).toBe(true);
    });
  });

  describe('recordTransaction', () => {
    test('应该成功记录买入交易', async () => {
      const mockMulti = {
        hIncrBy: jest.fn().mockReturnThis(),
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]])
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      const result = await marketDataManager.recordTransaction('wheat_seed', 10, 'buy');

      expect(result).toBe(true);
      expect(mockMulti.hIncrBy).toHaveBeenCalledWith('market:stats:wheat_seed', 'demand_24h', 10);
      expect(mockMulti.hSet).toHaveBeenCalledWith('market:stats:wheat_seed', 'last_transaction', expect.any(String));
    });

    test('应该成功记录卖出交易', async () => {
      const mockMulti = {
        hIncrBy: jest.fn().mockReturnThis(),
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]])
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      const result = await marketDataManager.recordTransaction('wheat_seed', 5, 'sell');

      expect(result).toBe(true);
      expect(mockMulti.hIncrBy).toHaveBeenCalledWith('market:stats:wheat_seed', 'supply_24h', 5);
    });

    test('应该跳过非浮动价格物品', async () => {
      // 模拟非浮动价格物品
      jest.spyOn(marketDataManager, '_isFloatingPriceItem').mockResolvedValue(false);

      const result = await marketDataManager.recordTransaction('fixed_price_item', 10, 'buy');

      expect(result).toBe(false);
      expect(mockRedisClient.multi).not.toHaveBeenCalled();
    });

    test('应该处理Redis事务失败', async () => {
      const mockMulti = {
        hIncrBy: jest.fn().mockReturnThis(),
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('事务执行失败'))
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      const result = await marketDataManager.recordTransaction('wheat_seed', 10, 'buy');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getMarketStats', () => {
    test('应该正确获取单个物品的统计数据', async () => {
      const mockStatsData = {
        base_price: '10',
        current_price: '12',
        current_sell_price: '6',
        demand_24h: '50',
        supply_24h: '30',
        last_updated: '1634567890000',
        price_trend: 'rising',
        price_history: '[10, 11, 12]'
      };

      const mockPipeline = {
        hGetAll: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, mockStatsData]])
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await marketDataManager.getMarketStats('wheat_seed');

      expect(result.itemId).toBe('wheat_seed');
      expect(result.basePrice).toBe(10);
      expect(result.currentPrice).toBe(12);
      expect(result.demand24h).toBe(50);
      expect(result.supply24h).toBe(30);
      expect(result.priceTrend).toBe('rising');
    });

    test('应该正确获取多个物品的统计数据', async () => {
      const mockStatsData1 = {
        base_price: '10',
        current_price: '12',
        current_sell_price: '6'
      };
      const mockStatsData2 = {
        base_price: '15',
        current_price: '18',
        current_sell_price: '9'
      };

      const mockPipeline = {
        hGetAll: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, mockStatsData1],
          [null, mockStatsData2]
        ])
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await marketDataManager.getMarketStats(['wheat_seed', 'corn_seed']);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].itemId).toBe('wheat_seed');
      expect(result[1].itemId).toBe('corn_seed');
    });

    test('应该处理数据不存在的情况', async () => {
      const mockPipeline = {
        hGetAll: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, {}]]) // 空数据
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await marketDataManager.getMarketStats('nonexistent_item');

      expect(result.itemId).toBe('nonexistent_item');
      expect(result.error).toBeDefined();
    });

    test('应该处理空输入', async () => {
      // 为空数组情况设置pipeline mock
      const mockPipeline = {
        hGetAll: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result1 = await marketDataManager.getMarketStats([]);
      expect(result1).toEqual([]);
      
      // 对于空字符串，实际会进入pipeline逻辑但返回错误结果
      // 因为''会被当作有效itemId处理，需要mock pipeline返回
      mockPipeline.exec.mockResolvedValue([[null, {}]]); // 空数据
      const result2 = await marketDataManager.getMarketStats('');
      expect(result2.itemId).toBe('');
      expect(result2.error).toBeDefined();
    });

    test('应该处理Redis操作错误', async () => {
      const mockPipeline = {
        hGetAll: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[new Error('Redis错误'), null]])
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await marketDataManager.getMarketStats('wheat_seed');

      expect(result.error).toBeDefined();
    });
  });

  describe('getMarketDisplayData', () => {
    test('应该正确格式化市场显示数据', async () => {
      mockItemResolver.getItemInfo
        .mockReturnValue({ 
          name: '小麦种子', 
          category: 'seeds',
          price: 10,
          sellPrice: 5
        });
      mockItemResolver.getCategoryDisplayName
        .mockReturnValue('种子');

      jest.spyOn(marketDataManager, 'getMarketStats').mockResolvedValue({
        basePrice: 10,
        currentPrice: 12,
        baseSellPrice: 5,
        currentSellPrice: 6,
        priceTrend: 'rising'
      });

      const result = await marketDataManager.getMarketDisplayData();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('category');
      expect(result[0]).toHaveProperty('items');
      expect(result[0].items[0]).toHaveProperty('buyPriceChange');
      expect(result[0].items[0]).toHaveProperty('sellPriceChange');
    });

    test('应该按类别分组物品', async () => {
      mockItemResolver.getItemInfo
        .mockReturnValueOnce({ name: '小麦种子', category: 'seeds' })
        .mockReturnValueOnce({ name: '小麦', category: 'crops' });
      mockItemResolver.getCategoryDisplayName
        .mockReturnValueOnce('种子')
        .mockReturnValueOnce('作物');

      jest.spyOn(marketDataManager, 'getMarketStats').mockResolvedValue({
        basePrice: 10,
        currentPrice: 12,
        priceTrend: 'rising'
      });

      const result = await marketDataManager.getMarketDisplayData();

      const categories = result.map(group => group.category);
      expect(categories).toContain('种子');
      expect(categories).toContain('作物');
    });

    test('应该处理物品信息缺失', async () => {
      mockItemResolver.getItemInfo.mockReturnValue(null);

      const result = await marketDataManager.getMarketDisplayData();

      expect(result).toEqual([]);
    });
  });

  describe('resetDailyStats', () => {
    test('应该成功重置所有物品的日统计', async () => {
      const mockPipeline = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.hSet.mockResolvedValue(1);

      const result = await marketDataManager.resetDailyStats();

      expect(result.success).toBe(true);
      expect(result.resetCount).toBeGreaterThan(0);
      expect(mockPipeline.hSet).toHaveBeenCalled();
      expect(mockRedisClient.hSet).toHaveBeenCalledWith(
        'market:global:stats',
        expect.objectContaining({
          last_reset: expect.any(String),
          last_reset_count: expect.any(String)
        })
      );
    });

    test('应该在动态定价禁用时返回相应状态', async () => {
      jest.spyOn(marketDataManager, '_isDynamicPricingEnabled').mockReturnValue(false);

      const result = await marketDataManager.resetDailyStats();

      expect(result.success).toBe(true);
      expect(result.reason).toBe('disabled');
      expect(result.resetCount).toBe(0);
    });

    test('应该处理重置过程中的错误', async () => {
      const mockPipeline = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Pipeline执行失败'))
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await marketDataManager.resetDailyStats();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Pipeline执行失败');
    });
  });

  describe('batchUpdateMarketData', () => {
    test('应该成功执行批量更新', async () => {
      const updates = [
        {
          itemId: 'wheat_seed',
          data: { current_price: '12', last_updated: '1634567890000' }
        },
        {
          itemId: 'corn_seed',
          data: { current_price: '18', last_updated: '1634567890000' }
        }
      ];

      const mockPipeline = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await marketDataManager.batchUpdateMarketData(updates);

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      expect(mockPipeline.hSet).toHaveBeenCalledTimes(2);
    });

    test('应该处理空更新数组', async () => {
      const result = await marketDataManager.batchUpdateMarketData([]);

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(0);
    });

    test('应该验证更新数据格式', async () => {
      const invalidUpdates = [
        { itemId: '', data: {} }, // 无效的itemId
        { data: { price: '10' } }, // 缺少itemId
        { itemId: 'wheat_seed' } // 缺少data
      ];

      const mockPipeline = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await marketDataManager.batchUpdateMarketData(invalidUpdates);

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(0);
      expect(result.errors.length).toBe(3);
    });
  });

  describe('_getFloatingPriceItems', () => {
    test('应该从多种配置源获取浮动价格物品', () => {
      const items = marketDataManager._getFloatingPriceItems();

      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      // 应该包含is_dynamic_price标记的物品
      expect(items).toContain('wheat_seed');
      // 应该包含特定类别的物品
      expect(items).toContain('wheat'); // crops类别
      // 应该包含特定指定的物品
      expect(items).toContain('special_item1');
    });

    test('应该去重物品ID', () => {
      const items = marketDataManager._getFloatingPriceItems();
      const uniqueItems = [...new Set(items)];

      expect(items.length).toBe(uniqueItems.length);
    });

    test('应该处理配置缺失的情况', () => {
      const managerWithoutConfig = new MarketDataManager(mockRedisClient, {});
      const items = managerWithoutConfig._getFloatingPriceItems();

      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('_parseStatsData', () => {
    test('应该正确解析Redis统计数据', () => {
      const rawData = {
        base_price: '10.5',
        current_price: '12.3',
        current_sell_price: '6.15',
        demand_24h: '100',
        supply_24h: '80',
        last_updated: '1634567890000',
        price_trend: 'rising',
        price_history: '[10, 11, 12]',
        last_transaction: '1634567800000',
        last_reset: '1634567000000'
      };

      const parsed = marketDataManager._parseStatsData(rawData);

      expect(parsed.basePrice).toBe(10.5);
      expect(parsed.currentPrice).toBe(12.3);
      expect(parsed.currentSellPrice).toBe(6.15);
      expect(parsed.demand24h).toBe(100);
      expect(parsed.supply24h).toBe(80);
      expect(parsed.lastUpdated).toBe(1634567890000);
      expect(parsed.priceTrend).toBe('rising');
      expect(parsed.priceHistory).toEqual([10, 11, 12]);
      expect(parsed.lastTransaction).toBe(1634567800000);
      expect(parsed.lastReset).toBe(1634567000000);
    });

    test('应该处理缺失或无效数据', () => {
      const rawData = {
        base_price: 'invalid',
        demand_24h: null,
        price_history: 'invalid json'
      };

      const parsed = marketDataManager._parseStatsData(rawData);

      expect(parsed.basePrice).toBe(0);
      expect(parsed.demand24h).toBe(0);
      expect(parsed.priceHistory).toEqual([]);
    });
  });

  describe('_parsePriceHistory', () => {
    test('应该正确解析价格历史JSON', () => {
      const historyString = '[10, 11, 12, 13]';
      const result = marketDataManager._parsePriceHistory(historyString);

      expect(result).toEqual([10, 11, 12, 13]);
    });

    test('应该过滤无效价格', () => {
      // 使用有效的JSON字符串测试过滤逻辑
      const historyString = '[10, null, -5, "invalid", 12]';
      const result = marketDataManager._parsePriceHistory(historyString);

      // 根据实际实现，只保留有效的正数
      expect(result).toEqual([10, 12]);
    });

    test('应该处理无效JSON', () => {
      const result = marketDataManager._parsePriceHistory('invalid json');

      expect(result).toEqual([]);
    });

    test('应该处理非数组数据', () => {
      const result = marketDataManager._parsePriceHistory('{"not": "array"}');

      expect(result).toEqual([]);
    });
  });
});