/**
 * 种植服务 - 管理作物种植、生长和收获
 * 基于PRD v3.2设计，实现核心的种植收获循环
 */
class PlantingService {
  constructor(redisClient, config, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.logger = logger || console;
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
      // 获取作物配置
      const cropsConfig = this.config.crops;
      const cropConfig = cropsConfig[cropType];
      
      if (!cropConfig) {
        return {
          success: false,
          message: `未知的作物类型: ${cropType}`
        };
      }

      // 获取玩家数据
      const playerKey = this.redis.generateKey('player', userId);
      const playerData = await this.redis.get(playerKey);

      // 验证玩家数据
      const playerError = this._validatePlayerData(playerData);
      if (playerError) {
        return playerError;
      }

      // 验证等级要求
      if (playerData.level < cropConfig.requiredLevel) {
        return {
          success: false,
          message: `种植${cropConfig.name}需要${cropConfig.requiredLevel}级，当前等级：${playerData.level}`
        };
      }

      // 验证土地编号
      const landError = this._validateLandId(landId, playerData.lands);
      if (landError) {
        return landError;
      }

      const landIndex = landId - 1;

      const land = playerData.lands[landIndex];
      if (land.status !== 'empty' && land.crop) {
        return {
          success: false,
          message: `第${landId}块土地已经种植了作物`
        };
      }

      // 检查种子数量
      const seedItemId = `${cropType}_seed`;
      const seedCount = playerData.inventory[seedItemId] || 0;
      if (seedCount < 1) {
        return {
          success: false,
          message: `仓库中没有${cropConfig.name}种子`
        };
      }

      // 获取土地品质配置
      const landConfig = await this.config.getLandConfig();
      const qualityConfig = landConfig.quality[land.quality || 'normal'];
      
      // 计算生长时间（考虑土地品质加成）
      const baseGrowTime = cropConfig.growTime * 1000; // 转换为毫秒
      const timeReduction = qualityConfig.timeReduction || 0;
      const actualGrowTime = Math.floor(baseGrowTime * (1 - timeReduction / 100));
      
      const now = Date.now();
      const harvestTime = now + actualGrowTime;

      // 添加到收获计划
      const scheduleKey = this.redis.generateKey('schedule', 'harvest');
      const scheduleMember = `${userId}:${landId}`;
      await this.redis.client.zAdd(scheduleKey, { score: harvestTime, value: scheduleMember });

      // 开始事务
      await this.redis.multi();

      // 更新土地状态
      const newLand = {
        id: landId,
        crop: cropType,
        quality: land.quality || 'normal',
        plantTime: now,
        harvestTime: harvestTime,
        status: 'growing',
        health: 100,
        needsWater: false,
        hasPests: false,
        stealable: false
      };

      // 生成护理需求
      this._generateCareNeeds(newLand, actualGrowTime);

      playerData.lands[landIndex] = newLand;

      // 扣除种子
      playerData.inventory[seedItemId] = seedCount - 1;
      if (playerData.inventory[seedItemId] === 0) {
        delete playerData.inventory[seedItemId];
      }

      // 保存玩家数据
      await this.redis.set(playerKey, this.redis.serialize(playerData));
      
      // 提交事务
      await this.redis.exec();

      this.logger.info(`[PlantingService] 用户${userId}在第${landId}块土地种植了${cropConfig.name}`);

      return {
        success: true,
        message: `成功在第${landId}块土地种植了${cropConfig.name}！`,
        data: {
          cropName: cropConfig.name,
          growTime: actualGrowTime,
          harvestTime: harvestTime,
          expectedHarvestTime: this._formatTime(new Date(harvestTime))
        }
      };

    } catch (error) {
      await this.redis.discard();
      this.logger.error(`[PlantingService] 种植失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 收获作物
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号（可选，为空时收获所有成熟作物）
   * @returns {Object} 收获结果
   */
  async harvestCrop(userId, landId = null) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const playerData = await this.redis.get(playerKey);

      // 验证玩家数据
      const playerError = this._validatePlayerData(playerData);
      if (playerError) {
        return playerError;
      }

      const now = Date.now();
      const cropsConfig = this.config.crops;
      const landConfig = this.config.land;
      
      let harvestedCrops = [];
      let totalExp = 0;

      // 确定要收获的土地
      const landsToHarvest = landId ? [landId - 1] : 
        playerData.lands.map((_, index) => index);

      // 开始事务
      await this.redis.multi();

      for (const landIndex of landsToHarvest) {
        if (landIndex < 0 || landIndex >= playerData.lands.length) {
          continue;
        }

        const land = playerData.lands[landIndex];
        
        // 检查是否可以收获
        if (!land.crop || land.status === 'empty') {
          continue;
        }

        if (land.harvestTime > now) {
          // 作物还未成熟
          if (landId) {
            return {
              success: false,
              message: `第${landId}块土地的${this._getCropName(land.crop, cropsConfig)}还未成熟`
            };
          }
          continue;
        }

        // 检查仓库空间
        const currentInventoryCount = Object.values(playerData.inventory).reduce((sum, count) => sum + count, 0);
        if (currentInventoryCount >= playerData.inventory_capacity) {
          if (landId) {
            return {
              success: false,
              message: '仓库已满，无法收获作物'
            };
          }
          break; // 仓库满了，停止收获
        }

        // 计算收获量和经验
        const cropConfig = cropsConfig[land.crop];
        const qualityConfig = landConfig.quality[land.quality || 'normal'];
        
        // 基础产量计算
        let baseYield = 1;
        const healthFactor = (land.health || 100) / 100;
        const qualityBonus = (qualityConfig.productionBonus || 0) / 100;
        
        const finalYield = Math.max(1, Math.floor(baseYield * healthFactor * (1 + qualityBonus)));
        
        // 经验计算
        const baseExp = cropConfig.experience || 0;
        const expBonus = (qualityConfig.expBonus || 0) / 100;
        const finalExp = Math.floor(baseExp * (1 + expBonus));

        // 添加到仓库
        const cropItemId = land.crop;
        playerData.inventory[cropItemId] = (playerData.inventory[cropItemId] || 0) + finalYield;
        
        // 清空土地
        playerData.lands[landIndex] = {
          id: landIndex + 1,
          crop: null,
          quality: land.quality || 'normal',
          plantTime: null,
          harvestTime: null,
          status: 'empty',
          health: 100,
          needsWater: false,
          hasPests: false,
          stealable: false
        };

        // 从收获计划中移除
        const scheduleKey = this.redis.generateKey('schedule', 'harvest');
        const scheduleMember = `${userId}:${land.id}`;
        await this.redis.client.zRem(scheduleKey, scheduleMember);

        harvestedCrops.push({
          landId: landIndex + 1,
          cropName: this._getCropName(land.crop, cropsConfig),
          yield: finalYield,
          experience: finalExp
        });

        totalExp += finalExp;
      }

      if (harvestedCrops.length === 0) {
        const message = landId ? 
          `第${landId}块土地没有可收获的作物` : 
          '没有可收获的成熟作物';
        
        return {
          success: false,
          message: message
        };
      }

      // 添加经验
      if (totalExp > 0) {
        playerData.experience = (playerData.experience || 0) + totalExp;
        
        // 检查升级（这里可以调用PlayerService的升级逻辑）
        const oldLevel = playerData.level;
        const newLevel = this._calculateLevel(playerData.experience);
        if (newLevel > oldLevel) {
          playerData.level = newLevel;
        }
      }

      // 保存玩家数据
      await this.redis.set(playerKey, this.redis.serialize(playerData));
      
      // 提交事务
      await this.redis.exec();

      this.logger.info(`[PlantingService] 用户${userId}收获了${harvestedCrops.length}种作物`);

      return {
        success: true,
        message: this._buildHarvestMessage(harvestedCrops, totalExp),
        data: {
          harvestedCrops: harvestedCrops,
          totalExperience: totalExp
        }
      };

    } catch (error) {
      await this.redis.discard();
      this.logger.error(`[PlantingService] 收获失败 [${userId}]: ${error.message}`);
      throw error;
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
   * 更新所有玩家的作物状态（定时任务调用）
   * @returns {Object} 更新结果
   */
  async updateAllCropsStatus() {
    try {
      const scheduleKey = this.redis.generateKey('schedule', 'harvest');
      const now = Date.now();
      let updatedPlayersCount = 0;
      let updatedLandsCount = 0;

      // 1. 高效获取所有到期的作物成员
      const dueMembers = await this.redis.client.zRange(scheduleKey, 0, now, { BY: 'SCORE' });

      if (!dueMembers || dueMembers.length === 0) {
        this.logger.info('[PlantingService] 没有需要更新的作物状态');
        return { success: true, updatedPlayers: 0, updatedLands: 0 };
      }

      // 2. 按玩家ID对需要更新的土地进行分组
      const updatesByUser = {};
      for (const member of dueMembers) {
        const [userId, landId] = member.split(':');
        if (!updatesByUser[userId]) {
          updatesByUser[userId] = [];
        }
        updatesByUser[userId].push(parseInt(landId, 10));
      }

      // 3. 批量处理每个玩家的更新
      for (const userId in updatesByUser) {
        const playerKey = this.redis.generateKey('player', userId);
        
        // 使用分布式锁确保数据一致性
        await this.redis.withLock(userId, async () => {
          const playerData = await this.redis.get(playerKey);
          if (!playerData || !playerData.lands) return;

          let hasUpdates = false;
          const landIdsToUpdate = updatesByUser[userId];

          for (const landId of landIdsToUpdate) {
            const landIndex = landId - 1;
            if (landIndex < 0 || landIndex >= playerData.lands.length) continue;
            
            const land = playerData.lands[landIndex];
            if (land.crop && land.status === 'growing') {
              let landUpdated = false;

              // 检查是否成熟
              if (now >= land.harvestTime) {
                land.status = 'mature';
                land.stealable = true;
                landUpdated = true;
              }

              // 检查护理需求
              if (land.waterNeededTime && now >= land.waterNeededTime && !land.needsWater) {
                land.needsWater = true;
                land.health = Math.max(50, land.health - 20); // 缺水降低健康度
                landUpdated = true;
              }

              if (land.pestAppearTime && now >= land.pestAppearTime && !land.hasPests) {
                land.hasPests = true;
                land.health = Math.max(30, land.health - 25); // 虫害降低健康度
                landUpdated = true;
              }

              if (landUpdated) {
                hasUpdates = true;
                updatedLandsCount++;
              }
            }
          }

          if (hasUpdates) {
            await this.redis.set(playerKey, this.redis.serialize(playerData));
            updatedPlayersCount++;
          }
        }, 'updateCrops');
      }

      // 4. 从计划中移除已处理的成员
      if (dueMembers.length > 0) {
        await this.redis.client.zRem(scheduleKey, dueMembers);
      }

      this.logger.info(`[PlantingService] 更新了${updatedPlayersCount}个玩家的${updatedLandsCount}块土地状态`);
      
      return {
        success: true,
        updatedPlayers: updatedPlayersCount,
        updatedLands: updatedLandsCount
      };

    } catch (error) {
      this.logger.error(`[PlantingService] 更新作物状态失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 验证玩家数据存在性
   * @param {Object} playerData 玩家数据
   * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
   * @private
   */
  _validatePlayerData(playerData) {
    if (!playerData) {
      return {
        success: false,
        message: '玩家数据不存在'
      };
    }
    return null;
  }

  /**
   * 验证土地编号有效性
   * @param {number} landId 土地编号
   * @param {Array} lands 土地数组
   * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
   * @private
   */
  _validateLandId(landId, lands) {
    const landIndex = landId - 1;
    if (landIndex < 0 || landIndex >= lands.length) {
      return {
        success: false,
        message: `土地编号${landId}不存在`
      };
    }
    return null;
  }

  /**
   * 验证土地基础状态（是否有作物、是否成熟）
   * @param {Object} land 土地对象
   * @param {number} landId 土地编号
   * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
   * @private
   */
  _validateLandBasicStatus(land, landId) {
    if (!land.crop || land.status === 'empty') {
      return {
        success: false,
        message: `第${landId}块土地没有种植作物`
      };
    }

    if (land.status === 'mature') {
      return {
        success: false,
        message: `第${landId}块土地的作物已经成熟，请先收获`
      };
    }

    return null;
  }

  /**
   * 验证特定护理条件
   * @param {Object} land 土地对象
   * @param {number} landId 土地编号
   * @param {string} careType 护理类型：'water', 'fertilize', 'pesticide'
   * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
   * @private
   */
  _validateCareCondition(land, landId, careType) {
    switch (careType) {
      case 'water':
        if (!land.needsWater) {
          return {
            success: false,
            message: `第${landId}块土地的作物不需要浇水`
          };
        }
        break;

      case 'pesticide':
        if (!land.hasPests) {
          return {
            success: false,
            message: `第${landId}块土地的作物没有虫害`
          };
        }
        break;

      case 'fertilize':
        // 施肥没有特殊条件限制，任何生长中的作物都可以施肥
        break;

      default:
        return {
          success: false,
          message: '未知的护理类型'
        };
    }

    return null;
  }

  /**
   * 执行完整的护理前验证
   * @param {Object} playerData 玩家数据
   * @param {number} landId 土地编号
   * @param {string} careType 护理类型
   * @returns {Object} 验证结果 { success: boolean, error?: Object, land?: Object, landIndex?: number }
   * @private
   */
  _validateCareOperation(playerData, landId, careType) {
    // 1. 验证玩家数据
    const playerError = this._validatePlayerData(playerData);
    if (playerError) {
      return { success: false, error: playerError };
    }

    // 2. 验证土地编号
    const landError = this._validateLandId(landId, playerData.lands);
    if (landError) {
      return { success: false, error: landError };
    }

    const landIndex = landId - 1;
    const land = playerData.lands[landIndex];

    // 3. 验证土地基础状态
    const statusError = this._validateLandBasicStatus(land, landId);
    if (statusError) {
      return { success: false, error: statusError };
    }

    // 4. 验证特定护理条件
    const conditionError = this._validateCareCondition(land, landId, careType);
    if (conditionError) {
      return { success: false, error: conditionError };
    }

    return { success: true, land, landIndex };
  }

  /**
   * 浇水护理
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 浇水结果
   */
  async waterCrop(userId, landId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const playerData = await this.redis.get(playerKey);

      // 执行完整验证
      const validation = this._validateCareOperation(playerData, landId, 'water');
      if (!validation.success) {
        return validation.error;
      }

      const { land } = validation;

      // 开始事务
      await this.redis.multi();

      // 浇水效果：恢复健康度，移除缺水状态
      land.needsWater = false;
      land.health = Math.min(100, land.health + 10); // 恢复10点健康度
      playerData.lastUpdated = Date.now();

      // 保存玩家数据
      await this.redis.set(playerKey, this.redis.serialize(playerData));

      // 提交事务
      await this.redis.exec();

      const cropsConfig = this.config.crops;
      const cropName = this._getCropName(land.crop, cropsConfig);

      this.logger.info(`[PlantingService] 用户${userId}为第${landId}块土地的${cropName}浇水`);

      return {
        success: true,
        message: `成功为第${landId}块土地的${cropName}浇水！健康度恢复到${land.health}%`,
        data: {
          landId: landId,
          cropName: cropName,
          health: land.health,
          needsWater: land.needsWater
        }
      };

    } catch (error) {
      await this.redis.discard();
      this.logger.error(`[PlantingService] 浇水失败 [${userId}]: ${error.message}`);
      throw error;
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
      const playerKey = this.redis.generateKey('player', userId);
      const playerData = await this.redis.get(playerKey);

      // 执行完整验证
      const validation = this._validateCareOperation(playerData, landId, 'fertilize');
      if (!validation.success) {
        return validation.error;
      }

      const { land } = validation;

      let selectedFertilizer = null;

      if (fertilizerType) {
        // 手动指定肥料
        if (!playerData.inventory[fertilizerType] || playerData.inventory[fertilizerType] <= 0) {
          // 获取肥料名称用于错误提示
          const itemsConfig = this.config.items;
          const fertilizerConfig = itemsConfig.fertilizers[fertilizerType];
          const fertilizerName = fertilizerConfig?.name || fertilizerType;

          // 提供可用肥料列表
          const availableFertilizers = this._getAvailableFertilizers(playerData.inventory);
          const availableList = availableFertilizers.length > 0
            ? `\n可用肥料：${availableFertilizers.join('、')}`
            : '\n仓库中没有任何肥料';

          return {
            success: false,
            message: `仓库中没有${fertilizerName}${availableList}`
          };
        }
        selectedFertilizer = fertilizerType;
      } else {
        // 自动选择最好的肥料
        selectedFertilizer = this._selectBestFertilizer(playerData.inventory);

        if (!selectedFertilizer) {
          return {
            success: false,
            message: '仓库中没有肥料'
          };
        }
      }

      // 获取肥料配置
      const itemsConfig = this.config.items;
      const fertilizerConfig = itemsConfig.fertilizers[selectedFertilizer];

      if (!fertilizerConfig) {
        return {
          success: false,
          message: '肥料配置不存在'
        };
      }

      // 开始事务
      await this.redis.multi();

      // 施肥效果：减少生长时间
      const speedBonus = fertilizerConfig.effect.speedBonus || 0;
      const currentTime = Date.now();
      const remainingTime = land.harvestTime - currentTime;
      const timeReduction = Math.floor(remainingTime * speedBonus);

      land.harvestTime = Math.max(currentTime + 60000, land.harvestTime - timeReduction); // 最少还需1分钟
      land.health = Math.min(100, land.health + 5); // 恢复5点健康度

      // 扣除肥料
      playerData.inventory[selectedFertilizer] -= 1;
      if (playerData.inventory[selectedFertilizer] === 0) {
        delete playerData.inventory[selectedFertilizer];
      }

      playerData.lastUpdated = Date.now();

      // 更新收获计划
      const scheduleKey = this.redis.generateKey('schedule', 'harvest');
      const scheduleMember = `${userId}:${landId}`;
      await this.redis.client.zAdd(scheduleKey, { score: land.harvestTime, value: scheduleMember });

      // 保存玩家数据
      await this.redis.set(playerKey, this.redis.serialize(playerData));

      // 提交事务
      await this.redis.exec();

      const cropsConfig = this.config.crops;
      const cropName = this._getCropName(land.crop, cropsConfig);

      // 区分自动选择和手动选择的日志和消息
      const selectionType = fertilizerType ? '手动选择' : '自动选择';
      this.logger.info(`[PlantingService] 用户${userId}为第${landId}块土地的${cropName}施肥，${selectionType}${fertilizerConfig.name}`);

      const selectionPrefix = fertilizerType ? '使用了指定的' : '自动使用了';
      return {
        success: true,
        message: `成功为第${landId}块土地的${cropName}施肥！${selectionPrefix}${fertilizerConfig.name}，生长时间减少${Math.floor(timeReduction/1000)}秒`,
        data: {
          landId: landId,
          cropName: cropName,
          fertilizerUsed: fertilizerConfig.name,
          selectionType: selectionType,
          timeReduced: timeReduction,
          newHarvestTime: land.harvestTime,
          health: land.health
        }
      };

    } catch (error) {
      await this.redis.discard();
      this.logger.error(`[PlantingService] 施肥失败 [${userId}]: ${error.message}`);
      throw error;
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
      const playerKey = this.redis.generateKey('player', userId);
      const playerData = await this.redis.get(playerKey);

      // 执行完整验证
      const validation = this._validateCareOperation(playerData, landId, 'pesticide');
      if (!validation.success) {
        return validation.error;
      }

      const { land } = validation;

      // 开始事务
      await this.redis.multi();

      // 除虫效果：移除虫害状态，恢复健康度
      land.hasPests = false;
      land.health = Math.min(100, land.health + 15); // 恢复15点健康度
      playerData.lastUpdated = Date.now();

      // 保存玩家数据
      await this.redis.set(playerKey, this.redis.serialize(playerData));

      // 提交事务
      await this.redis.exec();

      const cropsConfig = this.config.crops;
      const cropName = this._getCropName(land.crop, cropsConfig);

      this.logger.info(`[PlantingService] 用户${userId}为第${landId}块土地的${cropName}除虫`);

      return {
        success: true,
        message: `成功为第${landId}块土地的${cropName}除虫！健康度恢复到${land.health}%`,
        data: {
          landId: landId,
          cropName: cropName,
          health: land.health,
          hasPests: land.hasPests
        }
      };

    } catch (error) {
      await this.redis.discard();
      this.logger.error(`[PlantingService] 除虫失败 [${userId}]: ${error.message}`);
      throw error;
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
   * 获取可用肥料列表（用于错误提示）
   * @param {Object} inventory 玩家库存
   * @returns {Array<string>} 可用肥料名称列表
   * @private
   */
  _getAvailableFertilizers(inventory) {
    const itemsConfig = this.config.items;
    const fertilizersConfig = itemsConfig.fertilizers || {};
    const available = [];

    for (const [fertilizerId, config] of Object.entries(fertilizersConfig)) {
      if (inventory[fertilizerId] && inventory[fertilizerId] > 0) {
        available.push(`${config.name}(${inventory[fertilizerId]}个)`);
      }
    }

    return available;
  }

  /**
   * 获取作物名称
   * @param {string} cropType 作物类型
   * @param {Object} cropsConfig 作物配置
   * @returns {string} 作物名称
   */
  _getCropName(cropType, cropsConfig) {
    return cropsConfig[cropType]?.name || cropType;
  }

  /**
   * 计算等级（简化版本，应该与PlayerService保持一致）
   * @param {number} experience 经验值
   * @returns {number} 等级
   */
  _calculateLevel(experience) {
    // 简化的等级计算，实际应该使用与PlayerService相同的逻辑
    return Math.floor(Math.sqrt(experience / 100)) + 1;
  }

  /**
   * 构建收获成功消息
   * @param {Array} harvestedCrops 收获的作物列表
   * @param {number} totalExp 总经验
   * @returns {string} 收获消息
   */
  _buildHarvestMessage(harvestedCrops, totalExp) {
    const messages = ['🎉 收获成功！'];
    
    for (const crop of harvestedCrops) {
      messages.push(`[${crop.landId}] ${crop.cropName} x${crop.yield}`);
    }
    
    if (totalExp > 0) {
      messages.push(`✨ 获得经验: ${totalExp}`);
    }
    
    return messages.join('\n');
  }

  /**
   * 格式化时间显示
   * @param {Date} date 日期对象
   * @returns {string} 格式化的时间
   */
  _formatTime(date) {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #45b71863, converting CommonJS module.exports to ES Modules export; Principle_Applied: ModuleSystem-Standardization;}}
export { PlantingService };