/**
 * 种植服务 - 管理作物种植、生长和收获（门面模式）
 * 基于PRD v3.2设计，实现核心的种植收获循环
 * 重构为门面模式，委托给专门的服务处理，保持接口兼容性
 */

import CropPlantingService from './planting/CropPlantingService.js';
import CropHarvestService from './planting/CropHarvestService.js';
import CropCareService from './planting/CropCareService.js';
import CropMonitorService from './planting/CropMonitorService.js';
import PlantingDataService from './planting/PlantingDataService.js';

class PlantingService {
  constructor(redisClient, config, plantingDataService, inventoryService, landService, playerService, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.plantingDataService = plantingDataService;
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
    this.cropMonitorService = new CropMonitorService(
      this.plantingDataService,
      this.landService,
      this.redis,
      this.config,
      this.logger
    );

    // 初始化专门服务，注入新的依赖
    this.cropPlantingService = new CropPlantingService(
      this.plantingDataService,
      this.inventoryService,
      this.landService,
      this.cropMonitorService,
      this.config,
      this.logger
    );

    this.cropHarvestService = new CropHarvestService(
      this.plantingDataService,
      this.inventoryService,
      this.landService,
      this.playerService,
      this.cropMonitorService,
      this.config,
      this.logger
    );

    this.cropCareService = new CropCareService(
      this.plantingDataService,
      this.inventoryService,
      this.landService,
      this.cropMonitorService,
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
   * 批量种植作物
   * @param {string} userId 用户ID
   * @param {Array} plantingPlans 种植计划 [{landId, cropType}]
   * @returns {Object} 批量种植结果
   */
  async batchPlantCrop(userId, plantingPlans) {
    return await this.cropPlantingService.batchPlantCrop(userId, plantingPlans);
  }

  /**
   * 检查是否可以种植
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @returns {Object} 检查结果
   */
  async canPlant(userId, landId, cropType) {
    return await this.cropPlantingService.canPlant(userId, landId, cropType);
  }

  /**
   * 获取可种植的作物列表
   * @param {string} userId 用户ID
   * @returns {Object} 可种植作物列表
   */
  async getAvailableCrops(userId) {
    return await this.cropPlantingService.getAvailableCrops(userId);
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
   * 检查是否可以收获
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 检查结果
   */
  async canHarvest(userId, landId) {
    return await this.cropHarvestService.canHarvest(userId, landId);
  }

  /**
   * 浇水护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 浇水结果
   */
  async waterCrop(userId, landId) {
    return await this.cropCareService.waterCrop(userId, landId);
  }

  /**
   * 施肥护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} fertilizerType 肥料类型（可选）
   * @returns {Object} 施肥结果
   */
  async fertilizeCrop(userId, landId, fertilizerType = null) {
    return await this.cropCareService.fertilizeCrop(userId, landId, fertilizerType);
  }

  /**
   * 除虫护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} pesticideType 杀虫剂类型（可选）
   * @returns {Object} 除虫结果
   */
  async treatPests(userId, landId, pesticideType = null) {
    return await this.cropCareService.treatPests(userId, landId, pesticideType);
  }

  /**
   * 批量护理作物
   * @param {string} userId 用户ID
   * @param {Array} careActions 护理动作列表 [{landId, action, itemType}]
   * @returns {Object} 批量护理结果
   */
  async batchCareCrops(userId, careActions) {
    return await this.cropCareService.batchCareCrops(userId, careActions);
  }

  /**
   * 检查是否可以护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} careType 护理类型
   * @returns {Object} 检查结果
   */
  async canCare(userId, landId, careType) {
    return await this.cropCareService.canCare(userId, landId, careType);
  }

  /**
   * 更新所有玩家的作物状态（定时任务调用）
   * @returns {Object} 更新结果
   */
  async updateAllCropsStatus() {
    // 委托给监控服务
    return await this.cropMonitorService.updateAllCropsStatus();
  }

  /**
   * 更新单个土地的作物状态
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 更新结果
   */
  async updateSingleCropStatus(userId, landId) {
    return await this.cropMonitorService.updateSingleCropStatus(userId, landId);
  }

  /**
   * 获取玩家所有作物的状态信息
   * @param {string} userId 用户ID
   * @returns {Object} 作物状态信息
   */
  async getPlayerCropsStatus(userId) {
    return await this.cropMonitorService.getPlayerCropsStatus(userId);
  }

  /**
   * 清理枯萎的作物
   * @param {string} userId 用户ID
   * @returns {Object} 清理结果
   */
  async cleanWitheredCrops(userId) {
    return await this.cropMonitorService.cleanWitheredCrops(userId);
  }

  // ==================== 服务访问器 ====================

  /**
   * 获取种植数据服务实例
   * @returns {PlantingDataService} 种植数据服务实例
   */
  getDataService() {
    return this.plantingDataService;
  }

  /**
   * 获取种植服务实例
   * @returns {CropPlantingService} 种植服务实例
   */
  getPlantingService() {
    return this.cropPlantingService;
  }

  /**
   * 获取收获服务实例
   * @returns {CropHarvestService} 收获服务实例
   */
  getHarvestService() {
    return this.cropHarvestService;
  }

  /**
   * 获取护理服务实例
   * @returns {CropCareService} 护理服务实例
   */
  getCareService() {
    return this.cropCareService;
  }

  /**
   * 获取监控服务实例（包含状态和调度功能）
   * @returns {CropMonitorService} 监控服务实例
   */
  getMonitorService() {
    return this.cropMonitorService;
  }

  /**
   * 获取状态服务实例（向后兼容）
   * @returns {CropMonitorService} 监控服务实例
   * @deprecated 请使用 getMonitorService()
   */
  getStatusService() {
    return this.cropMonitorService;
  }

  /**
   * 获取调度服务实例（向后兼容）
   * @returns {CropMonitorService} 监控服务实例
   * @deprecated 请使用 getMonitorService()
   */
  getScheduleService() {
    return this.cropMonitorService;
  }
}

export default PlantingService;