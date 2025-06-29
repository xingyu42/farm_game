/**
 * PlayerService Jest Test Suite (Updated for PRD v3.2)
 * 使用现代化的Jest测试框架，测试完整的玩家管理功能
 */

const PlayerService = require('../../services/PlayerService');

// Mock Redis Client
const mockRedisClient = {
  generateKey: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  serialize: jest.fn(),
  transaction: jest.fn()
};

// Mock Config (完整的PRD配置)
const mockConfig = {
  levels: {
    default: {
      startingCoins: 100
    },
    levels: {
      requirements: {
        1: { experience: 0, description: "新手农夫", unlocks: ["carrot"] },
        2: { experience: 100, description: "见习农夫", unlocks: ["wheat"] },
        3: { experience: 250, description: "熟练农夫", unlocks: ["tomato", "watering_can"] },
        4: { experience: 450, description: "专业农夫", unlocks: ["land_expansion_1"] },
        5: { experience: 700, description: "农场主", unlocks: ["premium_fertilizer", "land_expansion_2"] },
        10: { experience: 2700, description: "丰收之王", unlocks: ["special_tools"] },
        100: { experience: 1500000, description: "无上农神", unlocks: ["supreme_badge"] }
      },
      rewards: {
        levelUp: {
          coins: 50,
          landSlots: 1
        }
      }
    }
  },
  land: {
    default: {
      startingLands: 6,
      maxLands: 24
    },
    expansion: {
      7: { levelRequired: 5, goldCost: 1000 },
      8: { levelRequired: 7, goldCost: 2000 }
    }
  },
  items: {
    inventory: {
      startingCapacity: 20,
      maxCapacity: 200
    },
    initial_gift: [
      { item_id: 'wheat_seed', quantity: 10 },
      { item_id: 'carrot_seed', quantity: 5 }
    ],
    dogFood: {
      normal: { defenseBonus: 20, duration: 30 },
      premium: { defenseBonus: 35, duration: 60 }
    }
  }
};

// 创建完整的测试玩家数据结构
function createTestPlayer(overrides = {}) {
  return {
    level: 1,
    experience: 0,
    coins: 100,
    landCount: 6,
    maxLandCount: 24,
    inventoryCapacity: 20,
    maxInventoryCapacity: 200,
    signIn: {
      lastSignDate: null,
      consecutiveDays: 0,
      totalSignDays: 0
    },
    protection: {
      dogFood: {
        type: null,
        effectEndTime: 0,
        defenseBonus: 0
      },
      farmProtection: {
        endTime: 0
      }
    },
    stealing: {
      lastStealTime: 0,
      cooldownEndTime: 0
    },
    statistics: {
      totalHarvested: 0,
      totalStolenFrom: 0,
      totalStolenBy: 0,
      totalMoneyEarned: 0,
      totalMoneySpent: 0
    },
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    lastActiveTime: Date.now(),
    ...overrides
  };
}

describe('PlayerService (PRD v3.2 Compliant)', () => {
  let playerService;
  let mockLogger;

  beforeEach(() => {
    // 重置所有mock
    jest.clearAllMocks();
    
    mockLogger = {
      info: jest.fn(),
      error: jest.fn()
    };
    
    playerService = new PlayerService(mockRedisClient, mockConfig, mockLogger);
    
    // 默认transaction行为
    mockRedisClient.transaction.mockImplementation(async (callback) => {
      return await callback({ set: jest.fn() });
    });
    
    mockRedisClient.serialize.mockImplementation((data) => JSON.stringify(data));
    mockRedisClient.generateKey.mockReturnValue('player:test_user');
  });

  describe('新玩家创建 (PRD Compliant)', () => {
    test('应该创建符合PRD规范的新玩家', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      
      const result = await playerService.getPlayer('test_user');
      
      expect(result).toMatchObject({
        level: 1,
        experience: 0,
        coins: 100,
        landCount: 6,
        maxLandCount: 24,
        inventoryCapacity: 20,
        maxInventoryCapacity: 200
      });
      
      // 验证签到系统初始化
      expect(result.signIn).toMatchObject({
        lastSignDate: null,
        consecutiveDays: 0,
        totalSignDays: 0
      });
      
      // 验证防御系统初始化
      expect(result.protection.dogFood).toMatchObject({
        type: null,
        effectEndTime: 0,
        defenseBonus: 0
      });
      
      // 验证统计系统初始化
      expect(result.statistics).toMatchObject({
        totalHarvested: 0,
        totalStolenFrom: 0,
        totalStolenBy: 0,
        totalMoneyEarned: 0,
        totalMoneySpent: 0
      });
    });

    test('应该记录初始礼包发放日志', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      
      await playerService.getPlayer('test_user');
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('为新玩家 test_user 准备初始礼包')
      );
    });
  });

  describe('金币管理系统', () => {
    test('应该正确添加金币并更新统计', async () => {
      const existingPlayer = createTestPlayer({
        level: 2,
        experience: 150,
        coins: 200,
        statistics: {
          totalHarvested: 0,
          totalStolenFrom: 0,
          totalStolenBy: 0,
          totalMoneyEarned: 50,
          totalMoneySpent: 30
        }
      });
      mockRedisClient.get.mockResolvedValue(existingPlayer);
      
      const result = await playerService.addCoins('test_user', 100);
      
      expect(result.coins).toBe(300);
      expect(result.statistics.totalMoneyEarned).toBe(150);
    });

    test('应该正确扣除金币并更新支出统计', async () => {
      const existingPlayer = createTestPlayer({
        level: 2,
        experience: 150,
        coins: 200,
        statistics: {
          totalHarvested: 0,
          totalStolenFrom: 0,
          totalStolenBy: 0,
          totalMoneyEarned: 50,
          totalMoneySpent: 30
        }
      });
      mockRedisClient.get.mockResolvedValue(existingPlayer);
      
      const result = await playerService.addCoins('test_user', -50);
      
      expect(result.coins).toBe(150);
      expect(result.statistics.totalMoneySpent).toBe(80);
    });

    test('应该防止金币变为负数', async () => {
      const existingPlayer = createTestPlayer({
        level: 2,
        experience: 150,
        coins: 200
      });
      mockRedisClient.get.mockResolvedValue(existingPlayer);
      
      const result = await playerService.addCoins('test_user', -300);
      
      expect(result.coins).toBe(0);
    });
  });

  describe('经验和升级系统', () => {
    test('应该正确添加经验值', async () => {
      const midLevelPlayer = createTestPlayer({
        level: 2,
        experience: 150,
        coins: 200,
        maxLandCount: 8
      });
      mockRedisClient.get.mockResolvedValue(midLevelPlayer);
      
      const result = await playerService.addExp('test_user', 50);
      
      expect(result.player.experience).toBe(200);
      expect(result.levelUp).toBeNull();
    });

    test('应该正确处理升级奖励', async () => {
      const midLevelPlayer = createTestPlayer({
        level: 2,
        experience: 150,
        coins: 200,
        maxLandCount: 8
      });
      mockRedisClient.get.mockResolvedValue(midLevelPlayer);
      
      const result = await playerService.addExp('test_user', 150); // 升到3级
      
      expect(result.player.level).toBe(3);
      expect(result.player.coins).toBe(250); // +50金币奖励
      expect(result.player.maxLandCount).toBe(9); // +1土地槽位
      expect(result.levelUp).toMatchObject({
        oldLevel: 2,
        newLevel: 3,
        rewards: {
          levelsGained: 1,
          totalCoins: 50,
          landSlots: 1
        }
      });
    });

    test('应该正确处理跨多级升级', async () => {
      const lowLevelPlayer = createTestPlayer({
        level: 2,
        experience: 50,
        coins: 200,
        maxLandCount: 8
      });
      mockRedisClient.get.mockResolvedValue(lowLevelPlayer);
      
      const result = await playerService.addExp('test_user', 500); // 从50经验升到550，应该升到4级
      
      expect(result.player.level).toBe(4);
      expect(result.player.coins).toBe(300); // +100金币 (2级奖励)
      expect(result.levelUp.rewards.levelsGained).toBe(2);
    });
  });

  describe('等级信息查询', () => {
    test('应该返回完整的等级信息', async () => {
      const player = createTestPlayer({
        level: 3,
        experience: 300,
        landCount: 8,
        maxLandCount: 10,
        inventoryCapacity: 30,
        maxInventoryCapacity: 200
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.getPlayerLevelInfo('test_user');
      
      expect(result).toMatchObject({
        currentLevel: 3,
        currentExp: 300,
        currentLevelDescription: "熟练农夫",
        nextLevelExp: 450,
        expToNextLevel: 150,
        maxLevel: 100,
        landCount: 8,
        maxLandCount: 10,
        inventoryCapacity: 30,
        maxInventoryCapacity: 200
      });
    });
  });

  describe('签到系统', () => {
    test('应该成功处理首次签到', async () => {
      const playerWithSignIn = createTestPlayer({
        level: 5,
        experience: 800,
        coins: 500
      });
      mockRedisClient.get.mockResolvedValue(playerWithSignIn);
      
      const result = await playerService.signIn('test_user');
      
      expect(result.success).toBe(true);
      expect(result.consecutiveDays).toBe(1);
      expect(result.rewards.coins).toBe(50);
      expect(result.rewards.experience).toBe(10);
    });

    test('应该正确计算连续签到奖励', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
      const consecutivePlayer = createTestPlayer({
        level: 5,
        experience: 800,
        coins: 500,
        signIn: {
          lastSignDate: yesterday,
          consecutiveDays: 6,
          totalSignDays: 10
        }
      });
      mockRedisClient.get.mockResolvedValue(consecutivePlayer);
      
      const result = await playerService.signIn('test_user');
      
      expect(result.consecutiveDays).toBe(7);
      expect(result.rewards.coins).toBe(75); // 1.5倍奖励
    });

    test('应该拒绝重复签到', async () => {
      const today = new Date().toDateString();
      const signedPlayer = createTestPlayer({
        level: 5,
        experience: 800,
        coins: 500,
        signIn: {
          lastSignDate: today,
          consecutiveDays: 1,
          totalSignDays: 1
        }
      });
      mockRedisClient.get.mockResolvedValue(signedPlayer);
      
      const result = await playerService.signIn('test_user');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('今日已经签到过了！');
    });
  });

  describe('狗粮防御系统', () => {
    test('应该正确设置狗粮防御效果', async () => {
      const player = createTestPlayer({
        level: 5,
        coins: 100
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.useDogFood('test_user', 'normal');
      
      expect(result.success).toBe(true);
      expect(result.defenseBonus).toBe(20);
      expect(result.durationMinutes).toBe(30);
    });

    test('应该拒绝未知的狗粮类型', async () => {
      const player = createTestPlayer({
        level: 5,
        coins: 100
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      await expect(
        playerService.useDogFood('test_user', 'unknown')
      ).rejects.toThrow('未知的狗粮类型: unknown');
    });
  });

  describe('防御状态查询', () => {
    test('应该正确返回防御状态', async () => {
      const now = Date.now();
      const player = createTestPlayer({
        protection: {
          dogFood: {
            type: 'normal',
            effectEndTime: now + 60000,
            defenseBonus: 20
          },
          farmProtection: {
            endTime: now + 120000
          }
        },
        stealing: {
          lastStealTime: now - 30000,
          cooldownEndTime: now + 30000
        }
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.getProtectionStatus('test_user');
      
      expect(result.dogFood.active).toBe(true);
      expect(result.dogFood.defenseBonus).toBe(20);
      expect(result.farmProtection.active).toBe(true);
      expect(result.stealCooldown.active).toBe(true);
    });
  });

  describe('土地扩张系统', () => {
    test('应该成功扩张土地', async () => {
      const player = createTestPlayer({
        level: 5,
        coins: 2000,
        landCount: 6,
        maxLandCount: 24
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.expandLand('test_user');
      
      expect(result.success).toBe(true);
      expect(result.landNumber).toBe(7);
      expect(result.costGold).toBe(1000);
      expect(result.currentLandCount).toBe(7);
      expect(result.remainingCoins).toBe(1000);
    });

    test('应该检查等级要求', async () => {
      const player = createTestPlayer({
        level: 3, // 需要5级
        coins: 2000,
        landCount: 6,
        maxLandCount: 24
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.expandLand('test_user');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('需要等级 5');
    });

    test('应该检查金币是否足够', async () => {
      const player = createTestPlayer({
        level: 5,
        coins: 500, // 需要1000金币
        landCount: 6,
        maxLandCount: 24
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.expandLand('test_user');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('金币不足');
    });
  });

  describe('统计数据管理', () => {
    test('应该正确更新统计数据', async () => {
      const player = createTestPlayer({
        statistics: {
          totalHarvested: 10,
          totalStolenFrom: 2,
          totalStolenBy: 5,
          totalMoneyEarned: 100,
          totalMoneySpent: 50
        }
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.updateStatistics('test_user', {
        harvested: 3,
        stolenFrom: 1,
        moneyEarned: 25
      });
      
      expect(result.statistics.totalHarvested).toBe(13);
      expect(result.statistics.totalStolenFrom).toBe(3);
      expect(result.statistics.totalMoneyEarned).toBe(125);
    });
  });

  describe('冷却和保护系统', () => {
    test('应该正确设置偷菜冷却', async () => {
      const player = createTestPlayer({
        level: 5
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.setStealCooldown('test_user', 10);
      
      expect(result.stealing.lastStealTime).toBeDefined();
      expect(result.stealing.cooldownEndTime).toBeGreaterThan(Date.now());
    });

    test('应该正确设置农场保护', async () => {
      const player = createTestPlayer({
        level: 5
      });
      mockRedisClient.get.mockResolvedValue(player);
      
      const result = await playerService.setFarmProtection('test_user', 30);
      
      expect(result.protection.farmProtection.endTime).toBeGreaterThan(Date.now());
    });
  });

  describe('错误处理', () => {
    test('应该正确处理Redis错误', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));
      
      await expect(
        playerService.getPlayer('test_user')
      ).rejects.toThrow('Redis connection failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('获取玩家数据失败')
      );
    });

    test('应该正确处理事务失败', async () => {
      mockRedisClient.get.mockResolvedValue(createTestPlayer({ level: 1, coins: 100 }));
      mockRedisClient.transaction.mockRejectedValue(new Error('Transaction failed'));
      
      await expect(
        playerService.addCoins('test_user', 50)
      ).rejects.toThrow('Transaction failed');
    });
  });
}); 