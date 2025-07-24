/**
 * 种植服务 - 管理作物种植、生长和收获（门面模式）
 * 基于PRD v3.2设计，实现核心的种植收获循环
 * 重构为门面模式，委托给专门的服务处理，保持接口兼容性
 */

import CropPlantingService from './planting/CropPlantingService.js';
import CropHarvestService from './planting/CropHarvestService.js';
import CropCareService from './planting/CropCareService.js';
import CropMonitorService from './planting/CropMonitorService.js';

class PlantingService {
  constructor(redisClient, config, plantingDataService, inventoryService, landService, playerService, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this._plantingDataService = plantingDataService;
    this.inventoryService = inventoryService;
    this.landService = landService;
    this.playerService = playerService;
    this.logger = logger || console;

    // 初始化专门服务
    this._initializeServices();
  }

  /**
   * 初始化所有专门服务
   * @private
   */
  _initializeServices() {
    // 初始化监控服务（合并了状态和调度功能）
    this._cropMonitorService = new CropMonitorService(
      this._plantingDataService,
      this.landService,
      this.redis,
      this.config,
      this.logger
    );

    // 初始化专门服务，注入新的依赖
    this._cropPlantingService = new CropPlantingService(
      this._plantingDataService,
      this.inventoryService,
      this.landService,
      this._cropMonitorService,
      this.config,
      this.logger
    );

    this._cropHarvestService = new CropHarvestService(
      this._plantingDataService,
      this.inventoryService,
      this.landService,
      this.playerService,
      this._cropMonitorService,
      this.config,
      this.logger
    );

    this._cropCareService = new CropCareService(
      this._plantingDataService,
      this.inventoryService,
      this.landService,
      this._cropMonitorService,
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
    return await this._cropPlantingService.plantCrop(userId, landId, cropType);
  }

  /**
   * 批量种植作物
   * @param {string} userId 用户ID
   * @param {Array} plantingPlans 种植计划 [{landId, cropType}]
   * @returns {Object} 批量种植结果
   */
  async batchPlantCrop(userId, plantingPlans) {
    return await this._cropPlantingService.batchPlantCrop(userId, plantingPlans);
  }

  /**
   * 检查是否可以种植
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @returns {Object} 检查结果
   */
  async canPlant(userId, landId, cropType) {
    return await this._cropPlantingService.canPlant(userId, landId, cropType);
  }

  /**
   * 获取可种植的作物列表
   * @param {string} userId 用户ID
   * @returns {Object} 可种植作物列表
   */
  async getAvailableCrops(userId) {
    return await this._cropPlantingService.getAvailableCrops(userId);
  }

  /**
   * 收获作物
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号（可选，为空时收获所有成熟作物）
   * @returns {Object} 收获结果
   */
  async harvestCrop(userId, landId = null) {
    // 委托给专门的收获服务
    return await this._cropHarvestService.harvestCrop(userId, landId);
  }

  /**
   * 检查是否可以收获
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 检查结果
   */
  async canHarvest(userId, landId) {
    return await this._cropHarvestService.canHarvest(userId, landId);
  }

  /**
   * 浇水护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 浇水结果
   */
  async waterCrop(userId, landId) {
    return await this._cropCareService.waterCrop(userId, landId);
  }

  /**
   * 施肥护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} fertilizerType 肥料类型（可选）
   * @returns {Object} 施肥结果
   */
  async fertilizeCrop(userId, landId, fertilizerType = null) {
    return await this._cropCareService.fertilizeCrop(userId, landId, fertilizerType);
  }

  /**
   * 除虫护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} pesticideType 杀虫剂类型（可选）
   * @returns {Object} 除虫结果
   */
  async treatPests(userId, landId, pesticideType = null) {
    return await this._cropCareService.treatPests(userId, landId, pesticideType);
  }

  /**
   * 批量护理作物
   * @param {string} userId 用户ID
   * @param {Array} careActions 护理动作列表 [{landId, action, itemType}]
   * @returns {Object} 批量护理结果
   */
  async batchCareCrops(userId, careActions) {
    return await this._cropCareService.batchCareCrops(userId, careActions);
  }

  /**
   * 检查是否可以护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} careType 护理类型
   * @returns {Object} 检查结果
   */
  async canCare(userId, landId, careType) {
    return await this._cropCareService.canCare(userId, landId, careType);
  }

  /**
   * 更新所有玩家的作物状态（定时任务调用）
   * @returns {Object} 更新结果
   */
  async updateAllCropsStatus() {
    // 委托给监控服务
    return await this._cropMonitorService.updateAllCropsStatus();
  }

  /**
   * 更新单个土地的作物状态
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 更新结果
   */
  async updateSingleCropStatus(userId, landId) {
    return await this._cropMonitorService.updateSingleCropStatus(userId, landId);
  }

  /**
   * 获取玩家所有作物的状态信息
   * @param {string} userId 用户ID
   * @returns {Object} 作物状态信息
   */
  async getPlayerCropsStatus(userId) {
    return await this._cropMonitorService.getPlayerCropsStatus(userId);
  }

  /**
   * 清理枯萎的作物
   * @param {string} userId 用户ID
   * @returns {Object} 清理结果
   */
  async cleanWitheredCrops(userId) {
    return await this._cropMonitorService.cleanWitheredCrops(userId);
  }
}

export default PlantingService;