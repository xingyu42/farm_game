/**
 * 服务依赖注入的中央入口
 * 所有业务服务将在这里实例化和导出
 */

// 导入配置和通用工具
const Config = require('../models/Config');
const redisClient = require('../common/redisClient');

// 导入业务服务
const PlayerService = require('./PlayerService');
const { PlantingService } = require('./PlantingService');
const { InventoryService } = require('./InventoryService');
const { ShopService } = require('./ShopService');
const { LandService } = require('./LandService');

class ServiceContainer {
  constructor() {
    this.services = {};
    this.initialized = false;
  }

  /**
   * 初始化所有服务
   * @param {Object} config 配置对象
   */
  async init(config = null) {
    if (this.initialized) {
      return;
    }

    // 如果没有传入配置，使用默认配置
    if (!config) {
      config = Config;
    }

    // 初始化Redis客户端
    await redisClient.init(config.redis || {});

    // 实例化PlayerService
    this.services.playerService = new PlayerService(redisClient, config);

    // 实例化PlantingService
    this.services.plantingService = new PlantingService(redisClient, config);

    // 实例化InventoryService
    this.services.inventoryService = new InventoryService(redisClient, config);

    // 实例化ShopService (需要依赖InventoryService和PlayerService)
    this.services.shopService = new ShopService(
      redisClient, 
      config, 
      this.services.inventoryService, 
      this.services.playerService
    );

    // 实例化LandService (需要依赖PlayerService)
    this.services.landService = new LandService(
      redisClient, 
      config, 
      this.services.playerService
    );

    // TODO: 在后续任务中，这里将依次实例化其他服务
    // this.services.timeService = new TimeService(redisClient, config);

    this.initialized = true;
  }

  /**
   * 获取指定服务
   * @param {string} serviceName 服务名称
   * @returns {Object} 服务实例
   */
  getService(serviceName) {
    if (!this.initialized) {
      throw new Error('Service container not initialized. Call init() first.');
    }

    const service = this.services[serviceName];
    if (!service) {
      throw new Error(`Service '${serviceName}' not found`);
    }

    return service;
  }

  /**
   * 获取所有服务
   * @returns {Object} 所有服务的对象
   */
  getAllServices() {
    if (!this.initialized) {
      throw new Error('Service container not initialized. Call init() first.');
    }

    return { ...this.services };
  }

  /**
   * 关闭所有服务和连接
   */
  async shutdown() {
    // 关闭Redis连接
    await redisClient.close();

    // 清理服务
    this.services = {};
    this.initialized = false;
  }
}

// 导出单例实例
const serviceContainer = new ServiceContainer();

module.exports = serviceContainer; 