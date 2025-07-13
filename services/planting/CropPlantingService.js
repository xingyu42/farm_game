/**
 * 作物种植专门服务
 * 专门处理作物种植逻辑，包括种植条件检查、种子扣除、土地状态更新等
 */

import { Calculator } from '../../utils/calculator.js';
import { PlantingValidator } from './validators/PlantingValidator.js';
import { MessageBuilder } from './utils/MessageBuilder.js';

class CropPlantingService {
  constructor(playerDataService, cropScheduleService, config, logger = null) {
    this.playerDataService = playerDataService;
    this.cropScheduleService = cropScheduleService;
    this.config = config;
    this.logger = logger || console;
    
    // 初始化依赖组件
    this.calculator = new Calculator(config);
    this.validator = new PlantingValidator(config, logger);
    this.messageBuilder = new MessageBuilder();
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
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        // 1. 在事务内获取最新数据
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 2. 获取作物配置
        const cropsConfig = this.config.crops;
        const cropConfig = cropsConfig[cropType];
        
        // 3. 执行所有验证
        const validationResult = this._validatePlantingOperation(playerData, landId, cropType, cropConfig);
        if (!validationResult.success) {
          throw new Error(validationResult.error.message);
        }
        
        const { landIndex, land } = validationResult;
        
        // 4. 计算生长时间（复用 calculator）
        const baseGrowTime = cropConfig.growTime * 1000; // 转换为毫秒
        const actualGrowTime = this.calculator.calculateGrowTime(baseGrowTime, land.quality || 'normal');
        
        const now = Date.now();
        const harvestTime = now + actualGrowTime;
        
        // 5. 更新土地状态
        const newLand = this._createPlantedLand(landId, cropType, land.quality, now, harvestTime, actualGrowTime);
        playerData.lands[landIndex] = newLand;
        
        // 6. 扣除种子
        this._deductSeed(playerData, cropType);
        
        // 7. 添加到收获计划（通过 CropScheduleService）
        await this.cropScheduleService.addHarvestSchedule(userId, landId, harvestTime);
        
        // 8. 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));
        
        this.logger.info(`[CropPlantingService] 用户${userId}在第${landId}块土地种植了${cropConfig.name}`);
        
        // 9. 构建返回消息
        return this.messageBuilder.buildPlantingMessage(
          cropConfig.name, 
          landId, 
          harvestTime, 
          {
            growTime: actualGrowTime,
            landQuality: land.quality || 'normal'
          }
        );
      });
      
    } catch (error) {
      this.logger.error(`[CropPlantingService] 种植失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('种植', error.message);
    }
  }

  /**
   * 执行种植操作的完整验证
   * @param {Object} playerData 玩家数据
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @param {Object} cropConfig 作物配置
   * @returns {Object} 验证结果
   * @private
   */
  _validatePlantingOperation(playerData, landId, cropType, cropConfig) {
    // 1. 验证玩家数据
    const playerError = this.validator.validatePlayerData(playerData);
    if (playerError) {
      return { success: false, error: playerError };
    }

    // 2. 验证作物类型
    const cropError = this.validator.validateCropType(cropType, this.config.crops);
    if (cropError) {
      return { success: false, error: cropError };
    }

    // 3. 验证土地编号
    const landError = this.validator.validateLandId(landId, playerData.lands);
    if (landError) {
      return { success: false, error: landError };
    }

    const landIndex = landId - 1;
    const land = playerData.lands[landIndex];

    // 4. 验证土地是否适合种植
    const landPlantingError = this.validator.validateLandForPlanting(land, landId);
    if (landPlantingError) {
      return { success: false, error: landPlantingError };
    }

    // 5. 验证种植要求（等级、种子）
    const requirementError = this.validator.validatePlantingRequirements(playerData, cropConfig);
    if (requirementError) {
      return { success: false, error: requirementError };
    }

    return { success: true, landIndex, land };
  }

  /**
   * 创建种植后的土地对象
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @param {string} quality 土地品质
   * @param {number} plantTime 种植时间
   * @param {number} harvestTime 收获时间
   * @param {number} growTime 生长时间
   * @returns {Object} 新的土地对象
   * @private
   */
  _createPlantedLand(landId, cropType, quality, plantTime, harvestTime, growTime) {
    const newLand = {
      id: landId,
      crop: cropType,
      quality: quality || 'normal',
      plantTime: plantTime,
      harvestTime: harvestTime,
      status: 'growing',
      health: 100,
      needsWater: false,
      hasPests: false,
      stealable: false
    };

    // 生成护理需求
    this._generateCareNeeds(newLand, growTime);

    return newLand;
  }

  /**
   * 扣除种子
   * @param {Object} playerData 玩家数据
   * @param {string} cropType 作物类型
   * @private
   */
  _deductSeed(playerData, cropType) {
    const seedItemId = `${cropType}_seed`;
    const seedCount = playerData.inventory[seedItemId] || 0;
    
    playerData.inventory[seedItemId] = seedCount - 1;
    if (playerData.inventory[seedItemId] === 0) {
      delete playerData.inventory[seedItemId];
    }
  }

  /**
   * 随机生成作物护理需求（在种植时调用）
   * @param {Object} land 土地对象
   * @param {number} growTime 生长时间
   * @private
   */
  _generateCareNeeds(land, growTime) {
    // 根据生长时间决定护理需求的概率
    const growTimeHours = growTime / (1000 * 60 * 60); // 转换为小时

    // 生长时间越长，需要护理的概率越高
    const waterProbability = Math.min(0.3 + (growTimeHours * 0.1), 0.8);
    const pestProbability = Math.min(0.2 + (growTimeHours * 0.05), 0.6);

    // 随机决定是否需要护理（在生长过程中的某个时间点）
    if (Math.random() < waterProbability) {
      land.needsWater = true;
      // 随机在生长过程中的某个时间点需要浇水
      const waterTime = land.plantTime + Math.random() * growTime * 0.7;
      land.waterNeededTime = waterTime;
    }

    if (Math.random() < pestProbability) {
      land.hasPests = true;
      // 随机在生长过程中的某个时间点出现虫害
      const pestTime = land.plantTime + Math.random() * growTime * 0.8;
      land.pestAppearTime = pestTime;
    }
  }

  /**
   * 批量种植作物
   * @param {string} userId 用户ID
   * @param {string} cropType 作物类型
   * @param {Array} landIds 土地编号数组（可选，为空时种植所有空地）
   * @returns {Object} 批量种植结果
   */
  async batchPlantCrop(userId, cropType, landIds = null) {
    try {
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 验证玩家数据和作物类型
        const playerError = this.validator.validatePlayerData(playerData);
        if (playerError) {
          throw new Error(playerError.message);
        }

        const cropError = this.validator.validateCropType(cropType, this.config.crops);
        if (cropError) {
          throw new Error(cropError.message);
        }

        // 确定要种植的土地
        const targetLandIds = landIds || this._getEmptyLandIds(playerData.lands);
        
        if (targetLandIds.length === 0) {
          throw new Error('没有可用的空地进行种植');
        }

        // 检查种子数量是否足够
        const seedItemId = `${cropType}_seed`;
        const seedCount = playerData.inventory[seedItemId] || 0;
        const actualPlantCount = Math.min(targetLandIds.length, seedCount);
        
        if (actualPlantCount === 0) {
          throw new Error(`仓库中没有${this.config.crops[cropType].name}种子`);
        }

        const results = [];
        const plantsToProcess = targetLandIds.slice(0, actualPlantCount);

        // 批量处理种植
        for (const landId of plantsToProcess) {
          try {
            const result = await this._plantSingleCropInTransaction(playerData, landId, cropType);
            results.push({ landId, success: true, ...result });
          } catch (error) {
            results.push({ landId, success: false, message: error.message });
          }
        }

        // 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        return this.messageBuilder.buildBatchOperationMessage('批量种植', results);
      });

    } catch (error) {
      this.logger.error(`[CropPlantingService] 批量种植失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('批量种植', error.message);
    }
  }

  /**
   * 获取空地编号列表
   * @param {Array} lands 土地数组
   * @returns {Array} 空地编号列表
   * @private
   */
  _getEmptyLandIds(lands) {
    return lands
      .map((land, index) => ({ land, id: index + 1 }))
      .filter(({ land }) => land.status === 'empty' && !land.crop)
      .map(({ id }) => id);
  }

  /**
   * 在事务内种植单个作物（用于批量操作）
   * @param {Object} playerData 玩家数据
   * @param {number} landId 土地编号
   * @param {string} cropType 作物类型
   * @returns {Object} 种植结果
   * @private
   */
  async _plantSingleCropInTransaction(playerData, landId, cropType) {
    const cropConfig = this.config.crops[cropType];
    const landIndex = landId - 1;
    const land = playerData.lands[landIndex];

    // 验证种植条件
    const validationResult = this._validatePlantingOperation(playerData, landId, cropType, cropConfig);
    if (!validationResult.success) {
      throw new Error(validationResult.error.message);
    }

    // 计算生长时间
    const baseGrowTime = cropConfig.growTime * 1000;
    const actualGrowTime = this.calculator.calculateGrowTime(baseGrowTime, land.quality || 'normal');
    
    const now = Date.now();
    const harvestTime = now + actualGrowTime;

    // 更新土地状态
    const newLand = this._createPlantedLand(landId, cropType, land.quality, now, harvestTime, actualGrowTime);
    playerData.lands[landIndex] = newLand;

    // 扣除种子
    this._deductSeed(playerData, cropType);

    // 添加到收获计划
    await this.cropScheduleService.addHarvestSchedule(userId, landId, harvestTime);

    return {
      cropName: cropConfig.name,
      harvestTime: harvestTime
    };
  }
}

export { CropPlantingService };
