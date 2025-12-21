/**
 * 作物收获专门服务
 * 专门处理作物收获逻辑，包括成熟度检查、产量计算、经验计算、仓库更新等
 */

import Calculator from '../../utils/calculator.js';
import { PlantingUtils } from './PlantingUtils.js';
import PlantingMessageBuilder from './PlantingMessageBuilder.js';
import LevelCalculator from '../player/LevelCalculator.js';
import ItemResolver from '../../utils/ItemResolver.js';

class CropHarvestService {
  constructor(plantingDataService, inventoryService, landService, playerService, cropMonitorService, config) {
    this.plantingDataService = plantingDataService;
    this.inventoryService = inventoryService;
    this.landService = landService;
    this.playerService = playerService;
    this.cropMonitorService = cropMonitorService;
    // cropScheduleService 功能已合并到 cropMonitorService 中
    this.cropScheduleService = cropMonitorService;
    this.config = config;
    // 初始化依赖组件
    this.validator = new PlantingUtils(config, logger);
    this.messageBuilder = new PlantingMessageBuilder();
    this.levelCalculator = new LevelCalculator(config);
    this.itemResolver = new ItemResolver(config);
  }

  /**
   * 收获作物（支持部分收获）
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号（可选，为空时收获所有成熟作物）
   * @returns {Object} 收获结果
   */
  async harvestCrop(userId, landId = null) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
        const now = Date.now();
        const cropsConfig = this.config.crops;

        // 1. 确定要收获的土地
        const landsToHarvest = landId ? [landId] : await this._getMatureLandIds(userId, now);

        if (landsToHarvest.length === 0) {
          if (landId) {
            throw new Error(`第${landId}块土地没有可收获的作物`);
          } else {
            return this.messageBuilder.buildInfoMessage('没有可收获的成熟作物');
          }
        }

        // 2. 预计算所有土地的实际产量
        const harvestCandidates = [];
        for (const currentLandId of landsToHarvest) {
          const landData = await this.landService.getLandById(userId, currentLandId);
          if (!landData || !landData.crop || landData.status === 'empty') {
            continue;
          }

          if (!this._canHarvest(landData, now)) {
            if (landId) {
              const cropName = this._getCropName(landData.crop, cropsConfig);
              throw new Error(`第${landId}块土地的${cropName}还未成熟`);
            }
            continue;
          }

          const cropConfig = cropsConfig[landData.crop];
          if (!cropConfig) {
            logger.warn(`[CropHarvestService] 未找到作物配置: ${landData.crop}`);
            continue;
          }

          const harvestResult = this._calculateHarvestResult(landData, cropConfig, now);
          const totalYield = Object.values(harvestResult.items).reduce((sum, qty) => sum + qty, 0);

          harvestCandidates.push({
            landId: currentLandId,
            landData,
            cropConfig,
            harvestResult,
            totalYield
          });
        }

        if (harvestCandidates.length === 0) {
          throw new Error('没有成功收获任何作物');
        }

        // 3. 获取仓库剩余空间，按空间限制收获
        const inventory = await this.inventoryService.getInventory(userId);
        let remainingSpace = inventory.capacity - inventory.usage;

        const harvestedCrops = [];
        const skippedCrops = [];
        const landUpdates = {};
        const inventoryAdditions = {};
        let totalExp = 0;

        for (const candidate of harvestCandidates) {
          if (candidate.totalYield <= remainingSpace) {
            // 空间足够，完整收获此土地
            landUpdates[candidate.landId] = {
              crop: null,
              plantTime: null,
              harvestTime: null,
              status: 'empty',
              needsWater: false,
              hasPests: false,
              stealable: false,
              waterDelayApplied: false,
              waterNeededAt: null,
              pestAppearedAt: null
            };

            for (const [itemId, amount] of Object.entries(candidate.harvestResult.items)) {
              inventoryAdditions[itemId] = (inventoryAdditions[itemId] || 0) + amount;
            }

            remainingSpace -= candidate.totalYield;
            totalExp += candidate.harvestResult.experience;

            harvestedCrops.push({
              landId: candidate.landId,
              cropType: candidate.landData.crop,
              cropName: candidate.cropConfig.name,
              yield: candidate.harvestResult.yield,
              items: candidate.harvestResult.items,
              experience: candidate.harvestResult.experience,
              quality: candidate.harvestResult.quality
            });
          } else {
            // 空间不足，跳过此土地
            skippedCrops.push({
              landId: candidate.landId,
              cropName: candidate.cropConfig.name,
              requiredSpace: candidate.totalYield
            });
          }
        }

        // 4. 执行收获操作
        let levelUpInfo = null;
        let unlockedItemNames = [];
        if (harvestedCrops.length > 0) {
          for (const [itemId, amount] of Object.entries(inventoryAdditions)) {
            const addResult = await this.inventoryService.addItem(userId, itemId, amount);
            if (!addResult.success) {
              logger.error(`[CropHarvestService] 添加物品失败: ${addResult.message}`);
              throw new Error(`添加物品失败: ${addResult.message}`);
            }
          }

          await this.plantingDataService.updateMultipleLands(userId, landUpdates);

          if (totalExp > 0) {
            const expResult = await this.playerService.addExp(userId, totalExp);
            levelUpInfo = expResult?.levelUp || null;
            if (levelUpInfo?.unlockedItems?.length) {
              unlockedItemNames = levelUpInfo.unlockedItems.map(itemId => {
                const cfg = this.itemResolver.findItemById(itemId);
                return cfg?.name ?? itemId;
              });
            }
          }

          const harvestedLandIds = harvestedCrops.map(crop => crop.landId);
          const scheduleMembers = harvestedLandIds.map(lid => `${userId}:${lid}`);
          await this.cropScheduleService.batchRemoveHarvestSchedules(scheduleMembers);

          // 清理护理调度
          for (const lid of harvestedLandIds) {
            await this.cropMonitorService.removeCareSchedulesForLand(userId, lid);
          }
        }

        // 5. 构建返回消息
        if (skippedCrops.length > 0) {
          return this.messageBuilder.buildPartialHarvestMessage(
            harvestedCrops,
            skippedCrops,
            totalExp,
            { currentUsage: inventory.capacity - remainingSpace, capacity: inventory.capacity },
            { levelUp: levelUpInfo, unlockedItemNames }
          );
        }

        return this.messageBuilder.buildHarvestMessage(harvestedCrops, totalExp, { levelUp: levelUpInfo, unlockedItemNames });
      });

    } catch (error) {
      logger.error(`[CropHarvestService] 收获失败 [${userId}]: ${error.message}`);
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

      const cropConfig = this.config.crops[landData.crop];
      const estimatedYield = this._estimateYield(landData, cropConfig);

      // 检查仓库空间（使用实际预估产量）
      const inventory = await this.inventoryService.getInventory(userId);
      const remainingSpace = inventory.capacity - inventory.usage;

      if (remainingSpace < estimatedYield.expected) {
        return {
          success: false,
          message: `仓库空间不足，需要${estimatedYield.expected}格，剩余${remainingSpace}格`,
          canPartialHarvest: false,
          requiredSpace: estimatedYield.expected,
          availableSpace: remainingSpace
        };
      }

      return {
        success: true,
        message: '可以收获',
        cropName: cropConfig.name,
        estimatedYield
      };

    } catch (error) {
      logger.error(`[CropHarvestService] 检查收获条件失败 [${userId}]: ${error.message}`);
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
      logger.error(`[CropHarvestService] 获取成熟土地失败: ${error.message}`);
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
  _calculateHarvestResult(landData, cropConfig, _now) {
    // 基础产量
    const baseYield = cropConfig.baseYield || 1;

    // 产量品质加成 (productionBonus)
    const qualityMultiplier = Calculator.getQualityMultiplier(landData.quality || 'normal', this.config);

    // 虫害惩罚：如果收获时仍有未处理的虫害，减少产量
    let pestPenaltyMultiplier = 1;
    if (landData.hasPests) {
      const pestPenalty = this.config.items?.care?.pest?.penalty;
      if (pestPenalty?.type === 'yieldReduction') {
        const reductionPercent = pestPenalty.reductionPercent || 20;
        pestPenaltyMultiplier = 1 - (reductionPercent / 100);
      }
    }

    // 计算最终产量
    const finalYield = Math.max(1, Math.floor(baseYield * qualityMultiplier * pestPenaltyMultiplier));

    // 经验值计算 - 使用 experienceBonus (每次收获固定经验，不乘产量)
    const baseExp = cropConfig.experience || 10;
    const expMultiplier = Calculator.getExperienceMultiplier(landData.quality || 'normal', this.config);
    const experience = Math.max(1, Math.floor(baseExp * expMultiplier));

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
      yield: finalYield,
      hasPestPenalty: landData.hasPests || false
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
    const qualityMultiplier = Calculator.getQualityMultiplier(landData.quality || 'normal', this.config);

    const estimatedYield = Math.max(1, Math.floor(baseYield * qualityMultiplier));

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
