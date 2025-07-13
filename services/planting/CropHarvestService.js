/**
 * 作物收获专门服务
 * 专门处理作物收获逻辑，包括成熟度检查、产量计算、经验计算、仓库更新等
 */

import { Calculator } from '../../utils/calculator.js';
import { PlantingValidator } from './validators/PlantingValidator.js';
import { MessageBuilder } from './utils/MessageBuilder.js';
import LevelCalculator from '../player/utils/LevelCalculator.js';

class CropHarvestService {
  constructor(playerDataService, cropScheduleService, config, logger = null) {
    this.playerDataService = playerDataService;
    this.cropScheduleService = cropScheduleService;
    this.config = config;
    this.logger = logger || console;
    
    // 初始化依赖组件
    this.calculator = new Calculator(config);
    this.validator = new PlantingValidator(config, logger);
    this.messageBuilder = new MessageBuilder();
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
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        // 1. 在事务内获取最新数据
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 2. 验证玩家数据
        const playerError = this.validator.validatePlayerData(playerData);
        if (playerError) {
          throw new Error(playerError.message);
        }

        const now = Date.now();
        const cropsConfig = this.config.crops;
        
        let harvestedCrops = [];
        let totalExp = 0;

        // 3. 确定要收获的土地
        const landsToHarvest = landId ? [landId - 1] : 
          playerData.lands.map((_, index) => index);

        // 4. 处理每块土地的收获
        for (const landIndex of landsToHarvest) {
          if (landIndex < 0 || landIndex >= playerData.lands.length) {
            continue;
          }

          const land = playerData.lands[landIndex];
          
          // 检查是否可以收获
          if (!land.crop || land.status === 'empty') {
            continue;
          }

          // 检查成熟度
          if (!this.validator.canHarvest(land, now)) {
            if (landId) {
              throw new Error(`第${landId}块土地的${this._getCropName(land.crop, cropsConfig)}还未成熟`);
            }
            continue;
          }

          // 检查仓库空间
          const inventoryError = this.validator.validateInventorySpace(playerData);
          if (inventoryError) {
            if (landId) {
              throw new Error(inventoryError.message);
            }
            break; // 仓库满了，停止收获
          }

          // 执行收获
          const harvestResult = this._harvestSingleCrop(playerData, landIndex, land, cropsConfig);
          if (harvestResult) {
            harvestedCrops.push(harvestResult);
            totalExp += harvestResult.experience;
            
            // 从收获计划中移除
            await this.cropScheduleService.removeHarvestSchedule(userId, landIndex + 1);
          }
        }

        // 5. 检查是否有收获
        if (harvestedCrops.length === 0) {
          const message = landId ? 
            `第${landId}块土地没有可收获的作物` : 
            '没有可收获的成熟作物';
          throw new Error(message);
        }

        // 6. 处理经验和升级
        let levelUpInfo = null;
        if (totalExp > 0) {
          levelUpInfo = this._handleExperienceAndLevelUp(playerData, totalExp);
        }

        // 7. 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        this.logger.info(`[CropHarvestService] 用户${userId}收获了${harvestedCrops.length}种作物`);

        // 8. 构建返回消息
        const result = this.messageBuilder.buildHarvestMessage(harvestedCrops, totalExp, levelUpInfo);
        return result;
      });

    } catch (error) {
      this.logger.error(`[CropHarvestService] 收获失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('收获', error.message);
    }
  }

  /**
   * 收获单个作物
   * @param {Object} playerData 玩家数据
   * @param {number} landIndex 土地索引
   * @param {Object} land 土地对象
   * @param {Object} cropsConfig 作物配置
   * @returns {Object|null} 收获结果
   * @private
   */
  _harvestSingleCrop(playerData, landIndex, land, cropsConfig) {
    const cropConfig = cropsConfig[land.crop];
    if (!cropConfig) {
      this.logger.warn(`[CropHarvestService] 未知作物类型: ${land.crop}`);
      return null;
    }

    // 计算产量（复用 calculator）
    const baseYield = 1;
    const finalYield = this.calculator.calculateYield(
      baseYield, 
      land.quality || 'normal', 
      land.health || 100
    );

    // 计算经验（复用 calculator）
    const finalExp = this.calculator.calculateCropExperience(
      land.crop, 
      finalYield, 
      land.quality || 'normal'
    );

    // 添加到仓库
    const cropItemId = land.crop;
    playerData.inventory[cropItemId] = (playerData.inventory[cropItemId] || 0) + finalYield;
    
    // 清空土地
    playerData.lands[landIndex] = this._createEmptyLand(landIndex + 1, land.quality);

    return {
      landId: landIndex + 1,
      cropName: this._getCropName(land.crop, cropsConfig),
      yield: finalYield,
      experience: finalExp
    };
  }

  /**
   * 创建空土地对象
   * @param {number} landId 土地编号
   * @param {string} quality 土地品质
   * @returns {Object} 空土地对象
   * @private
   */
  _createEmptyLand(landId, quality = 'normal') {
    return {
      id: landId,
      crop: null,
      quality: quality,
      plantTime: null,
      harvestTime: null,
      status: 'empty',
      health: 100,
      needsWater: false,
      hasPests: false,
      stealable: false
    };
  }

  /**
   * 处理经验和升级
   * @param {Object} playerData 玩家数据
   * @param {number} expToAdd 要添加的经验
   * @returns {Object|null} 升级信息
   * @private
   */
  _handleExperienceAndLevelUp(playerData, expToAdd) {
    const oldLevel = playerData.level;
    const oldExperience = playerData.experience || 0;
    
    // 添加经验
    playerData.experience = oldExperience + expToAdd;
    
    // 计算新等级（复用 LevelCalculator）
    const levelResult = this.levelCalculator.calculateLevel(playerData.experience);
    const newLevel = levelResult.level;
    
    // 检查是否升级
    if (newLevel > oldLevel) {
      playerData.level = newLevel;
      
      // 获取升级奖励
      const levelUpRewards = this.levelCalculator.getLevelUpRewards(oldLevel, newLevel);
      
      // 发放升级奖励
      if (levelUpRewards.coins > 0) {
        playerData.coins = (playerData.coins || 0) + levelUpRewards.coins;
      }
      
      this.logger.info(`[CropHarvestService] 用户升级: ${oldLevel} -> ${newLevel}`);
      
      return {
        oldLevel,
        newLevel,
        rewards: levelUpRewards
      };
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
    const cropConfig = cropsConfig[cropType];
    return cropConfig ? cropConfig.name : cropType;
  }

  /**
   * 批量收获所有成熟作物
   * @param {string} userId 用户ID
   * @returns {Object} 批量收获结果
   */
  async harvestAllMatureCrops(userId) {
    try {
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 验证玩家数据
        const playerError = this.validator.validatePlayerData(playerData);
        if (playerError) {
          throw new Error(playerError.message);
        }

        const now = Date.now();
        const cropsConfig = this.config.crops;
        
        let harvestedCrops = [];
        let totalExp = 0;
        let skippedCount = 0;

        // 遍历所有土地
        for (let landIndex = 0; landIndex < playerData.lands.length; landIndex++) {
          const land = playerData.lands[landIndex];
          
          // 跳过空地或未成熟的作物
          if (!land.crop || land.status === 'empty' || !this.validator.canHarvest(land, now)) {
            continue;
          }

          // 检查仓库空间
          const inventoryError = this.validator.validateInventorySpace(playerData);
          if (inventoryError) {
            skippedCount++;
            continue;
          }

          // 执行收获
          const harvestResult = this._harvestSingleCrop(playerData, landIndex, land, cropsConfig);
          if (harvestResult) {
            harvestedCrops.push(harvestResult);
            totalExp += harvestResult.experience;
            
            // 从收获计划中移除
            await this.cropScheduleService.removeHarvestSchedule(userId, landIndex + 1);
          }
        }

        // 处理经验和升级
        let levelUpInfo = null;
        if (totalExp > 0) {
          levelUpInfo = this._handleExperienceAndLevelUp(playerData, totalExp);
        }

        // 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        this.logger.info(`[CropHarvestService] 用户${userId}批量收获了${harvestedCrops.length}种作物`);

        // 构建结果消息
        if (harvestedCrops.length === 0) {
          throw new Error('没有可收获的成熟作物');
        }

        const result = this.messageBuilder.buildHarvestMessage(harvestedCrops, totalExp, levelUpInfo);
        
        // 添加跳过信息
        if (skippedCount > 0) {
          result.message += `\n⚠️ 由于仓库空间不足，跳过了${skippedCount}块土地的收获`;
        }

        return result;
      });

    } catch (error) {
      this.logger.error(`[CropHarvestService] 批量收获失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('批量收获', error.message);
    }
  }

  /**
   * 获取可收获的作物信息
   * @param {string} userId 用户ID
   * @returns {Object} 可收获作物信息
   */
  async getHarvestableInfo(userId) {
    try {
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      
      if (!playerData) {
        return this.messageBuilder.buildErrorMessage('查询', '玩家数据不存在');
      }

      const now = Date.now();
      const cropsConfig = this.config.crops;
      const harvestableList = [];
      
      for (let landIndex = 0; landIndex < playerData.lands.length; landIndex++) {
        const land = playerData.lands[landIndex];
        
        if (land.crop && land.status !== 'empty' && this.validator.canHarvest(land, now)) {
          harvestableList.push({
            landId: landIndex + 1,
            cropName: this._getCropName(land.crop, cropsConfig),
            cropType: land.crop,
            quality: land.quality || 'normal',
            health: land.health || 100
          });
        }
      }

      return {
        success: true,
        data: {
          harvestableCount: harvestableList.length,
          harvestableList: harvestableList
        }
      };

    } catch (error) {
      this.logger.error(`[CropHarvestService] 获取可收获信息失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('查询', error.message);
    }
  }
}

export { CropHarvestService };
