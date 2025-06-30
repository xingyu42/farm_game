/**
 * LandService 测试文件
 * 测试土地扩张和品质进阶功能
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T13:47:33+08:00; Reason: Shrimp Task ID: #c69301bb, creating test cases for land quality upgrade system T7;
// }}

const { LandService } = require('../../services/LandService');
const PlayerService = require('../../services/PlayerService');
const redisClient = require('../../common/redisClient');
const Config = require('../../models/Config');

// Mock Redis客户端
jest.mock('../../common/redisClient');

describe('LandService', () => {
  let landService;
  let playerService;
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // 创建mock Redis客户端
    mockRedis = {
      generateKey: jest.fn((type, id) => `${type}:${id}`),
      get: jest.fn(),
      set: jest.fn(),
      serialize: jest.fn(data => JSON.stringify(data)),
      transaction: jest.fn()
    };
    
    redisClient.generateKey = mockRedis.generateKey;
    redisClient.get = mockRedis.get;
    redisClient.set = mockRedis.set;
    redisClient.serialize = mockRedis.serialize;
    redisClient.transaction = mockRedis.transaction;

    // 创建mock PlayerService
    playerService = {
      getPlayerData: jest.fn(),
      expandLand: jest.fn()
    };

    // 实例化LandService
    landService = new LandService(redisClient, Config, playerService);
  });

  afterAll(async () => {
    // 清理所有异步操作
    jest.clearAllMocks();
    jest.clearAllTimers();
    
    // 如果有真实的Redis连接，关闭它
    if (redisClient && typeof redisClient.close === 'function') {
      await redisClient.close().catch(() => {});
    }
  });

  describe('土地品质进阶功能', () => {
    const mockPlayerData = {
      userId: 'test_user',
      level: 30,
      coins: 100000,
      landCount: 6,
      maxLandCount: 24,
      lands: {
        land_1: { quality: 'normal' },
        land_2: { quality: 'normal' },
        land_3: { quality: 'copper' }
      },
      inventory: {
        copper_essence: { quantity: 2 },
        silver_essence: { quantity: 1 }
      }
    };

    describe('getLandQualityUpgradeInfo', () => {
      beforeEach(() => {
        playerService.getPlayerData.mockResolvedValue(mockPlayerData);
      });

      test('应该返回正确的普通土地进阶信息', async () => {
        const result = await landService.getLandQualityUpgradeInfo('test_user', 1);

        expect(result.canUpgrade).toBe(true);
        expect(result.landId).toBe(1);
        expect(result.currentQuality).toBe('normal');
        expect(result.nextQuality).toBe('copper');
        expect(result.currentQualityName).toBe('普通土地');
        expect(result.nextQualityName).toBe('铜质土地');
        expect(result.requirements.level).toBe(28);
        expect(result.requirements.gold).toBe(50000);
        expect(result.requirements.materials).toHaveLength(1);
        expect(result.requirements.materials[0].item_id).toBe('copper_essence');
      });

      test('应该正确检查进阶条件满足情况', async () => {
        const result = await landService.getLandQualityUpgradeInfo('test_user', 1);

        expect(result.meetsLevelRequirement).toBe(true); // level 30 >= 28
        expect(result.meetsGoldRequirement).toBe(true);  // coins 100000 >= 50000
        expect(result.meetsMaterialRequirement).toBe(true); // copper_essence 2 >= 1
        expect(result.meetsAllRequirements).toBe(true);
      });

      test('应该处理等级不足的情况', async () => {
        const lowLevelPlayerData = { ...mockPlayerData, level: 25 };
        playerService.getPlayerData.mockResolvedValue(lowLevelPlayerData);

        const result = await landService.getLandQualityUpgradeInfo('test_user', 1);

        expect(result.meetsLevelRequirement).toBe(false);
        expect(result.meetsAllRequirements).toBe(false);
      });

      test('应该处理金币不足的情况', async () => {
        const poorPlayerData = { ...mockPlayerData, coins: 10000 };
        playerService.getPlayerData.mockResolvedValue(poorPlayerData);

        const result = await landService.getLandQualityUpgradeInfo('test_user', 1);

        expect(result.meetsGoldRequirement).toBe(false);
        expect(result.meetsAllRequirements).toBe(false);
      });

      test('应该处理材料不足的情况', async () => {
        const noMaterialPlayerData = {
          ...mockPlayerData,
          inventory: { copper_essence: { quantity: 0 } }
        };
        playerService.getPlayerData.mockResolvedValue(noMaterialPlayerData);

        const result = await landService.getLandQualityUpgradeInfo('test_user', 1);

        expect(result.meetsMaterialRequirement).toBe(false);
        expect(result.materialIssues).toContain('缺少 铜质精华 1 个');
        expect(result.meetsAllRequirements).toBe(false);
      });

      test('应该处理已达到最高品质的土地', async () => {
        const playerDataWithGoldLand = {
          ...mockPlayerData,
          lands: { land_1: { quality: 'gold' } }
        };
        playerService.getPlayerData.mockResolvedValue(playerDataWithGoldLand);

        const result = await landService.getLandQualityUpgradeInfo('test_user', 1);

        expect(result.canUpgrade).toBe(false);
        expect(result.reason).toBe('土地已达到最高品质');
      });

      test('应该处理无效的土地编号', async () => {
        const result = await landService.getLandQualityUpgradeInfo('test_user', 99);

        expect(result.canUpgrade).toBe(false);
        expect(result.error).toContain('无效的土地编号');
      });

      test('应该处理土地数据不存在的情况', async () => {
        const playerDataNoLands = { ...mockPlayerData, lands: {} };
        playerService.getPlayerData.mockResolvedValue(playerDataNoLands);

        const result = await landService.getLandQualityUpgradeInfo('test_user', 1);

        expect(result.canUpgrade).toBe(false);
        expect(result.error).toContain('土地 1 数据不存在');
      });
    });

    describe('upgradeLandQuality', () => {
      beforeEach(() => {
        playerService.getPlayerData.mockResolvedValue(mockPlayerData);
      });

      test('应该成功执行土地品质进阶', async () => {
        // Mock Redis get返回玩家数据（用于二次验证）
        mockRedis.get.mockResolvedValue(mockPlayerData);
        // Mock Redis set用于保存更新的数据
        mockRedis.set.mockResolvedValue('OK');

        const result = await landService.upgradeLandQuality('test_user', 1);

        expect(result.success).toBe(true);
        expect(result.message).toContain('成功进阶为铜质土地');
        expect(result.landId).toBe(1);
        expect(result.fromQuality).toBe('normal');
        expect(result.toQuality).toBe('copper');
        expect(result.costGold).toBe(50000);
        expect(mockRedis.set).toHaveBeenCalled();
      });

      test('应该在条件不满足时拒绝进阶', async () => {
        const poorPlayerData = { ...mockPlayerData, coins: 10000 };
        playerService.getPlayerData.mockResolvedValue(poorPlayerData);

        const result = await landService.upgradeLandQuality('test_user', 1);

        expect(result.success).toBe(false);
        expect(result.message).toContain('进阶条件不满足');
        expect(result.message).toContain('金币不足');
      });

      test('应该在无效土地ID时拒绝进阶', async () => {
        const result = await landService.upgradeLandQuality('test_user', 99);

        expect(result.success).toBe(false);
        expect(result.message).toContain('无效的土地编号');
      });

      test('应该在已达到最高品质时拒绝进阶', async () => {
        const playerDataWithGoldLand = {
          ...mockPlayerData,
          lands: { land_1: { quality: 'gold' } }
        };
        playerService.getPlayerData.mockResolvedValue(playerDataWithGoldLand);

        const result = await landService.upgradeLandQuality('test_user', 1);

        expect(result.success).toBe(false);
        expect(result.message).toBe('土地已达到最高品质');
      });

      test('应该正确处理Redis事务中的并发检查', async () => {
        // 设置初始条件满足铜质土地进阶要求
        playerService.getPlayerData.mockResolvedValue(mockPlayerData);
        
        // 模拟并发情况：Redis.get返回的数据条件不满足（测试铜质土地进阶需要28级和50000金币）
        const updatedPlayerData = {
          ...mockPlayerData,
          level: 25,    // 不满足等级要求（需要28级）
          coins: 20000  // 不满足金币要求（需要50000）
        };
        mockRedis.get.mockResolvedValue(updatedPlayerData);

        const result = await landService.upgradeLandQuality('test_user', 1);

        expect(result.success).toBe(false);
        expect(result.message).toBe('进阶条件已不满足，请重试');
      });
    });

    describe('土地扩张功能', () => {
      test('应该成功调用PlayerService的expandLand方法', async () => {
        const mockExpandResult = {
          success: true,
          message: '扩张成功',
          landNumber: 7,
          costGold: 1000
        };
        playerService.expandLand.mockResolvedValue(mockExpandResult);

        const result = await landService.expandLand('test_user');

        expect(playerService.expandLand).toHaveBeenCalledWith('test_user');
        expect(result).toEqual(mockExpandResult);
      });

      test('应该处理扩张失败的情况', async () => {
        const mockExpandResult = {
          success: false,
          message: '条件不满足'
        };
        playerService.expandLand.mockResolvedValue(mockExpandResult);

        const result = await landService.expandLand('test_user');

        expect(result.success).toBe(false);
        expect(result.message).toBe('条件不满足');
      });
    });

    describe('辅助方法', () => {
      test('_getItemName 应该正确返回物品名称', () => {
        const copperName = landService._getItemName('copper_essence');
        const unknownName = landService._getItemName('unknown_item');

        expect(copperName).toBe('铜质精华');
        expect(unknownName).toBe('unknown_item');
      });

      test('getLandSystemConfig 应该返回正确的配置', () => {
        const config = landService.getLandSystemConfig();

        expect(config.startingLands).toBe(6);
        expect(config.maxLands).toBe(24);
        expect(config.expansionConfig).toBeDefined();
        expect(config.qualityConfig).toBeDefined();
      });
    });
  });
}); 