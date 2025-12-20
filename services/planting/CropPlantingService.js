/**
 * 作物种植专门服务
 * 专门处理作物种植逻辑，包括种植条件检查、种子扣除、土地状态更新等
 */

import Calculator from '../../utils/calculator.js';
import { PlantingUtils } from './PlantingUtils.js';
import PlantingMessageBuilder from './PlantingMessageBuilder.js';

class CropPlantingService {
  constructor(plantingDataService, inventoryService, landService, cropMonitorService, config) {
    this.plantingDataService = plantingDataService;
    this.inventoryService = inventoryService;
    this.landService = landService;
    this.cropMonitorService = cropMonitorService;
    // 为了兼容性，同时设置 cropScheduleService 别名
    this.cropScheduleService = cropMonitorService;
    this.config = config;
    // 初始化依赖组件
    this.validator = new PlantingUtils(config);
    this.messageBuilder = new PlantingMessageBuilder();
  }

  /**
   * 种植作物
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @returns {Object} 种植结果
   */
  async plantCrop(userId, landId, cropType) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
        // 1. 获取作物配置
        const cropsConfig = this.config.crops;
        const cropConfig = cropsConfig[cropType];

        if (!cropConfig) {
          throw new Error(`未找到作物配置: ${cropType}`);
        }

        // 2. 通过 LandService 获取土地数据
        const landData = await this.landService.getLandById(userId, landId);
        if (!landData) {
          throw new Error(`土地 ${landId} 不存在`);
        }

        // 3. 验证土地状态
        const landValidation = this.validator.validateLandForPlanting(landData);
        if (landValidation) {  // 如果返回值不是 null，说明验证失败
          throw new Error(landValidation.message);
        }

        // 4. 验证种子库存
        const seedKey = `${cropType}_seed`;
        const hasEnoughSeeds = await this.inventoryService.hasItem(userId, seedKey, 1);
        if (!hasEnoughSeeds.success) {
          throw new Error(`种子不足: ${cropConfig.name}种子`);
        }

        // 5. 计算生长时间
        const baseGrowTime = cropConfig.growTime * 1000; // 转换为毫秒
        const actualGrowTime = Calculator.calculateGrowTime(baseGrowTime, landData.quality || 'normal', this.config);

        const now = Date.now();
        const harvestTime = now + actualGrowTime;

        // 6. 准备土地更新数据
        const landUpdates = {
          crop: cropType,
          plantTime: now,
          harvestTime: harvestTime,
          originalHarvestTime: harvestTime,
          status: 'growing',
          health: 100,
          needsWater: false,
          hasPests: false,
          stealable: false,
          waterDelayApplied: false,
          waterNeededAt: null,
          pestAppearedAt: null
        };

        // 7. 执行原子操作：扣除种子 + 更新土地
        await this.inventoryService.removeItem(userId, seedKey, 1);
        await this.plantingDataService.updateLandCropData(userId, landId, landUpdates);

        // 8. 添加到收获计划
        await this.cropScheduleService.addHarvestSchedule(userId, landId, harvestTime);

        // 9. 添加护理检查点调度（多检查点抽奖模式）
        const careScheduleResult = await this.cropScheduleService.addCareSchedulesForCrop(userId, landId, now, harvestTime);
        if (!careScheduleResult.success) {
          logger.warn(`[CropPlantingService] 添加护理调度失败 [${userId}][${landId}]: ${careScheduleResult.message}`);
        }

        // 10. 构建返回消息
        return this.messageBuilder.buildPlantingMessage(
          cropConfig.name,
          landId,
          harvestTime,
          {
            growTime: actualGrowTime,
            landQuality: landData.quality || 'normal'
          }
        );
      });

    } catch (error) {
      logger.error(`[CropPlantingService] 种植失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('种植', error.message);
    }
  }

  /**
   * 批量种植作物
   * @param {string} userId 用户ID
   * @param {Array} plantingPlans 种植计划 [{landId, cropType}]
   * @returns {Object} 批量种植结果
   */
  async batchPlantCrop(userId, plantingPlans) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
        const results = [];
        const landUpdates = {};
        const inventoryUpdates = {};

        // 1. 验证所有种植计划
        for (const plan of plantingPlans) {
          const { landId, cropType } = plan;
          const cropConfig = this.config.crops[cropType];

          if (!cropConfig) {
            throw new Error(`未找到作物配置: ${cropType}`);
          }

          // 验证土地
          const landData = await this.landService.getLandById(userId, landId);
          if (!landData) {
            throw new Error(`土地 ${landId} 不存在`);
          }

          const landValidation = this.validator.validateLandForPlanting(landData);
          if (landValidation) {  // 如果返回值不是 null，说明验证失败
            throw new Error(`土地 ${landId}: ${landValidation.message}`);
          }

          // 累计种子需求
          const seedKey = `${cropType}_seed`;
          inventoryUpdates[seedKey] = (inventoryUpdates[seedKey] || 0) + 1;
        }

        // 2. 验证总种子库存
        for (const [seedKey, requiredAmount] of Object.entries(inventoryUpdates)) {
          const hasEnoughSeeds = await this.inventoryService.hasItem(userId, seedKey, requiredAmount);
          if (!hasEnoughSeeds.success) {
            const cropName = seedKey.replace('_seed', '');
            throw new Error(`种子不足: ${cropName}种子需要${requiredAmount}个`);
          }
        }

        // 3. 执行批量种植
        for (const plan of plantingPlans) {
          const { landId, cropType } = plan;
          const cropConfig = this.config.crops[cropType];
          const landData = await this.landService.getLandById(userId, landId);

          // 计算生长时间
          const baseGrowTime = cropConfig.growTime * 1000;
          const actualGrowTime = Calculator.calculateGrowTime(baseGrowTime, landData.quality || 'normal', this.config);

          const now = Date.now();
          const harvestTime = now + actualGrowTime;

          // 准备土地更新
          landUpdates[landId] = {
            crop: cropType,
            plantTime: now,
            harvestTime: harvestTime,
            originalHarvestTime: harvestTime,
            status: 'growing',
            health: 100,
            needsWater: false,
            hasPests: false,
            stealable: false,
            waterDelayApplied: false,
            waterNeededAt: null,
            pestAppearedAt: null
          };

          // 添加到收获计划
          await this.cropScheduleService.addHarvestSchedule(userId, landId, harvestTime);

          // 添加护理检查点调度（多检查点抽奖模式）
          const careScheduleResult = await this.cropScheduleService.addCareSchedulesForCrop(userId, landId, now, harvestTime);
          if (!careScheduleResult.success) {
            logger.warn(`[CropPlantingService] 批量种植添加护理调度失败 [${userId}][${landId}]: ${careScheduleResult.message}`);
          }

          results.push({
            landId,
            cropType,
            cropName: cropConfig.name,
            harvestTime,
            growTime: actualGrowTime
          });
        }

        // 4. 批量扣除种子
        for (const [seedKey, amount] of Object.entries(inventoryUpdates)) {
          await this.inventoryService.removeItem(userId, seedKey, amount);
        }

        // 5. 批量更新土地
        await this.plantingDataService.updateMultipleLands(userId, landUpdates);

        return {
          success: true,
          message: `成功种植了${results.length}块土地`,
          results: results
        };
      });

    } catch (error) {
      logger.error(`[CropPlantingService] 批量种植失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('批量种植', error.message);
    }
  }

  /**
   * 检查是否可以种植
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @returns {Object} 检查结果
   */
  async canPlant(userId, landId, cropType) {
    try {
      // 1. 检查作物配置
      const cropConfig = this.config.crops[cropType];
      if (!cropConfig) {
        return { success: false, message: `未找到作物配置: ${cropType}` };
      }

      // 2. 检查土地状态
      const landData = await this.landService.getLandById(userId, landId);
      if (!landData) {
        return { success: false, message: `土地 ${landId} 不存在` };
      }

      const landValidation = this.validator.validateLandForPlanting(landData);
      if (landValidation) {  // 如果返回值不是 null，说明验证失败
        return { success: false, message: landValidation.message };
      }

      // 3. 检查种子库存
      const seedKey = `${cropType}_seed`;
      const hasEnoughSeeds = await this.inventoryService.hasItem(userId, seedKey, 1);
      if (!hasEnoughSeeds.success) {
        return { success: false, message: `种子不足: ${cropConfig.name}种子` };
      }

      return {
        success: true,
        message: '可以种植',
        cropName: cropConfig.name,
        landQuality: landData.quality,
        estimatedGrowTime: Calculator.calculateGrowTime(cropConfig.growTime * 1000, landData.quality || 'normal', this.config)
      };

    } catch (error) {
      logger.error(`[CropPlantingService] 检查种植条件失败 [${userId}]: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * 获取可种植的作物列表
   * @param {string} userId 用户ID
   * @returns {Object} 可种植作物列表
   */
  async getAvailableCrops(userId) {
    try {
      const cropsConfig = this.config.crops;
      const availableCrops = [];

      for (const [cropType, cropConfig] of Object.entries(cropsConfig)) {
        const seedKey = `${cropType}_seed`;
        const hasSeeds = await this.inventoryService.hasItem(userId, seedKey, 1);

        if (hasSeeds.success) {
          const seedCount = await this.inventoryService.getItemCount(userId, seedKey);
          availableCrops.push({
            type: cropType,
            name: cropConfig.name,
            seedCount: seedCount.count || 0,
            growTime: cropConfig.growTime,
            basePrice: cropConfig.basePrice
          });
        }
      }

      return {
        success: true,
        crops: availableCrops
      };

    } catch (error) {
      logger.error(`[CropPlantingService] 获取可种植作物失败 [${userId}]: ${error.message}`);
      return { success: false, message: error.message };
    }
  }
}

export default CropPlantingService;

