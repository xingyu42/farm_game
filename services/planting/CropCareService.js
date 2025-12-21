/**
 * 作物护理专门服务
 * 专门处理作物护理逻辑，包括浇水、施肥、除虫等护理操作
 */

import { PlantingUtils } from './PlantingUtils.js';
import PlantingMessageBuilder from './PlantingMessageBuilder.js';

class CropCareService {
  constructor(plantingDataService, inventoryService, landService, cropMonitorService, config) {
    this.plantingDataService = plantingDataService;
    this.inventoryService = inventoryService;
    this.landService = landService;
    this.cropMonitorService = cropMonitorService;
    this.config = config;
    // 初始化依赖组件
    this.validator = new PlantingUtils(config, logger);
    this.messageBuilder = new PlantingMessageBuilder();
  }

  /**
   * 浇水护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 浇水结果
   */
  async waterCrop(userId, landId) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
        // 1. 获取玩家数据并验证护理条件
        const playerData = await this.landService.playerService.getPlayer(userId);
        if (!playerData) {
          throw new Error('获取玩家数据失败');
        }

        const validation = this.validator.validateCareOperation(playerData, landId, 'water');
        if (!validation.success) {
          throw new Error(validation.error.message);
        }

        // 2. 使用验证返回的 land 对象，确保数据一致性
        const land = validation.land;

        // 3. 浇水效果：移除缺水状态
        const landUpdates = {
          needsWater: false
        };

        // 4. 更新土地数据
        await this.plantingDataService.updateLandCropData(userId, landId, landUpdates);

        const cropName = this._getCropName(land.crop, this.config.crops);

        // 5. 构建返回消息
        return this.messageBuilder.buildCareMessage('water', cropName, landId, {
          needsWater: landUpdates.needsWater
        });
      });

    } catch (error) {
      logger.error(`[CropCareService] 浇水失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('浇水', error.message);
    }
  }

  /**
   * 施肥护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} fertilizerType 肥料类型（可选，默认使用最好的）
   * @returns {Object} 施肥结果
   */
  async fertilizeCrop(userId, landId, fertilizerType = null) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
        // 1. 获取玩家数据并验证护理条件
        const playerData = await this.landService.playerService.getPlayer(userId);
        if (!playerData) {
          throw new Error('获取玩家数据失败');
        }

        const validation = this.validator.validateCareOperation(playerData, landId, 'fertilize');
        if (!validation.success) {
          throw new Error(validation.error.message);
        }

        // 2. 使用验证返回的 land 对象，确保数据一致性
        const land = validation.land;

        // 3. 确定肥料类型
        const actualFertilizerType = fertilizerType || await this._getBestAvailableFertilizer(userId);
        if (!actualFertilizerType) {
          throw new Error('没有可用的肥料');
        }

        // 4. 验证肥料库存
        const hasEnoughFertilizer = await this.inventoryService.hasItem(userId, actualFertilizerType, 1);
        if (!hasEnoughFertilizer.success) {
          throw new Error(`肥料不足: ${actualFertilizerType}`);
        }

        // 5. 获取肥料配置并验证
        const fertilizerConfig = this.config.items.fertilizer?.[actualFertilizerType];
        if (!fertilizerConfig) {
          throw new Error(`无效的肥料类型: ${actualFertilizerType}`);
        }
        const growthSpeedBonus = fertilizerConfig.effect?.speedBonus;
        if (!growthSpeedBonus || growthSpeedBonus <= 0) {
          throw new Error(`肥料配置错误: ${actualFertilizerType} 缺少有效的加速效果`);
        }

        const landUpdates = {
          lastFertilized: Date.now()
        };

        // 如果有加速效果，更新收获时间（按原始总生长时间计算）
        if (land.originalHarvestTime && land.plantTime) {
          const totalGrowTime = land.originalHarvestTime - land.plantTime;
          if (totalGrowTime > 0) {
            const speedUpTime = Math.floor(totalGrowTime * growthSpeedBonus);
            landUpdates.harvestTime = land.harvestTime - speedUpTime;
          }
        }

        // 6. 扣除肥料并更新土地（带回滚机制保证原子性）
        await this.inventoryService.removeItem(userId, actualFertilizerType, 1);
        try {
          await this.plantingDataService.updateLandCropData(userId, landId, landUpdates);
        } catch (updateError) {
          // 土地更新失败，回滚库存
          await this.inventoryService.addItem(userId, actualFertilizerType, 1);
          throw updateError;
        }

        // 7. 如果收获时间更新了，同步更新收获计划
        if (landUpdates.harvestTime) {
          await this.cropMonitorService.updateHarvestSchedule(userId, landId, landUpdates.harvestTime);
        }

        const cropName = this._getCropName(land.crop, this.config.crops);

        // 8. 构建返回消息
        return this.messageBuilder.buildCareMessage('fertilize', cropName, landId, {
          fertilizerType: actualFertilizerType,
          speedUp: growthSpeedBonus > 0
        });
      });

    } catch (error) {
      logger.error(`[CropCareService] 施肥失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('施肥', error.message);
    }
  }

  /**
   * 除虫护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} pesticideType 杀虫剂类型（可选）
   * @returns {Object} 除虫结果
   */
  async treatPests(userId, landId, pesticideType = null) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
        // 1. 获取玩家数据并验证护理条件
        const playerData = await this.landService.playerService.getPlayer(userId);
        if (!playerData) {
          throw new Error('获取玩家数据失败');
        }

        const validation = this.validator.validateCareOperation(playerData, landId, 'pesticide');
        if (!validation.success) {
          throw new Error(validation.error.message);
        }

        // 2. 使用验证返回的 land 对象，确保数据一致性
        const land = validation.land;

        // 3. 确定杀虫剂类型
        const actualPesticideType = pesticideType || await this._getBestAvailablePesticide(userId);
        if (!actualPesticideType) {
          throw new Error('没有可用的杀虫剂');
        }

        // 4. 验证杀虫剂库存
        const hasEnoughPesticide = await this.inventoryService.hasItem(userId, actualPesticideType, 1);
        if (!hasEnoughPesticide.success) {
          throw new Error(`杀虫剂不足: ${actualPesticideType}`);
        }

        // 5. 获取杀虫剂配置并验证
        const pesticideConfig = this.config.items.pesticide?.[actualPesticideType];
        if (!pesticideConfig) {
          throw new Error(`无效的杀虫剂类型: ${actualPesticideType}`);
        }

        const landUpdates = {
          hasPests: false,
          lastTreated: Date.now()
        };

        // 6. 扣除杀虫剂并更新土地（带回滚机制保证原子性）
        await this.inventoryService.removeItem(userId, actualPesticideType, 1);
        try {
          await this.plantingDataService.updateLandCropData(userId, landId, landUpdates);
        } catch (updateError) {
          // 土地更新失败，回滚库存
          await this.inventoryService.addItem(userId, actualPesticideType, 1);
          throw updateError;
        }

        const cropName = this._getCropName(land.crop, this.config.crops);

        // 7. 构建返回消息
        return this.messageBuilder.buildCareMessage('pesticide', cropName, landId, {
          pesticideType: actualPesticideType,
          hasPests: false
        });
      });

    } catch (error) {
      logger.error(`[CropCareService] 除虫失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('除虫', error.message);
    }
  }

  /**
   * 批量护理作物
   * @param {string} userId 用户ID
   * @param {Array} careActions 护理动作列表 [{landId, action, itemType}]
   * @returns {Object} 批量护理结果
   */
  async batchCareCrops(userId, careActions) {
    try {
      return await this.plantingDataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
        const results = [];
        const landUpdates = {};
        const inventoryUpdates = {};
        const landCache = new Map();

        // 1. 获取玩家数据用于验证
        const playerData = await this.landService.playerService.getPlayer(userId);
        if (!playerData) {
          throw new Error('获取玩家数据失败');
        }

        // 2. 预加载并验证所有护理动作
        for (const action of careActions) {
          const { landId, action: careAction, itemType } = action;

          // 使用缓存避免重复查询
          let landData = landCache.get(landId);
          if (!landData) {
            landData = await this.landService.getLandById(userId, landId);
            if (!landData) {
              throw new Error(`土地 ${landId} 不存在`);
            }
            landCache.set(landId, landData);
          }

          const validation = this.validator.validateCareOperation(playerData, landId, careAction);
          if (!validation.success) {
            throw new Error(`土地 ${landId}: ${validation.error.message}`);
          }

          // 累计物品需求，fertilize 和 pesticide 必须提供 itemType
          if (careAction === 'fertilize' || careAction === 'pesticide') {
            if (!itemType) {
              throw new Error(`土地 ${landId}: ${careAction} 操作必须指定物品类型`);
            }
            inventoryUpdates[itemType] = (inventoryUpdates[itemType] || 0) + 1;
          }
        }

        // 3. 验证总物品库存
        for (const [itemType, requiredAmount] of Object.entries(inventoryUpdates)) {
          const hasEnoughItems = await this.inventoryService.hasItem(userId, itemType, requiredAmount);
          if (!hasEnoughItems.success) {
            throw new Error(`物品不足: ${itemType}需要${requiredAmount}个`);
          }
        }

        // 4. 执行批量护理（使用缓存的土地数据，合并同一土地的多个操作）
        for (const action of careActions) {
          const { landId, action: careAction, itemType } = action;
          const landData = landCache.get(landId);

          // 获取或初始化该土地的累积更新
          const existing = landUpdates[landId] || {};

          switch (careAction) {
            case 'water':
              existing.needsWater = false;
              break;

            case 'fertilize':
              {
                const fertilizerConfig = this.config.items.fertilizer?.[itemType];
                if (!fertilizerConfig) {
                  throw new Error(`无效的肥料类型: ${itemType}`);
                }
                const speedUpHours = fertilizerConfig.effect?.speedUpHours;
                if (!speedUpHours || speedUpHours <= 0) {
                  throw new Error(`肥料配置错误: ${itemType} 缺少有效的加速时间`);
                }

                existing.lastFertilized = Date.now();

                const baseHarvestTime = existing.harvestTime ?? landData.harvestTime;
                const now = Date.now();
                const remainingTime = baseHarvestTime - now;
                if (remainingTime > 0) {
                  const speedUpMs = speedUpHours * 3600 * 1000;
                  const actualSpeedUp = Math.min(speedUpMs, remainingTime);
                  existing.harvestTime = baseHarvestTime - actualSpeedUp;
                }
                break;
              }

            case 'pesticide':
              {
                const pesticideConfig = this.config.items.pesticide?.[itemType];
                if (!pesticideConfig) {
                  throw new Error(`无效的杀虫剂类型: ${itemType}`);
                }

                existing.hasPests = false;
                existing.lastTreated = Date.now();
                break;
              }
          }

          landUpdates[landId] = existing;

          results.push({
            landId,
            action: careAction,
            itemType,
            success: true
          });
        }

        // 5. 批量扣除物品
        for (const [itemType, amount] of Object.entries(inventoryUpdates)) {
          await this.inventoryService.removeItem(userId, itemType, amount);
        }

        // 6. 批量更新土地（带回滚机制）
        try {
          await this.plantingDataService.updateMultipleLands(userId, landUpdates);
        } catch (updateError) {
          // 土地更新失败，回滚已扣除的物品
          for (const [itemType, amount] of Object.entries(inventoryUpdates)) {
            await this.inventoryService.addItem(userId, itemType, amount);
          }
          throw updateError;
        }

        // 7. 批量更新收获计划
        for (const [landId, updates] of Object.entries(landUpdates)) {
          if (updates.harvestTime) {
            await this.cropMonitorService.updateHarvestSchedule(userId, parseInt(landId, 10), updates.harvestTime);
          }
        }


        return {
          success: true,
          message: `成功护理了${results.length}块土地`,
          results: results
        };
      });

    } catch (error) {
      logger.error(`[CropCareService] 批量护理失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('批量护理', error.message);
    }
  }

  /**
   * 检查是否可以护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @param {string} careType 护理类型
   * @returns {Object} 检查结果
   */
  async canCare(userId, landId, careType) {
    try {
      const landData = await this.landService.getLandById(userId, landId);
      if (!landData) {
        return { success: false, message: `土地 ${landId} 不存在` };
      }

      // 获取完整的玩家数据用于验证
      const playerData = await this.landService.playerService.getPlayer(userId);
      if (!playerData) {
        return { success: false, message: '获取玩家数据失败' };
      }

      const validation = this.validator.validateCareOperation(playerData, landId, careType);
      if (!validation.success) {
        return validation;
      }

      // 检查所需物品
      let requiredItem = null;
      switch (careType) {
        case 'fertilize':
          requiredItem = await this._getBestAvailableFertilizer(userId);
          break;
        case 'pesticide':
          requiredItem = await this._getBestAvailablePesticide(userId);
          break;
      }

      if (requiredItem && careType !== 'water') {
        const hasItem = await this.inventoryService.hasItem(userId, requiredItem, 1);
        if (!hasItem.success) {
          return { success: false, message: `缺少所需物品: ${requiredItem}` };
        }
      }

      return {
        success: true,
        message: '可以护理',
        requiredItem: requiredItem
      };

    } catch (error) {
      logger.error(`[CropCareService] 检查护理条件失败 [${userId}]: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * 获取最佳可用肥料
   * @param {string} userId 用户ID
   * @returns {string|null} 肥料类型
   * @private
   */
  async _getBestAvailableFertilizer(userId) {
    const fertilizerTypes = ['fertilizer_deluxe', 'fertilizer_premium', 'fertilizer_normal'];

    for (const fertilizerType of fertilizerTypes) {
      const hasItem = await this.inventoryService.hasItem(userId, fertilizerType, 1);
      if (hasItem.success) {
        return fertilizerType;
      }
    }

    return null;
  }

  /**
   * 获取最佳可用杀虫剂
   * @param {string} userId 用户ID
   * @returns {string|null} 杀虫剂类型
   * @private
   */
  async _getBestAvailablePesticide(userId) {
    const pesticideTypes = ['pesticide_basic'];

    for (const pesticideType of pesticideTypes) {
      const hasItem = await this.inventoryService.hasItem(userId, pesticideType, 1);
      if (hasItem.success) {
        return pesticideType;
      }
    }

    return null;
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
}

export default CropCareService;
