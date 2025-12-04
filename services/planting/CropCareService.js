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

        // 3. 浇水效果：恢复健康度，移除缺水状态
        const landUpdates = {
          needsWater: false,
          health: Math.min(100, (land.health ?? 100) + 10)
        };

        // 4. 更新土地数据
        await this.plantingDataService.updateLandCropData(userId, landId, landUpdates);

        const cropName = this._getCropName(land.crop, this.config.crops);

        // 5. 构建返回消息
        return this.messageBuilder.buildCareMessage('water', cropName, landId, {
          health: landUpdates.health,
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

        // 5. 施肥效果
        const fertilizerConfig = this.config.items[actualFertilizerType];
        const healthBonus = fertilizerConfig?.effects?.health || 20;
        const growthSpeedBonus = fertilizerConfig?.effects?.growthSpeed || 0.1;

        const landUpdates = {
          health: Math.min(100, (land.health ?? 100) + healthBonus),
          lastFertilized: Date.now()
        };

        // 如果有加速效果，更新收获时间
        if (growthSpeedBonus > 0 && land.harvestTime) {
          const remainingTime = land.harvestTime - Date.now();
          const speedUpTime = Math.floor(remainingTime * growthSpeedBonus);
          landUpdates.harvestTime = land.harvestTime - speedUpTime;
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
          health: landUpdates.health,
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

        // 5. 除虫效果
        const pesticideConfig = this.config.items[actualPesticideType];
        const healthRecovery = pesticideConfig?.effects?.health || 15;

        const landUpdates = {
          hasPests: false,
          health: Math.min(100, (land.health ?? 100) + healthRecovery),
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
          health: landUpdates.health,
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

        // 1. 获取玩家数据用于验证
        const playerData = await this.landService.playerService.getPlayer(userId);
        if (!playerData) {
          throw new Error('获取玩家数据失败');
        }

        // 2. 验证所有护理动作
        for (const action of careActions) {
          const { landId, action: careAction, itemType } = action;

          const landData = await this.landService.getLandById(userId, landId);
          if (!landData) {
            throw new Error(`土地 ${landId} 不存在`);
          }

          const validation = this.validator.validateCareOperation(playerData, landId, careAction);
          if (!validation.success) {
            throw new Error(`土地 ${landId}: ${validation.error.message}`);
          }

          // 累计物品需求
          if (itemType) {
            inventoryUpdates[itemType] = (inventoryUpdates[itemType] || 0) + 1;
          }
        }

        // 2. 验证总物品库存
        for (const [itemType, requiredAmount] of Object.entries(inventoryUpdates)) {
          const hasEnoughItems = await this.inventoryService.hasItem(userId, itemType, requiredAmount);
          if (!hasEnoughItems.success) {
            throw new Error(`物品不足: ${itemType}需要${requiredAmount}个`);
          }
        }

        // 3. 执行批量护理
        for (const action of careActions) {
          const { landId, action: careAction, itemType } = action;
          const landData = await this.landService.getLandById(userId, landId);

          let landUpdate = {};

          switch (careAction) {
            case 'water':
              landUpdate = {
                needsWater: false,
                health: Math.min(100, (landData.health || 100) + 10)
              };
              break;

            case 'fertilize':
              {
                const fertilizerConfig = this.config.items[itemType];
                const healthBonus = fertilizerConfig?.effects?.health || 20;
                const growthSpeedBonus = fertilizerConfig?.effects?.growthSpeed || 0.1;

                landUpdate = {
                  health: Math.min(100, (landData.health || 100) + healthBonus),
                  lastFertilized: Date.now()
                };

                if (growthSpeedBonus > 0 && landData.harvestTime) {
                  const remainingTime = landData.harvestTime - Date.now();
                  const speedUpTime = Math.floor(remainingTime * growthSpeedBonus);
                  landUpdate.harvestTime = landData.harvestTime - speedUpTime;
                }
                break;
              }

            case 'pesticide':
              {
                const pesticideConfig = this.config.items[itemType];
                const healthRecovery = pesticideConfig?.effects?.health || 15;

                landUpdate = {
                  hasPests: false,
                  health: Math.min(100, (landData.health || 100) + healthRecovery),
                  lastTreated: Date.now()
                };
                break;
              }
          }

          landUpdates[landId] = landUpdate;

          results.push({
            landId,
            action: careAction,
            itemType,
            success: true
          });
        }

        // 4. 批量扣除物品
        for (const [itemType, amount] of Object.entries(inventoryUpdates)) {
          await this.inventoryService.removeItem(userId, itemType, amount);
        }

        // 5. 批量更新土地
        await this.plantingDataService.updateMultipleLands(userId, landUpdates);

        // 6. 批量更新收获计划
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
