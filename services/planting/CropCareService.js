/**
 * 作物护理专门服务
 * 专门处理作物护理逻辑，包括浇水、施肥、除虫等护理操作
 */

import { PlantingValidator } from './validators/PlantingValidator.js';
import { MessageBuilder } from './utils/MessageBuilder.js';

class CropCareService {
  constructor(playerDataService, cropScheduleService, config, logger = null) {
    this.playerDataService = playerDataService;
    this.cropScheduleService = cropScheduleService;
    this.config = config;
    this.logger = logger || console;
    
    // 初始化依赖组件
    this.validator = new PlantingValidator(config, logger);
    this.messageBuilder = new MessageBuilder();
  }

  /**
   * 浇水护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 浇水结果
   */
  async waterCrop(userId, landId) {
    try {
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        // 1. 在事务内获取最新数据
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 2. 执行完整验证
        const validation = this.validator.validateCareOperation(playerData, landId, 'water');
        if (!validation.success) {
          throw new Error(validation.error.message);
        }

        const { land, landIndex } = validation;

        // 3. 浇水效果：恢复健康度，移除缺水状态
        land.needsWater = false;
        land.health = Math.min(100, land.health + 10); // 恢复10点健康度
        playerData.lastUpdated = Date.now();

        // 4. 更新土地数据
        playerData.lands[landIndex] = land;

        // 5. 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        const cropsConfig = this.config.crops;
        const cropName = this._getCropName(land.crop, cropsConfig);

        this.logger.info(`[CropCareService] 用户${userId}为第${landId}块土地的${cropName}浇水`);

        // 6. 构建返回消息
        return this.messageBuilder.buildCareMessage('water', cropName, landId, {
          health: land.health,
          needsWater: land.needsWater
        });
      });

    } catch (error) {
      this.logger.error(`[CropCareService] 浇水失败 [${userId}]: ${error.message}`);
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
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        // 1. 在事务内获取最新数据
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 2. 执行完整验证
        const validation = this.validator.validateCareOperation(playerData, landId, 'fertilize');
        if (!validation.success) {
          throw new Error(validation.error.message);
        }

        const { land, landIndex } = validation;

        // 3. 验证和选择肥料
        const fertilizerValidation = this.validator.validateFertilizerAvailability(
          playerData.inventory, 
          fertilizerType
        );
        if (!fertilizerValidation.success) {
          throw new Error(fertilizerValidation.message);
        }

        let selectedFertilizer = fertilizerType;
        if (!selectedFertilizer) {
          selectedFertilizer = this._selectBestFertilizer(playerData.inventory);
          if (!selectedFertilizer) {
            throw new Error('仓库中没有肥料');
          }
        }

        // 4. 获取肥料配置
        const itemsConfig = this.config.items;
        const fertilizerConfig = itemsConfig.fertilizers[selectedFertilizer];

        if (!fertilizerConfig) {
          throw new Error('肥料配置不存在');
        }

        // 5. 施肥效果：减少生长时间
        const speedBonus = fertilizerConfig.effect.speedBonus || 0;
        const currentTime = Date.now();
        const remainingTime = land.harvestTime - currentTime;
        const timeReduction = Math.floor(remainingTime * speedBonus);

        land.harvestTime = Math.max(currentTime + 60000, land.harvestTime - timeReduction); // 最少还需1分钟
        land.health = Math.min(100, land.health + 5); // 恢复5点健康度

        // 6. 扣除肥料
        playerData.inventory[selectedFertilizer] -= 1;
        if (playerData.inventory[selectedFertilizer] === 0) {
          delete playerData.inventory[selectedFertilizer];
        }

        playerData.lastUpdated = Date.now();

        // 7. 更新收获计划
        await this.cropScheduleService.updateHarvestSchedule(userId, landId, land.harvestTime);

        // 8. 更新土地数据
        playerData.lands[landIndex] = land;

        // 9. 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        const cropsConfig = this.config.crops;
        const cropName = this._getCropName(land.crop, cropsConfig);

        // 区分自动选择和手动选择的日志和消息
        const selectionType = fertilizerType ? '手动选择' : '自动选择';
        this.logger.info(`[CropCareService] 用户${userId}为第${landId}块土地的${cropName}施肥，${selectionType}${fertilizerConfig.name}`);

        // 10. 构建返回消息
        return this.messageBuilder.buildCareMessage('fertilizer', cropName, landId, {
          health: land.health,
          timeReduced: timeReduction,
          fertilizerUsed: fertilizerConfig.name,
          selectionType: selectionType,
          newHarvestTime: land.harvestTime
        });
      });

    } catch (error) {
      this.logger.error(`[CropCareService] 施肥失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('施肥', error.message);
    }
  }

  /**
   * 除虫护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 除虫结果
   */
  async pesticideCrop(userId, landId) {
    try {
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        // 1. 在事务内获取最新数据
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 2. 执行完整验证
        const validation = this.validator.validateCareOperation(playerData, landId, 'pesticide');
        if (!validation.success) {
          throw new Error(validation.error.message);
        }

        const { land, landIndex } = validation;

        // 3. 除虫效果：移除虫害状态，恢复健康度
        land.hasPests = false;
        land.health = Math.min(100, land.health + 15); // 恢复15点健康度
        playerData.lastUpdated = Date.now();

        // 4. 更新土地数据
        playerData.lands[landIndex] = land;

        // 5. 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        const cropsConfig = this.config.crops;
        const cropName = this._getCropName(land.crop, cropsConfig);

        this.logger.info(`[CropCareService] 用户${userId}为第${landId}块土地的${cropName}除虫`);

        // 6. 构建返回消息
        return this.messageBuilder.buildCareMessage('pesticide', cropName, landId, {
          health: land.health,
          hasPests: land.hasPests
        });
      });

    } catch (error) {
      this.logger.error(`[CropCareService] 除虫失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('除虫', error.message);
    }
  }

  /**
   * 批量护理所有需要护理的作物
   * @param {string} userId 用户ID
   * @param {string} careType 护理类型：'water', 'pesticide', 'fertilize'
   * @param {string} fertilizerType 肥料类型（仅施肥时使用）
   * @returns {Object} 批量护理结果
   */
  async batchCare(userId, careType, fertilizerType = null) {
    try {
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        // 验证玩家数据
        const playerError = this.validator.validatePlayerData(playerData);
        if (playerError) {
          throw new Error(playerError.message);
        }

        const results = [];

        // 遍历所有土地
        for (let landIndex = 0; landIndex < playerData.lands.length; landIndex++) {
          const land = playerData.lands[landIndex];
          const landId = landIndex + 1;
          
          try {
            // 检查是否需要护理
            const validation = this.validator.validateCareOperation(playerData, landId, careType);
            if (!validation.success) {
              continue; // 跳过不需要护理的土地
            }

            // 执行护理操作
            const careResult = await this._performSingleCareInTransaction(
              playerData, landIndex, land, careType, fertilizerType
            );
            
            if (careResult.success) {
              results.push({ landId, success: true, ...careResult });
            } else {
              results.push({ landId, success: false, message: careResult.message });
            }

          } catch (error) {
            results.push({ landId, success: false, message: error.message });
          }
        }

        // 保存玩家数据
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        return this.messageBuilder.buildBatchOperationMessage(`批量${this._getCareTypeName(careType)}`, results);
      });

    } catch (error) {
      this.logger.error(`[CropCareService] 批量护理失败 [${userId}]: ${error.message}`);
      return this.messageBuilder.buildErrorMessage('批量护理', error.message);
    }
  }

  /**
   * 在事务内执行单个护理操作（用于批量操作）
   * @param {Object} playerData 玩家数据
   * @param {number} landIndex 土地索引
   * @param {Object} land 土地对象
   * @param {string} careType 护理类型
   * @param {string} fertilizerType 肥料类型
   * @returns {Object} 护理结果
   * @private
   */
  async _performSingleCareInTransaction(playerData, landIndex, land, careType, fertilizerType) {
    const cropsConfig = this.config.crops;
    const cropName = this._getCropName(land.crop, cropsConfig);

    switch (careType) {
      case 'water':
        land.needsWater = false;
        land.health = Math.min(100, land.health + 10);
        return { success: true, cropName, health: land.health };

      case 'pesticide':
        land.hasPests = false;
        land.health = Math.min(100, land.health + 15);
        return { success: true, cropName, health: land.health };

      case 'fertilize': {
        // 选择肥料
        let selectedFertilizer = fertilizerType || this._selectBestFertilizer(playerData.inventory);
        if (!selectedFertilizer) {
          return { success: false, message: '没有可用肥料' };
        }

        // 获取肥料配置
        const fertilizerConfig = this.config.items.fertilizers[selectedFertilizer];
        if (!fertilizerConfig) {
          return { success: false, message: '肥料配置不存在' };
        }

        // 施肥效果
        const speedBonus = fertilizerConfig.effect.speedBonus || 0;
        const currentTime = Date.now();
        const remainingTime = land.harvestTime - currentTime;
        const timeReduction = Math.floor(remainingTime * speedBonus);

        land.harvestTime = Math.max(currentTime + 60000, land.harvestTime - timeReduction);
        land.health = Math.min(100, land.health + 5);

        // 扣除肥料
        playerData.inventory[selectedFertilizer] -= 1;
        if (playerData.inventory[selectedFertilizer] === 0) {
          delete playerData.inventory[selectedFertilizer];
        }

        return {
          success: true,
          cropName,
          health: land.health,
          timeReduced: timeReduction,
          fertilizerUsed: fertilizerConfig.name
        };
      }

      default:
        return { success: false, message: '未知的护理类型' };
    }
  }

  /**
   * 自动选择最好的肥料
   * @param {Object} inventory 玩家库存
   * @returns {string|null} 选中的肥料ID
   * @private
   */
  _selectBestFertilizer(inventory) {
    const availableFertilizers = ['fertilizer_deluxe', 'fertilizer_premium', 'fertilizer_normal'];

    for (const fertilizer of availableFertilizers) {
      if (inventory[fertilizer] && inventory[fertilizer] > 0) {
        return fertilizer;
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

  /**
   * 获取护理类型名称
   * @param {string} careType 护理类型
   * @returns {string} 护理类型名称
   * @private
   */
  _getCareTypeName(careType) {
    const careNames = {
      water: '浇水',
      fertilize: '施肥',
      pesticide: '除虫'
    };
    return careNames[careType] || '护理';
  }
}

export { CropCareService };
