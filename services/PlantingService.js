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
      const cropsConfig = await this.config.getCropsConfig();
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
      
      if (!playerData) {
        return {
          success: false,
          message: '玩家数据不存在'
        };
      }

      // 验证等级要求
      if (playerData.level < cropConfig.requiredLevel) {
        return {
          success: false,
          message: `种植${cropConfig.name}需要${cropConfig.requiredLevel}级，当前等级：${playerData.level}`
        };
      }

      // 验证土地状态
      const landIndex = landId - 1;
      if (landIndex < 0 || landIndex >= playerData.lands.length) {
        return {
          success: false,
          message: `土地编号${landId}不存在`
        };
      }

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

      // 开始事务
      await this.redis.multi();

      // 更新土地状态
      playerData.lands[landIndex] = {
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
      
      if (!playerData) {
        return {
          success: false,
          message: '玩家数据不存在'
        };
      }

      const now = Date.now();
      const cropsConfig = await this.config.getCropsConfig();
      const landConfig = await this.config.getLandConfig();
      
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
   * 更新所有玩家的作物状态（定时任务调用）
   * @returns {Object} 更新结果
   */
  async updateAllCropsStatus() {
    try {
      // 这个方法会被定时任务调用，用于更新作物成熟状态
      const now = Date.now();
      let updatedPlayers = 0;

      // 获取所有玩家的keys
      const playerKeys = await this.redis.keys(this.redis.generateKey('player', '*'));
      
      for (const playerKey of playerKeys) {
        const playerData = await this.redis.get(playerKey);
        if (!playerData || !playerData.lands) continue;

        let hasUpdates = false;

        for (let i = 0; i < playerData.lands.length; i++) {
          const land = playerData.lands[i];
          
          if (land.crop && land.harvestTime && land.status === 'growing') {
            if (now >= land.harvestTime) {
              // 作物成熟
              land.status = 'mature';
              land.stealable = true;
              hasUpdates = true;
            }
          }
        }

        if (hasUpdates) {
          await this.redis.set(playerKey, this.redis.serialize(playerData));
          updatedPlayers++;
        }
      }

      this.logger.info(`[PlantingService] 更新了${updatedPlayers}个玩家的作物状态`);
      
      return {
        success: true,
        updatedPlayers: updatedPlayers
      };

    } catch (error) {
      this.logger.error(`[PlantingService] 更新作物状态失败: ${error.message}`);
      throw error;
    }
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

module.exports = { PlantingService }; 