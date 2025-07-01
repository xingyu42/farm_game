/**
 * 土地管理服务 - 管理土地扩张、品质升级等功能（根据PRD v3.2设计）
 * 包含：土地扩张、品质升级、信息查询等功能
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:30:00+08:00; Reason: Shrimp Task ID: #b7430efe, implementing land management service for T6;
// }}

class LandService {
  constructor(redisClient, config, playerService, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.playerService = playerService;
    this.logger = logger || console;
  }

  /**
   * 扩张土地（调用PlayerService的扩张方法）
   * @param {string} userId 用户ID
   * @returns {Object} 扩张结果
   */
  async expandLand(userId) {
    try {
      // 直接调用PlayerService的扩张方法
      const result = await this.playerService.expandLand(userId);
      
      this.logger.info(`[LandService] 玩家 ${userId} 土地扩张结果: ${result.success ? '成功' : '失败'}`);
      
      return result;
    } catch (error) {
      this.logger.error(`[LandService] 土地扩张失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取土地扩张信息
   * @param {string} userId 用户ID
   * @returns {Object} 土地信息
   */
  async getLandExpansionInfo(userId) {
    try {
      const playerData = await this.playerService.getPlayerData(userId);
      
      // 检查是否可以扩张
      const canExpand = playerData.landCount < playerData.maxLandCount;
      
      if (!canExpand) {
        return {
          canExpand: false,
          currentLandCount: playerData.landCount,
          maxLandCount: playerData.maxLandCount
        };
      }
      
      // 获取下一块土地的配置
      const nextLandNumber = playerData.landCount + 1;
      const landConfig = this.config.land?.expansion?.[nextLandNumber];
      
      if (!landConfig) {
        this.logger.warn(`[LandService] 找不到第 ${nextLandNumber} 块土地的配置`);
        return {
          canExpand: false,
          error: '无法获取土地扩张配置'
        };
      }
      
      // 检查是否满足扩张条件
      const meetsLevelRequirement = playerData.level >= landConfig.levelRequired;
      const meetsGoldRequirement = playerData.coins >= landConfig.goldCost;
      const meetsRequirements = meetsLevelRequirement && meetsGoldRequirement;
      
      return {
        canExpand: true,
        nextLandNumber,
        nextCost: landConfig.goldCost,
        nextLevelRequired: landConfig.levelRequired,
        meetsRequirements,
        meetsLevelRequirement,
        meetsGoldRequirement,
        currentLandCount: playerData.landCount,
        maxLandCount: playerData.maxLandCount,
        currentLevel: playerData.level,
        currentCoins: playerData.coins
      };
    } catch (error) {
      this.logger.error(`[LandService] 获取土地扩张信息失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取土地配置信息
   * @param {number} landNumber 土地编号
   * @returns {Object} 土地配置
   */
  getLandConfig(landNumber) {
    try {
      return this.config.land?.expansion?.[landNumber] || null;
    } catch (error) {
      this.logger.error(`[LandService] 获取土地配置失败 [${landNumber}]: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取土地扩张成本列表（用于显示扩张计划）
   * @param {string} userId 用户ID
   * @param {number} count 显示数量（默认5）
   * @returns {Array} 扩张成本列表
   */
  async getLandExpansionPlan(userId, count = 5) {
    try {
      const playerData = await this.playerService.getPlayerData(userId);
      const expansionPlan = [];
      
      for (let i = 1; i <= count; i++) {
        const landNumber = playerData.landCount + i;
        
        if (landNumber > playerData.maxLandCount) {
          break;
        }
        
        const landConfig = this.getLandConfig(landNumber);
        
        if (landConfig) {
          expansionPlan.push({
            landNumber,
            levelRequired: landConfig.levelRequired,
            goldCost: landConfig.goldCost,
            meetsLevelRequirement: playerData.level >= landConfig.levelRequired,
            meetsGoldRequirement: playerData.coins >= landConfig.goldCost
          });
        }
      }
      
      return expansionPlan;
    } catch (error) {
      this.logger.error(`[LandService] 获取土地扩张计划失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取土地系统配置
   * @returns {Object} 土地系统配置
   */
  getLandSystemConfig() {
    try {
      return {
        startingLands: this.config.land?.default?.startingLands || 6,
        maxLands: this.config.land?.default?.maxLands || 24,
        expansionConfig: this.config.land?.expansion || {},
        qualityConfig: this.config.land?.quality || {}
      };
    } catch (error) {
      this.logger.error(`[LandService] 获取土地系统配置失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 验证土地扩张条件
   * @param {string} userId 用户ID
   * @returns {Object} 验证结果
   */
  async validateExpansionConditions(userId) {
    try {
      const playerData = await this.playerService.getPlayerData(userId);
      const expansionInfo = await this.getLandExpansionInfo(userId);
      
      if (!expansionInfo.canExpand) {
        return {
          valid: false,
          reason: '已达到最大土地数量',
          details: expansionInfo
        };
      }
      
      const issues = [];
      
      if (!expansionInfo.meetsLevelRequirement) {
        issues.push(`等级不足，需要 ${expansionInfo.nextLevelRequired} 级，当前 ${playerData.level} 级`);
      }
      
      if (!expansionInfo.meetsGoldRequirement) {
        issues.push(`金币不足，需要 ${expansionInfo.nextCost} 金币，当前 ${playerData.coins} 金币`);
      }
      
      return {
        valid: issues.length === 0,
        reason: issues.length > 0 ? issues.join('；') : '满足所有条件',
        issues,
        details: expansionInfo
      };
    } catch (error) {
      this.logger.error(`[LandService] 验证土地扩张条件失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取土地品质进阶信息
   * @param {string} userId 用户ID
   * @param {number} landId 土地ID (1-based)
   * @returns {Object} 进阶信息
   */
  async getLandQualityUpgradeInfo(userId, landId) {
    try {
      const playerData = await this.playerService.getPlayerData(userId);

      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:18:25 +08:00; Reason: Shrimp Task ID: #7d70e3a3, fixing data structure inconsistency - changing object access to array access; Principle_Applied: DataStructure-Consistency;}}
      // 验证土地ID和数据结构
      if (!Array.isArray(playerData.lands)) {
        return {
          canUpgrade: false,
          error: `玩家土地数据结构异常，请联系管理员`
        };
      }

      if (landId < 1 || landId > playerData.lands.length) {
        return {
          canUpgrade: false,
          error: `无效的土地编号 ${landId}，您只有 ${playerData.lands.length} 块土地`
        };
      }

      // 获取土地数据 - 修复：使用数组索引而非对象键
      const land = playerData.lands[landId - 1];

      if (!land) {
        return {
          canUpgrade: false,
          error: `土地 ${landId} 数据不存在`
        };
      }
      
      const currentQuality = land.quality || 'normal';
      
      // 获取品质配置
      const qualityConfig = this.config.land?.quality || {};
      const currentConfig = qualityConfig[currentQuality];
      
      if (!currentConfig) {
        return {
          canUpgrade: false,
          error: `未知的土地品质: ${currentQuality}`
        };
      }
      
      // 确定下一个品质级别
      const qualityOrder = ['normal', 'copper', 'silver', 'gold'];
      const currentIndex = qualityOrder.indexOf(currentQuality);
      
      if (currentIndex === -1 || currentIndex >= qualityOrder.length - 1) {
        return {
          canUpgrade: false,
          reason: '土地已达到最高品质',
          currentQuality,
          currentQualityName: currentConfig.name
        };
      }
      
      const nextQuality = qualityOrder[currentIndex + 1];
      const nextConfig = qualityConfig[nextQuality];
      
      if (!nextConfig) {
        return {
          canUpgrade: false,
          error: `下一级品质配置不存在: ${nextQuality}`
        };
      }
      
      // 检查进阶条件
      const meetsLevelRequirement = playerData.level >= nextConfig.levelRequired;
      const meetsGoldRequirement = playerData.coins >= nextConfig.goldCost;
      
      // 检查材料需求
      let meetsMaterialRequirement = true;
      const materialIssues = [];
      
      if (nextConfig.materials && nextConfig.materials.length > 0) {
        for (const material of nextConfig.materials) {
          const inventory = playerData.inventory || {};
          const currentQuantity = inventory[material.item_id]?.quantity || 0;
          
          if (currentQuantity < material.quantity) {
            meetsMaterialRequirement = false;
            materialIssues.push(`缺少 ${this._getItemName(material.item_id)} ${material.quantity - currentQuantity} 个`);
          }
        }
      }
      
      const meetsAllRequirements = meetsLevelRequirement && meetsGoldRequirement && meetsMaterialRequirement;
      
      return {
        canUpgrade: true,
        landId,
        currentQuality,
        currentQualityName: currentConfig.name,
        nextQuality,
        nextQualityName: nextConfig.name,
        requirements: {
          level: nextConfig.levelRequired,
          gold: nextConfig.goldCost,
          materials: nextConfig.materials || []
        },
        meetsAllRequirements,
        meetsLevelRequirement,
        meetsGoldRequirement,
        meetsMaterialRequirement,
        materialIssues,
        playerStatus: {
          level: playerData.level,
          coins: playerData.coins,
          inventory: playerData.inventory || {}
        }
      };
    } catch (error) {
      this.logger.error(`[LandService] 获取土地品质进阶信息失败 [${userId}, ${landId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 执行土地品质进阶
   * @param {string} userId 用户ID
   * @param {number} landId 土地ID (1-based)
   * @returns {Object} 进阶结果
   */
  async upgradeLandQuality(userId, landId) {
    try {
      // 获取进阶信息
      const upgradeInfo = await this.getLandQualityUpgradeInfo(userId, landId);
      
      if (!upgradeInfo.canUpgrade) {
        return {
          success: false,
          message: upgradeInfo.error || upgradeInfo.reason || '无法进阶'
        };
      }
      
      if (!upgradeInfo.meetsAllRequirements) {
        const issues = [];
        
        if (!upgradeInfo.meetsLevelRequirement) {
          issues.push(`等级不足，需要 ${upgradeInfo.requirements.level} 级，当前 ${upgradeInfo.playerStatus.level} 级`);
        }
        
        if (!upgradeInfo.meetsGoldRequirement) {
          issues.push(`金币不足，需要 ${upgradeInfo.requirements.gold} 金币，当前 ${upgradeInfo.playerStatus.coins} 金币`);
        }
        
        if (upgradeInfo.materialIssues.length > 0) {
          issues.push(...upgradeInfo.materialIssues);
        }
        
        return {
          success: false,
          message: `进阶条件不满足：${issues.join('；')}`
        };
      }
      
      // 执行进阶（Redis事务）
      const playerKey = this.redis.generateKey('player', userId);
      
      // 获取当前玩家数据进行二次验证
      const playerData = await this.redis.get(playerKey);
      
      if (!playerData) {
        return {
          success: false,
          message: '玩家不存在'
        };
      }
      
      // 再次验证条件（防止并发问题）
      if (playerData.level < upgradeInfo.requirements.level || playerData.coins < upgradeInfo.requirements.gold) {
        return {
          success: false,
          message: '进阶条件已不满足，请重试'
        };
      }
      
      // 验证材料
      for (const material of upgradeInfo.requirements.materials) {
        const currentQuantity = playerData.inventory?.[material.item_id]?.quantity || 0;
        if (currentQuantity < material.quantity) {
          return {
            success: false,
            message: `材料不足：${this._getItemName(material.item_id)}`
          };
        }
      }
      
      // 扣除金币
      playerData.coins -= upgradeInfo.requirements.gold;
      
      // 消耗材料
      for (const material of upgradeInfo.requirements.materials) {
        if (playerData.inventory && playerData.inventory[material.item_id]) {
          playerData.inventory[material.item_id].quantity -= material.quantity;
          
          // 如果数量为0，删除物品记录
          if (playerData.inventory[material.item_id].quantity <= 0) {
            delete playerData.inventory[material.item_id];
          }
        }
      }
      
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:18:25 +08:00; Reason: Shrimp Task ID: #7d70e3a3, fixing data structure inconsistency - changing object access to array access; Principle_Applied: DataStructure-Consistency;}}
      // 更新土地品质 - 修复：使用数组索引而非对象键
      if (!Array.isArray(playerData.lands)) {
        return {
          success: false,
          message: '玩家土地数据结构异常，请联系管理员'
        };
      }

      // 确保土地索引有效
      if (landId < 1 || landId > playerData.lands.length) {
        return {
          success: false,
          message: `无效的土地编号 ${landId}`
        };
      }

      // 使用数组索引访问土地数据
      const landIndex = landId - 1;
      if (!playerData.lands[landIndex]) {
        // 如果土地对象不存在，初始化它
        playerData.lands[landIndex] = {
          id: landId,
          crop: null,
          quality: 'normal',
          plantTime: null,
          harvestTime: null,
          status: 'empty'
        };
      }

      playerData.lands[landIndex].quality = upgradeInfo.nextQuality;
      playerData.lands[landIndex].lastUpgraded = Date.now();
      
      // 保存数据
      playerData.lastUpdated = Date.now();
      await this.redis.set(playerKey, playerData);
      
      this.logger.info(`[LandService] 玩家 ${userId} 土地 ${landId} 品质进阶: ${upgradeInfo.currentQuality} -> ${upgradeInfo.nextQuality}`);
      
      return {
        success: true,
        message: `🎉 土地 ${landId} 成功进阶为${upgradeInfo.nextQualityName}！`,
        landId,
        fromQuality: upgradeInfo.currentQuality,
        toQuality: upgradeInfo.nextQuality,
        fromQualityName: upgradeInfo.currentQualityName,
        toQualityName: upgradeInfo.nextQualityName,
        costGold: upgradeInfo.requirements.gold,
        materialsCost: upgradeInfo.requirements.materials,
        remainingCoins: playerData.coins
      };
    } catch (error) {
      this.logger.error(`[LandService] 土地品质进阶失败 [${userId}, ${landId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取物品名称（辅助方法）
   * @param {string} itemId 物品ID
   * @returns {string} 物品名称
   */
  _getItemName(itemId) {
    try {
      // 尝试从各个配置分类中查找物品
      const itemsConfig = this.config.items || {};
      
      // 查找顺序：landMaterials, seeds, tools, fertilizers
      const categories = ['landMaterials', 'seeds', 'tools', 'fertilizers'];
      
      for (const category of categories) {
        if (itemsConfig[category] && itemsConfig[category][itemId]) {
          return itemsConfig[category][itemId].name || itemId;
        }
      }
      
      // 如果都找不到，返回ID
      return itemId;
    } catch (error) {
      this.logger.warn(`[LandService] 获取物品名称失败 [${itemId}]: ${error.message}`);
      return itemId;
    }
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #45b71863, converting CommonJS module.exports to ES Modules export; Principle_Applied: ModuleSystem-Standardization;}}
export { LandService };