/**
 * MockServiceContainer - 服务容器的Mock实现
 * 提供测试环境下的服务依赖注入和管理
 */

import { MockRedisClient } from './MockRedisClient.js';

export class MockServiceContainer {
  constructor() {
    this.services = new Map();
    this.mockRedis = new MockRedisClient();
    this.initialized = false;
    this.mockConfig = this._createMockConfig();
    this._serviceOrder = []; // 记录服务初始化顺序
  }

  /**
   * 初始化所有Mock服务
   */
  async init() {
    if (this.initialized) {
      return;
    }

    try {
      // 连接Mock Redis
      await this.mockRedis.connect();
      
      // 按依赖顺序初始化服务
      await this._initBasicServices();
      await this._initBusinessServices();
      await this._initAdvancedServices();
      
      // 处理循环依赖
      await this._resolveCyclicDependencies();
      
      this.initialized = true;
      console.log('✅ MockServiceContainer初始化完成');
    } catch (error) {
      console.error('❌ MockServiceContainer初始化失败:', error);
      throw error;
    }
  }

  /**
   * 获取服务实例
   */
  getService(serviceName) {
    if (!this.initialized) {
      throw new Error('服务容器尚未初始化，请先调用init()方法');
    }
    
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`服务 '${serviceName}' 不存在`);
    }
    
    return service;
  }

  /**
   * 获取Mock Redis客户端
   */
  getMockRedis() {
    return this.mockRedis;
  }

  /**
   * 获取Mock配置
   */
  getMockConfig() {
    return this.mockConfig;
  }

  /**
   * 重置所有服务和数据
   */
  async reset() {
    // 清理所有服务状态
    for (const [name, service] of this.services) {
      if (typeof service.reset === 'function') {
        await service.reset();
      }
    }
    
    // 清空Redis数据
    await this.mockRedis.flushAll();
    
    console.log('🔄 MockServiceContainer已重置');
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.mockRedis) {
      await this.mockRedis.disconnect();
    }
    
    this.services.clear();
    this.initialized = false;
    console.log('🧹 MockServiceContainer已清理');
  }

  /**
   * 注册Mock服务
   */
  registerService(name, service) {
    this.services.set(name, service);
    this._serviceOrder.push(name);
  }

  /**
   * 获取服务初始化顺序
   */
  getServiceOrder() {
    return [...this._serviceOrder];
  }

  /**
   * 模拟服务故障
   */
  simulateServiceFailure(serviceName, errorType = 'generic') {
    const service = this.services.get(serviceName);
    if (service) {
      service._simulatedError = errorType;
    }
  }

  /**
   * 恢复服务正常状态
   */
  recoverService(serviceName) {
    const service = this.services.get(serviceName);
    if (service) {
      delete service._simulatedError;
    }
  }

  // ===========================================
  // 私有方法 - 服务初始化
  // ===========================================

  /**
   * 初始化基础服务
   */
  async _initBasicServices() {
    // 初始化PlayerService
    const PlayerService = (await import('../../../services/player/PlayerService.js')).default;
    const playerService = new PlayerService(this.mockRedis, this.mockConfig);
    await this._wrapServiceWithMocks(playerService, 'PlayerService');
    this.registerService('playerService', playerService);

    // 初始化InventoryService
    const InventoryService = (await import('../../../services/player/InventoryService.js')).default;
    const inventoryService = new InventoryService(this.mockRedis, this.mockConfig);
    await this._wrapServiceWithMocks(inventoryService, 'InventoryService');
    this.registerService('inventoryService', inventoryService);

    // 初始化LandService
    const LandService = (await import('../../../services/player/LandService.js')).default;
    const landService = new LandService(this.mockRedis, this.mockConfig);
    await this._wrapServiceWithMocks(landService, 'LandService');
    this.registerService('landService', landService);

    console.log('📦 基础服务初始化完成');
  }

  /**
   * 初始化业务服务
   */
  async _initBusinessServices() {
    // 获取已初始化的基础服务
    const playerService = this.getService('playerService');
    const inventoryService = this.getService('inventoryService');
    const landService = this.getService('landService');

    // 初始化PlantingService
    const PlantingService = (await import('../../../services/planting/PlantingService.js')).default;
    const plantingService = new PlantingService(
      this.mockRedis,
      this.mockConfig,
      null, // PlantingDataService
      inventoryService,
      landService,
      playerService
    );
    await this._wrapServiceWithMocks(plantingService, 'PlantingService');
    this.registerService('plantingService', plantingService);

    // 初始化ShopService
    const { ShopService } = await import('../../../services/shop/ShopService.js');
    const shopService = new ShopService(
      this.mockRedis,
      this.mockConfig,
      playerService,
      inventoryService
    );
    await this._wrapServiceWithMocks(shopService, 'ShopService');
    this.registerService('shopService', shopService);

    console.log('🏪 业务服务初始化完成');
  }

  /**
   * 初始化高级服务
   */
  async _initAdvancedServices() {
    const playerService = this.getService('playerService');
    const inventoryService = this.getService('inventoryService');

    // 初始化StealService
    const { StealService } = await import('../../../services/steal/StealService.js');
    const stealService = new StealService(
      this.mockRedis,
      this.mockConfig,
      playerService,
      inventoryService
    );
    await this._wrapServiceWithMocks(stealService, 'StealService');
    this.registerService('stealService', stealService);

    // 初始化MarketService
    const { MarketService } = await import('../../../services/market/MarketService.js');
    const marketService = new MarketService(
      this.mockRedis,
      this.mockConfig,
      playerService,
      inventoryService
    );
    await this._wrapServiceWithMocks(marketService, 'MarketService');
    this.registerService('marketService', marketService);

    console.log('🎯 高级服务初始化完成');
  }

  /**
   * 解决循环依赖
   */
  async _resolveCyclicDependencies() {
    // 获取相关服务
    const playerService = this.getService('playerService');
    const stealService = this.getService('stealService');

    // 如果存在ProtectionService，需要处理循环依赖
    try {
      const { ProtectionService } = await import('../../../services/protection/ProtectionService.js');
      const protectionService = new ProtectionService(
        this.mockRedis,
        this.mockConfig,
        playerService
      );
      await this._wrapServiceWithMocks(protectionService, 'ProtectionService');
      this.registerService('protectionService', protectionService);

      // 设置循环依赖
      if (typeof playerService.setProtectionService === 'function') {
        playerService.setProtectionService(protectionService);
      }
      if (typeof stealService.setProtectionService === 'function') {
        stealService.setProtectionService(protectionService);
      }

      console.log('🔄 循环依赖解决完成');
    } catch (error) {
      console.warn('⚠️ ProtectionService不存在，跳过循环依赖处理');
    }
  }

  /**
   * 为服务包装Mock功能
   */
  async _wrapServiceWithMocks(service, serviceName) {
    // 添加模拟错误功能
    const originalMethods = {};
    
    // 获取服务的所有方法
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
      .filter(name => name !== 'constructor' && typeof service[name] === 'function');

    for (const methodName of methods) {
      originalMethods[methodName] = service[methodName];
      
      // 包装方法以支持错误模拟
      service[methodName] = async function(...args) {
        // 检查是否需要模拟错误
        if (service._simulatedError) {
          const error = new Error(`模拟${serviceName}.${methodName}错误: ${service._simulatedError}`);
          error.code = service._simulatedError;
          throw error;
        }
        
        // 调用原始方法
        return await originalMethods[methodName].apply(this, args);
      };
    }

    // 添加重置方法
    service.reset = async function() {
      // 子类可以重写此方法来实现特定的重置逻辑
      console.log(`🔄 ${serviceName} 已重置`);
    };

    // 添加测试辅助方法
    service.getCallHistory = function() {
      return service._callHistory || [];
    };

    service.clearCallHistory = function() {
      service._callHistory = [];
    };

    // 初始化调用历史
    service._callHistory = [];
  }

  /**
   * 创建Mock配置
   */
  _createMockConfig() {
    return {
      // 游戏基础配置
      game: {
        maxLevel: 100,
        initialMoney: 1000,
        initialEnergy: 100,
        energyRecoveryRate: 1, // 每分钟恢复1点体力
        maxLands: 10
      },

      // 作物配置
      crops: {
        wheat: {
          id: 'wheat',
          name: '小麦',
          price: 10,
          sellPrice: 15,
          growTime: 300000, // 5分钟
          experience: 5,
          level: 1
        },
        corn: {
          id: 'corn',
          name: '玉米',
          price: 20,
          sellPrice: 30,
          growTime: 600000, // 10分钟
          experience: 10,
          level: 5
        },
        tomato: {
          id: 'tomato',
          name: '番茄',
          price: 30,
          sellPrice: 50,
          growTime: 900000, // 15分钟
          experience: 15,
          level: 10
        }
      },

      // 商店配置
      shop: {
        seeds: {
          wheat: { price: 10, level: 1 },
          corn: { price: 20, level: 5 },
          tomato: { price: 30, level: 10 }
        },
        tools: {
          fertilizer: { price: 50, effect: 'speed', level: 3 },
          pesticide: { price: 100, effect: 'yield', level: 8 }
        }
      },

      // 偷菜配置
      steal: {
        cooldown: 3600000, // 1小时冷却
        maxDistance: 5, // 最大偷菜距离
        successRate: 0.7, // 成功率70%
        maxStealAmount: 0.3 // 最多偷取30%
      },

      // 市场配置
      market: {
        priceFluctuationRange: 0.2, // 价格波动范围20%
        updateInterval: 300000, // 5分钟更新一次价格
        taxRate: 0.05 // 5%手续费
      },

      // Redis配置
      redis: {
        keyPrefix: 'farm_game_test:',
        lockTimeout: 30000,
        dataExpiration: 86400000 // 24小时
      },

      // 测试专用配置
      test: {
        fastMode: true, // 加速模式，缩短等待时间
        mockTime: true, // 模拟时间流逝
        verboseLogging: false // 详细日志
      }
    };
  }
}