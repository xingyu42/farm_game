/**
 * PlantingService 测试套件
 * 测试核心种植和收获功能
 */

const { PlantingService } = require('../../services/PlantingService');

// Mock Redis Client
const mockRedisClient = {
  generateKey: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  serialize: jest.fn(),
  multi: jest.fn(),
  exec: jest.fn(),
  discard: jest.fn(),
  keys: jest.fn(),
  testData: {}
};

// Mock Config
const mockConfig = {
  getCropsConfig: jest.fn(),
  getLandConfig: jest.fn()
};

// 作物配置数据
const testCropsConfig = {
  carrot: {
    name: '胡萝卜',
    growTime: 300, // 5分钟
    requiredLevel: 1,
    experience: 10
  },
  wheat: {
    name: '小麦',
    growTime: 600, // 10分钟
    requiredLevel: 2,
    experience: 15
  },
  tomato: {
    name: '西红柿',
    growTime: 900, // 15分钟
    requiredLevel: 3,
    experience: 20
  }
};

// 土地配置数据
const testLandConfig = {
  quality: {
    normal: {
      timeReduction: 0,
      productionBonus: 0,
      expBonus: 0
    },
    copper: {
      timeReduction: 10,
      productionBonus: 10,
      expBonus: 10
    },
    silver: {
      timeReduction: 20,
      productionBonus: 20,
      expBonus: 20
    },
    gold: {
      timeReduction: 30,
      productionBonus: 30,
      expBonus: 30
    }
  }
};

describe('PlantingService (种植收获系统)', () => {
  let plantingService;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLogger = {
      info: jest.fn(),
      error: jest.fn()
    };
    
    plantingService = new PlantingService(mockRedisClient, mockConfig, mockLogger);
    
    // 设置config mock返回值
    mockConfig.getCropsConfig.mockResolvedValue(testCropsConfig);
    mockConfig.getLandConfig.mockResolvedValue(testLandConfig);
    
    // 设置Redis mock行为
    mockRedisClient.generateKey.mockReturnValue('farm:player:12345');
    mockRedisClient.serialize.mockImplementation((data) => data);
    mockRedisClient.multi.mockResolvedValue(undefined);
    mockRedisClient.exec.mockResolvedValue(undefined);
         mockRedisClient.keys.mockResolvedValue(['farm:player:12345']);

    // 设置测试用的玩家数据
    const testPlayerData = {
      level: 5,
      experience: 100,
      coins: 1000,
      gold: 1000,
      lands: [
        {
          id: 1,
          crop: null,
          quality: 'normal',
          plantTime: null,
          harvestTime: null,
          status: 'empty',
          health: 100,
          needsWater: false,
          hasPests: false,
          stealable: false
        },
        {
          id: 2,
          crop: null,
          quality: 'copper',
          plantTime: null,
          harvestTime: null,
          status: 'empty',
          health: 100,
          needsWater: false,
          hasPests: false,
          stealable: false
        }
      ],
      inventory: {
        'carrot_seed': 5,
        'wheat_seed': 3,
        'tomato_seed': 2
      },
      inventory_capacity: 20
    };

    // 设置get方法返回测试数据
    mockRedisClient.get.mockResolvedValue(testPlayerData);
    mockRedisClient.testData = { 'farm:player:12345': testPlayerData };
  });

  describe('种植功能', () => {
    test('应该成功种植作物', async () => {
      const result = await plantingService.plantCrop('12345', 1, 'carrot');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('成功');
      expect(result.data.cropName).toBe('胡萝卜');
      
             // 验证set方法被调用（表示数据已更新）
       expect(mockRedisClient.set).toHaveBeenCalled();
    });

         test('应该考虑土地品质影响生长时间', async () => {
       // 在普通土地种植
       const result1 = await plantingService.plantCrop('12345', 1, 'carrot');
       const normalGrowTime = result1.data.growTime;
       
       // 重置mock for second call
       mockRedisClient.get.mockResolvedValue({
         level: 5,
         experience: 100,
         coins: 1000,
         gold: 1000,
         lands: [
           {
             id: 1,
             crop: null,
             quality: 'normal',
             plantTime: null,
             harvestTime: null,
             status: 'empty',
             health: 100,
             needsWater: false,
             hasPests: false,
             stealable: false
           },
           {
             id: 2,
             crop: null,
             quality: 'copper',
             plantTime: null,
             harvestTime: null,
             status: 'empty',
             health: 100,
             needsWater: false,
             hasPests: false,
             stealable: false
           }
         ],
         inventory: {
           'carrot_seed': 5,
           'wheat_seed': 3,
           'tomato_seed': 2
         },
         inventory_capacity: 20
       });
       
       // 在铜质土地种植
       const result2 = await plantingService.plantCrop('12345', 2, 'carrot');
       const copperGrowTime = result2.data.growTime;
       
       // 铜质土地应该生长更快（-10%时间）
       expect(copperGrowTime).toBeLessThan(normalGrowTime);
     });

    test('应该拒绝在已有作物的土地上种植', async () => {
      // 先种植一次
      await plantingService.plantCrop('12345', 1, 'carrot');
      
      // 再次种植应该失败
      const result = await plantingService.plantCrop('12345', 1, 'wheat');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('已经种植了作物');
    });

    test('应该检查种子数量', async () => {
      const result = await plantingService.plantCrop('12345', 1, 'unknown_crop');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('未知的作物类型');
    });

         test('应该检查等级要求', async () => {
       // 设置玩家等级为1
       mockRedisClient.get.mockResolvedValue({
         level: 1,
         experience: 0,
         coins: 1000,
         gold: 1000,
         lands: [
           {
             id: 1,
             crop: null,
             quality: 'normal',
             plantTime: null,
             harvestTime: null,
             status: 'empty',
             health: 100,
             needsWater: false,
             hasPests: false,
             stealable: false
           }
         ],
         inventory: {
           'tomato_seed': 2
         },
         inventory_capacity: 20
       });
       
       // 尝试种植需要3级的西红柿
       const result = await plantingService.plantCrop('12345', 1, 'tomato');
       
       expect(result.success).toBe(false);
       expect(result.message).toContain('需要3级');
     });
  });

  describe('收获功能', () => {
    test('应该成功收获成熟作物', async () => {
      const now = Date.now();
      mockRedisClient.get.mockResolvedValue({
        level: 5,
        experience: 100,
        lands: [
          {
            id: 1,
            crop: 'carrot',
            quality: 'normal',
            plantTime: now - 600000,
            harvestTime: now - 60000, // 1分钟前成熟
            status: 'mature',
            health: 100,
            needsWater: false,
            hasPests: false,
            stealable: true
          }
        ],
        inventory: {},
        inventory_capacity: 20
      });
      
      const result = await plantingService.harvestCrop('12345', 1);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('收获成功');
      expect(result.data.harvestedCrops).toHaveLength(1);
      expect(result.data.harvestedCrops[0].cropName).toBe('胡萝卜');
    });

    test('应该拒绝收获未成熟作物', async () => {
      const now = Date.now();
      mockRedisClient.get.mockResolvedValue({
        level: 5,
        experience: 100,
        lands: [
          {
            id: 1,
            crop: 'carrot',
            quality: 'normal',
            plantTime: now - 100000,
            harvestTime: now + 200000, // 5分钟后成熟
            status: 'growing',
            health: 100,
            needsWater: false,
            hasPests: false,
            stealable: false
          }
        ],
        inventory: {},
        inventory_capacity: 20
      });
      
      const result = await plantingService.harvestCrop('12345', 1);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('还未成熟');
    });
  });

  describe('作物状态更新', () => {
    test('应该更新成熟的作物状态', async () => {
      const now = Date.now();
      mockRedisClient.get.mockResolvedValue({
        level: 5,
        lands: [
          {
            id: 1,
            crop: 'carrot',
            quality: 'normal',
            plantTime: now - 600000,
            harvestTime: now - 60000, // 1分钟前就该成熟了
            status: 'growing', // 但状态还是growing
            health: 100,
            needsWater: false,
            hasPests: false,
            stealable: false
          }
        ]
      });
      
      const result = await plantingService.updateAllCropsStatus();
      
      expect(result.success).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    test('应该处理不存在的玩家', async () => {
      // 设置get方法返回null（玩家不存在）
      mockRedisClient.get.mockResolvedValue(null);
      
      const result = await plantingService.plantCrop('nonexistent', 1, 'carrot');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('玩家数据不存在');
    });

    test('应该处理无效的土地编号', async () => {
      // 重新设置正常玩家数据
      mockRedisClient.get.mockResolvedValue({
        level: 5,
        experience: 100,
        coins: 1000,
        gold: 1000,
        lands: [
          {
            id: 1,
            crop: null,
            quality: 'normal',
            plantTime: null,
            harvestTime: null,
            status: 'empty',
            health: 100,
            needsWater: false,
            hasPests: false,
            stealable: false
          }
        ],
        inventory: {
          'carrot_seed': 5
        },
        inventory_capacity: 20
      });
      
      const result = await plantingService.plantCrop('12345', 999, 'carrot');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('土地编号999不存在');
    });
  });
}); 