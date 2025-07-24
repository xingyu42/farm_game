/**
 * 服务依赖注入的中央入口
 * 所有业务服务将在这里实例化和导出
 */

// 导入配置和通用工具
import Config from '../models/Config.js';
import redisClient from '../utils/redisClient.js';

// 导入业务服务
import PlayerService from './player/PlayerService.js';
import AdminService from './AdminService.js';
import StatisticsService from './StatisticsService.js';
import PlantingService from './PlantingService.js';
import InventoryService from './InventoryService.js';
import ShopService from './ShopService.js';
import LandService from './LandService.js';
import ProtectionService from './ProtectionService.js';
import StealService from './StealService.js';
import PlantingDataService from './planting/PlantingDataService.js';
import DataBackupService from './DataBackupService.js';
import ItemResolver from '../utils/ItemResolver.js';

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

    // 实例化ItemResolver（通用工具服务）
    this.services.itemResolver = new ItemResolver(config);

    // 实例化PlayerService（新的统一玩家服务）
    this.services.playerService = new PlayerService(redisClient, config);

    // 实例化AdminService（依赖PlayerService）
    this.services.adminService = new AdminService(
      redisClient,
      config,
      this.services.playerService, // 依赖PlayerService
      null // logger使用默认值
    );

    // 实例化StatisticsService（独立服务，无特殊依赖）
    this.services.statisticsService = new StatisticsService(
      redisClient,
      null // logger使用默认值
    );

    // 实例化InventoryService
    this.services.inventoryService = new InventoryService(redisClient, config);

    // 实例化LandService (需要依赖PlayerService)
    this.services.landService = new LandService(
      redisClient,
      config,
      this.services.playerService
    );

    // 实例化PlantingDataService（种植模块的数据访问层）
    this.services.plantingDataService = new PlantingDataService(
      redisClient,
      config,
      null // logger使用默认值
    );

    // 实例化PlantingService（需要依赖多个服务）
    this.services.plantingService = new PlantingService(
      redisClient,
      config,
      this.services.plantingDataService,
      this.services.inventoryService,
      this.services.landService,
      this.services.playerService,
      null // logger 使用默认值
    );

    // 实例化ShopService (需要依赖InventoryService和PlayerService)
    this.services.shopService = new ShopService(
      redisClient,
      config,
      this.services.inventoryService,
      this.services.playerService
    );

    // 实例化ProtectionService (需要依赖PlayerService)
    this.services.protectionService = new ProtectionService(
      redisClient,
      config,
      this.services.playerService,
      null // logger 使用默认值
    );

    // 将 ProtectionService 注入到 PlayerService，解决循环依赖
    if (this.services.playerService?.setProtectionService) {
      this.services.playerService.setProtectionService(this.services.protectionService);
    }

    // 实例化StealService (需要依赖多个服务)
    this.services.stealService = new StealService(
      redisClient,
      config,
      this.services.playerService,
      this.services.inventoryService,
      this.services.protectionService,
      this.services.landService,
      null // logger 使用默认值
    );

    // 实例化DataBackupService (数据备份服务)
    this.services.dataBackupService = new DataBackupService(
      redisClient,
      config,
      this.services.playerService,
      null // logger 使用默认值
    );

    this.initialized = true;

    // 启动备份服务
    if (this.services.dataBackupService) {
      await this.services.dataBackupService.start();
    }
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
   * 关闭所有服务
   */
  async shutdown() {
    // 停止备份服务
    if (this.services.dataBackupService) {
      await this.services.dataBackupService.stop();
    }

    // 清理服务
    this.services = {};
    this.initialized = false;
  }
}

// 导出单例实例
const serviceContainer = new ServiceContainer();
export default serviceContainer;