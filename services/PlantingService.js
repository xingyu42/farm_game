/**
 * 种植服务 - 管理作物种植、生长和收获（门面模式）
 * 基于PRD v3.2设计，实现核心的种植收获循环
 * 重构为门面模式，委托给专门的服务处理，保持接口兼容性
 */

import { CropPlantingService } from './planting/CropPlantingService.js';
import { CropHarvestService } from './planting/CropHarvestService.js';
import { CropCareService } from './planting/CropCareService.js';
import { CropStatusService } from './planting/CropStatusService.js';
import { CropScheduleService } from './planting/CropScheduleService.js';

class PlantingService {
  constructor(redisClient, config, logger = null, playerDataService = null) {
    this.redis = redisClient;
    this.config = config;
    this.logger = logger || console;
    this.playerDataService = playerDataService;

    // 初始化专门服务
    this._initializeServices();
  }

  /**
   * 初始化所有专门服务
   * @private
   */
  _initializeServices() {
    // 初始化调度管理服务
    this.cropScheduleService = new CropScheduleService(this.redis, this.logger);

    // 初始化专门服务
    this.cropPlantingService = new CropPlantingService(
      this.playerDataService,
      this.cropScheduleService,
      this.config,
      this.logger
    );

    this.cropHarvestService = new CropHarvestService(
      this.playerDataService,
      this.cropScheduleService,
      this.config,
      this.logger
    );

    this.cropCareService = new CropCareService(
      this.playerDataService,
      this.cropScheduleService,
      this.config,
      this.logger
    );

    this.cropStatusService = new CropStatusService(
      this.playerDataService,
      this.cropScheduleService,
      this.redis,
      this.config,
      this.logger
    );
  }

  /**
   * 种植作物
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @returns {Object} 种植结果
   */
  async plantCrop(userId, landId, cropType) {
    // 委托给专门的种植服务
    return await this.cropPlantingService.plantCrop(userId, landId, cropType);
  }



  /**
   * 收获作物
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号（可选，为空时收获所有成熟作物）
   * @returns {Object} 收获结果
   */
  async harvestCrop(userId, landId = null) {
    // 委托给专门的收获服务
    return await this.cropHarvestService.harvestCrop(userId, landId);
  }



  /**
   * 更新所有玩家的作物状态（定时任务调用）
   * @returns {Object} 更新结果
   */
  async updateAllCropsStatus() {
    // 委托给专门的状态更新服务
    return await this.cropStatusService.updateAllCropsStatus();
  }



  /**
   * 浇水护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 浇水结果
   */
  async waterCrop(userId, landId) {
    // 委托给专门的护理服务
    return await this.cropCareService.waterCrop(userId, landId);
  }

  /**
   * 施肥护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} fertilizerType 肥料类型（可选，默认使用最好的）
   * @returns {Object} 施肥结果
   */
  async fertilizeCrop(userId, landId, fertilizerType = null) {
    // 委托给专门的护理服务
    return await this.cropCareService.fertilizeCrop(userId, landId, fertilizerType);
  }

  /**
   * 除虫护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 除虫结果
   */
  async pesticideCrop(userId, landId) {
    // 委托给专门的护理服务
    return await this.cropCareService.pesticideCrop(userId, landId);
  }


}

export { PlantingService };