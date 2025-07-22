/**
 * 作物收获专门服务
 * 专门处理作物收获逻辑，包括成熟度检查、产量计算、经验计算、仓库更新等
 */

import { Calculator } from '../../utils/calculator.js';
import { PlantingUtils } from './PlantingUtils.js';
import PlantingMessageBuilder from './PlantingMessageBuilder.js';
import LevelCalculator from '../player/LevelCalculator.js';

class CropHarvestService {
  constructor(plantingDataService, inventoryService, landService, playerService, cropMonitorService, config, logger = null) {
    this.plantingDataService = plantingDataService;
    this.inventoryService = inventoryService;
    this.landService = landService;
    this.playerService = playerService;
    this.cropMonitorService = cropMonitorService;
    this.config = config;
    this.logger = logger || console;

    // 初始化依赖组件
    this.calculator = new Calculator(config);
    this.validator = new PlantingUtils(config, logger);
    this.messageBuilder = new PlantingMessageBuilder();
    this.levelCalculator = new LevelCalculator(config);
  }

  /**
   * 收获作物
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号（可选，为空时收获所有成熟作物）
   * @returns {Object} 收获结果
   */
  async harvestCrop(userId, landId = null) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        const now = Date.now();
        const cropsConfig = this.config.crops;

        let harvestedCrops = [];
        let totalExp = 0;

        // 1. 确定要收获的土地
        const landsToHarvest = landId ? [landId] : await this._getMatureLandIds(userId, now);

        if (landsToHarvest.length === 0) {
          if (landId) {
            throw new Error(`第${landId}块土地没有可收获的作物`);
          } else {
            return this.messageBuilder.buildInfoMessage('没有可收获的成熟作物');
          }
        }

        // 2. 验证仓库空间
        const spaceValidation = await this.inventoryService.checkSpaceForItems(userId, landsToHarvest.length);
        if (!spaceValidation.success) {
          throw new Error('仓库空间不足，无法收获作物');
        }

        // 3. 批量收获处理
        const landUpdates = {};
        const inventoryAdditions = {};

        for (const currentLandId of landsToHarvest) {
          try {
            const landData = await this.landService.getLandById(userId, currentLandId);
            if (!landData || !landData.crop || landData.status === 'empty') {
              continue;
            }

            // 检查成熟度
            if (!this._canHarvest(landData, now)) {
              if (landId) {
                const cropName = this._getCropName(landData.crop, cropsConfig);
                throw new Error(`第${landId}块土地的${cropName}还未成熟`);
              }
              continue;
            }

            const cropConfig = cropsConfig[landData.crop];
            if (!cropConfig) {
              this.logger.warn(`[CropHarvestService] 未找到作物配置: ${landData.crop}`);
              continue;
            }

            // 计算收获产量和经验
            const harvestResult = this._calculateHarvestResult(landData, cropConfig, now);

            // 准备土地重置数据
            landUpdates[currentLandId] = {
              crop: null,
              plantTime: null,
              harvestTime: null,
              status: 'empty',
              health: 100,
              needsWater: false,
              hasPests: false,
              stealable: false
            };

            // 累计物品添加
            for (const [itemId, amount] of Object.entries(harvestResult.items)) {
              inventoryAdditions[itemId] = (inventoryAdditions[itemId] || 0) + amount;
            }

            totalExp += harvestResult.experience;

            harvestedCrops.push({
              landId: currentLandId,
              cropType: landData.crop,
              cropName: cropConfig.name,
              items: harvestResult.items,
              experience: harvestResult.experience,
              quality: harvestResult.quality
            });

          } catch (error) {
            this.logger.error(`[CropHarvestService] 收获土地${currentLandId}失败: ${error.message}`);
            if (landId) {
              throw error; // 单个土地收获失败时抛出异常
            }
            // 批量收获时继续处理其他土地
          }
        }

        if (harvestedCrops.length === 0) {
          throw new Error('没有成功收获任何作物');
        }

        // 4. 批量执行更新操作
        // 批量添加物品到仓库
        for (const [itemId, amount] of Object.entries(inventoryAdditions)) {
          await this.inventoryService.addItem(userId, itemId, amount);
        }

        // 批量重置土地状态
        await this.plantingDataService.updateMultipleLands(userId, landUpdates);

        // 添加经验值
        if (totalExp > 0) {
          await this.playerService.addExp(userId, totalExp);
        }

        // 5. 从收获计划中移除
        const harvestedLandIds = harvestedCrops.map(crop => crop.landId);
        await this.cropScheduleService.batchRemoveHarvestSchedules(harvestedLandIds);

        this.logger.info(`[CropHarvestService] 用户${userId}收获了${harvestedCrops.length}块土地的作物`);

        // 6. 构建返回消息
        return this.messageBuilder.buildHarvestMessage(harvestedCrops, totalExp);
      });

    } catch (error) {
      this.logger.error(`[CropHarvestService] 收获失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('收获', error.message);
    }
  }

  /**
   * 检查是否可以收获
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 检查结果
   */
  async canHarvest(userId, landId) {
    try {
      const landData = await this.landService.getLandById(userId, landId);
      if (!landData) {
        return { success: false, message: `土地 ${landId} 不存在` };
      }

      if (!landData.crop || landData.status === 'empty') {
        return { success: false, message: `第${landId}块土地没有种植作物` };
      }

      const now = Date.now();
      if (!this._canHarvest(landData, now)) {
        const cropName = this._getCropName(landData.crop, this.config.crops);
        const remainingTime = landData.harvestTime - now;
        return {
          success: false,
          message: `${cropName}还未成熟，剩余时间: ${this._formatTime(remainingTime)}`
        };
      }

      // 检查仓库空间
      const spaceValidation = await this.inventoryService.checkSpaceForItems(userId, 1);
      if (!spaceValidation.success) {
        return { success: false, message: '仓库空间不足' };
      }

      const cropConfig = this.config.crops[landData.crop];
      return {
        success: true,
        message: '可以收获',
        cropName: cropConfig.name,
        estimatedYield: this._estimateYield(landData, cropConfig)
      };

    } catch (error) {
      this.logger.error(`[CropHarvestService] 检查收获条件失败 [${userId}]: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * 获取所有成熟作物的土地编号
   * @param {string} userId 用户ID
   * @param {number} now 当前时间
   * @returns {Array} 成熟土地编号列表
   * @private
   */
  async _getMatureLandIds(userId, now) {
    try {
      const allLands = await this.landService.getAllLands(userId);
      if (!allLands || !allLands.success || !allLands.lands) {
        return [];
      }

      return allLands.lands
        .filter(land => land.crop && land.status === 'growing' && this._canHarvest(land, now))
        .map(land => land.id);

    } catch (error) {
      this.logger.error(`[CropHarvestService] 获取成熟土地失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 检查作物是否可以收获
   * @param {Object} landData 土地数据
   * @param {number} now 当前时间
   * @returns {boolean} 是否可以收获
   * @private
   */
  _canHarvest(landData, now) {
    return landData.harvestTime && now >= landData.harvestTime;
  }

  /**
   * 计算收获结果
   * @param {Object} landData 土地数据
   * @param {Object} cropConfig 作物配置
   * @param {number} now 当前时间
   * @returns {Object} 收获结果
   * @private
   */
  _calculateHarvestResult(landData, cropConfig, now) {
    // 基础产量
    const baseYield = cropConfig.baseYield || 1;

    // 品质加成
    const qualityMultiplier = this.calculator.getQualityMultiplier(landData.quality || 'normal');

    // 健康度影响
    const healthMultiplier = (landData.health || 100) / 100;

    // 计算最终产量
    const finalYield = Math.max(1, Math.floor(baseYield * qualityMultiplier * healthMultiplier));

    // 经验值计算
    const baseExp = cropConfig.experience || 10;
    const experience = Math.floor(baseExp * qualityMultiplier);

    // 生成收获物品
    const items = {};
    items[landData.crop] = finalYield;

    // 额外产出（种子、特殊物品等）
    if (Math.random() < 0.1) { // 10%概率获得种子
      const seedKey = `${landData.crop}_seed`;
      items[seedKey] = 1;
    }

    return {
      items: items,
      experience: experience,
      quality: landData.quality || 'normal',
      yield: finalYield
    };
  }

  /**
   * 估算收获产量
   * @param {Object} landData 土地数据
   * @param {Object} cropConfig 作物配置
   * @returns {Object} 估算结果
   * @private
   */
  _estimateYield(landData, cropConfig) {
    const baseYield = cropConfig.baseYield || 1;
    const qualityMultiplier = this.calculator.getQualityMultiplier(landData.quality || 'normal');
    const healthMultiplier = (landData.health || 100) / 100;

    const estimatedYield = Math.max(1, Math.floor(baseYield * qualityMultiplier * healthMultiplier));

    return {
      min: Math.max(1, estimatedYield - 1),
      max: estimatedYield + 1,
      expected: estimatedYield
    };
  }

  /**
   * 获取作物名称
   * @param {string} cropType 作物类型
   * @param {Object} cropsConfig 作物配置
   * @returns {string} 作物名称
   * @private
   */
  _getCropName(cropType, cropsConfig) {
    return cropsConfig[cropType]?.name || cropType;
  }

  /**
   * 格式化时间显示
   * @param {number} milliseconds 毫秒数
   * @returns {string} 格式化的时间字符串
   * @private
   */
  _formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}小时${minutes % 60}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟`;
    } else {
      return `${seconds}秒`;
    }
  }
}

export default CropHarvestService;
