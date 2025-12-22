/**
 * @fileoverview 服务依赖注入容器 - 中央服务管理器
 *
 * Input:
 * - ../models/Config.js - 配置管理器
 * - ../utils/redisClient.js - Redis客户端
 * - ../utils/CommonUtils.js - 通用工具类
 * - ../utils/ItemResolver.js - 物品解析器
 * - ./player/* - 玩家相关服务集合
 * - ./planting/* - 种植相关服务集合
 * - ./market/* - 市场相关服务集合
 * - ./admin/* - 管理员服务集合
 * - ./system/* - 系统服务集合
 *
 * Output:
 * - ServiceContainer - 服务容器单例 (提供所有业务服务的访问接口)
 *
 * Pos: 服务层核心,实现依赖注入模式,按拓扑顺序初始化所有业务服务并解决循环依赖
 *
 * 服务初始化顺序 (拓扑排序):
 * 1. Config, CommonUtils, ItemResolver (基础工具)
 * 2. PlayerService (核心依赖)
 * 3. AdminService, GlobalStatsService, PlayerStatsService, EconomyService (独立服务)
 * 4. InventoryService, LandService (依赖 PlayerService)
 * 5. PlantingDataService, PlantingService (依赖 InventoryService + LandService)
 * 6. ShopService (依赖 InventoryService + PlayerService)
 * 7. ProtectionService (注入回 PlayerService - 解决循环依赖)
 * 8. StealService (依赖多个服务)
 * 9. MarketService, MarketScheduler (市场子系统)
 * 10. DataBackupService (数据备份)
 */

// 导入配置和通用工具
import Config from '../models/Config.js';
import redisClient from '../utils/redisClient.js';

// 导入新的工具类
import { CommonUtils } from '../utils/CommonUtils.js';

// 导入业务服务
import PlayerService from './player/PlayerService.js';
import AdminService from './admin/AdminService.js';
import GlobalStatsService from './admin/GlobalStatsService.js'; // 全局统计服务
import PlayerStatsService from './player/PlayerStatsService.js'; // 玩家个人统计服务
import EconomyService from './player/EconomyService.js'; // 经济服务
import PlantingService from './planting/PlantingService.js';
import InventoryService from './player/InventoryService.js';
import ShopService from './player/ShopService.js';
import LandService from './player/LandService.js';
import ProtectionService from './player/ProtectionService.js';
import StealService from './player/StealService.js';
import PlantingDataService from './planting/PlantingDataService.js';
import DataBackupService from './system/DataBackupService.js';
import { MarketService } from './market/MarketService.js';
import { MarketScheduler } from './market/MarketScheduler.js';
import { PriceCalculator } from './market/PriceCalculator.js';
import { MarketDataManager } from './market/MarketDataManager.js';
import { TransactionManager } from './market/TransactionManager.js';
import ItemResolver from '../utils/ItemResolver.js';

class ServiceContainer {
  constructor() {
    this.services = {};
    this.initialized = false;
  }

  /**
   * 初始化所有服务（增强版本）
   * @param {Object} config 配置对象
   */
  async init(config) {
    if (this.initialized) {
      return;
    }

    try {
      // 如果没有传入配置，使用默认配置
      if (!config) {
        config = Config;
      }


      logger.info('开始初始化服务容器...');

      // 注册配置服务
      this.services.config = config;

      // 注册工具类服务
      this.services.commonUtils = CommonUtils;

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

      // 实例化GlobalStatsService（独立服务，无特殊依赖）
      this.services.globalStatsService = new GlobalStatsService(
        redisClient,
        null // logger使用默认值
      );

      // 实例化PlayerStatsService
      this.services.playerStatsService = new PlayerStatsService(
        redisClient,
        config,
        null // logger使用默认值
      );

      // 实例化EconomyService
      this.services.economyService = new EconomyService(
        redisClient,
        config
      );

      // 实例化InventoryService
      this.services.inventoryService = new InventoryService(
        redisClient,
        config,
        null, // logger使用默认值
        this.services.playerService.dataService, // 注入playerDataService
        this.services.economyService // 注入economyService
      );

      // 实例化LandService（事务实现层；可选注入 PlayerService 供旧代码访问）
      this.services.landService = new LandService(
        redisClient,
        config,
        this.services.playerService
      );

      // 实例化PlantingDataService（种植模块的数据访问层）
      this.services.plantingDataService = new PlantingDataService(
        redisClient,
        config,
        null, // logger使用默认值
        this.services.playerService.dataService // 注入playerDataService
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

      // 实例化ShopService (需要依赖InventoryService、PlayerService和ServiceContainer)
      this.services.shopService = new ShopService(
        redisClient,
        config,
        this.services.inventoryService,
        this.services.playerService,
        this, // 传入ServiceContainer实例
        null // logger使用默认值
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

      // 将 ServiceContainer 注入到 PlayerService，用于获取 LandService 单例
      if (this.services.playerService?.setServiceContainer) {
        this.services.playerService.setServiceContainer(this);
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
      );

      // 实例化市场专门服务（新架构）
      this.services.priceCalculator = new PriceCalculator(config);

      this.services.marketDataManager = new MarketDataManager(
        redisClient,
        config
      );

      this.services.transactionManager = new TransactionManager(
        redisClient,
        config
      );

      // 实例化MarketService（重构版本，Facade模式）
      this.services.marketService = new MarketService(
        redisClient,
        config,
        this.services.playerService,
        this.services.priceCalculator,
        this.services.marketDataManager,
        this.services.transactionManager
      );

      // 实例化MarketScheduler（增强版本，带Redis分布式锁保护）
      this.services.marketScheduler = new MarketScheduler(
        this.services.marketService,
        redisClient,
        config,
      );

      this.initialized = true;
      logger.info('服务容器初始化完成');

      // 初始化市场数据
      if (this.services.marketService) {
        try {
          await this.services.marketService.initializeMarketData();
        } catch (error) {
          logger.error('市场数据初始化失败', { error: error.message });
        }
      }

      // 启动备份服务
      if (this.services.dataBackupService) {
        try {
          await this.services.dataBackupService.start();
          logger.info('数据备份服务已启动');
        } catch (error) {
          logger.error('数据备份服务启动失败', { error: error.message });
        }
      }

      // 启动市场定时任务（增强版本）
      if (this.services.marketScheduler) {
        try {
          await this.services.marketScheduler.start();
          logger.info('市场任务调度器已启动');
        } catch (error) {
          logger.error('市场任务调度器启动失败', { error: error.message });
        }
      }

      logger.info('所有服务和任务已启动完毕');

    } catch (error) {
      logger.error('服务容器初始化失败', { error: error.message, stack: error.stack });
      throw error;
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
    // 持久化市场数据到 JSON 文件
    if (this.services.marketDataManager) {
      try {
        await this.services.marketDataManager.persistToFile();
        logger.info('市场数据已持久化');
      } catch (error) {
        logger.error('市场数据持久化失败', { error: error.message });
      }
    }

    // 停止备份服务
    if (this.services.dataBackupService) {
      await this.services.dataBackupService.stop();
    }

    // 停止市场定时任务
    if (this.services.marketScheduler) {
      this.services.marketScheduler.stop();
    }

    // 清理服务
    this.services = {};
    this.initialized = false;
  }
}

// 导出单例实例
const serviceContainer = new ServiceContainer();

// ================== Docker友好的优雅关闭信号处理 ==================

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;  // 优雅关闭最大等待时间（10秒）
let shuttingDown = false;

/**
 * 处理进程退出信号（SIGINT / SIGTERM）
 *
 * Docker容器停止时会发送SIGTERM，本地Ctrl+C发送SIGINT。
 * 给予10秒时间完成数据持久化，超时则强制退出。
 *
 * @param {string} signal 信号名称
 */
async function handleSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info(`[ServiceContainer] 收到退出信号: ${signal}，开始优雅关闭...`);

  // 设置超时保护：10秒后强制退出
  const timeout = setTimeout(() => {
    logger.warn(`[ServiceContainer] 优雅关闭超时（${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms），强制退出`);
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

  // unref() 允许进程在定时器未触发时退出
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  try {
    await serviceContainer.shutdown();
    clearTimeout(timeout);
    logger.info('[ServiceContainer] 优雅关闭完成，安全退出');
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    logger.error(`[ServiceContainer] 优雅关闭失败: ${error.message}`);
    process.exit(1);
  }
}

// 注册信号监听器
if (typeof process !== 'undefined' && process.on) {
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => {
      handleSignal(signal);
    });
  });
}

export default serviceContainer;