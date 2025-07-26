/**
 * 土地管理服务 - 管理土地扩张、品质升级等功能（根据PRD v3.2设计）
 * 包含：土地扩张、品质升级、信息查询等功能
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:30:00+08:00; Reason: Shrimp Task ID: #b7430efe, implementing land management service for T6;
// }}

import ItemResolver from '../utils/ItemResolver.js';

class LandService {
  constructor(redisClient, config, playerService, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.playerService = playerService;
    this.logger = logger || console;
    this.itemResolver = new ItemResolver(config);
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
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 14:26:17 +08:00; Reason: Shrimp Task ID: #3e65c249, using smart land access methods for improved code structure; Principle_Applied: CodeStructure-Optimization;}}
      // 使用智能土地访问方法验证土地ID
      const validation = await this.playerService.validateLandId(userId, landId);
      if (!validation.valid) {
        return {
          canUpgrade: false,
          error: validation.message
        };
      }

      // 获取玩家数据
      const playerData = await this.playerService.getPlayerData(userId);
      if (!playerData) {
        return {
          canUpgrade: false,
          error: '玩家数据不存在'
        };
      }

      // 使用智能土地访问方法获取土地数据
      const land = await this.playerService.getLandById(userId, landId);
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
      
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 14:26:17 +08:00; Reason: Shrimp Task ID: #3e65c249, using smart land update method for improved code structure; Principle_Applied: CodeStructure-Optimization;}}
      // 使用智能土地更新方法
      const updateResult = await this.playerService.updateLand(userId, landId, {
        quality: upgradeInfo.nextQuality,
        lastUpgraded: Date.now()
      });

      if (!updateResult.success) {
        return {
          success: false,
          message: updateResult.message
        };
      }
      
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
   * 获取物品名称（使用统一的ItemResolver）
   * @param {string} itemId 物品ID
   * @returns {string} 物品名称
   */
  _getItemName(itemId) {
    try {
      return this.itemResolver.getItemName(itemId);
    } catch (error) {
      this.logger.warn(`[LandService] 获取物品名称失败 [${itemId}]: ${error.message}`);
      return itemId;
    }
  }

  /**
   * 执行土地强化
   * @param {string} userId 用户ID
   * @param {number} landId 土地ID
   * @returns {Object} 强化结果
   */
  async enhanceLand(userId, landId) {
    const lock = await this.redis.lock(`player:${userId}:lock`);
    if (!lock) {
      return { success: false, message: '系统繁忙，请稍后再试。' };
    }

    try {
      const validation = await this.playerService.validateLandId(userId, landId);
      if (!validation.valid) {
        return { success: false, message: validation.message };
      }

      const player = await this.playerService.getPlayer(userId);
      const land = player.lands[landId - 1];
      const enhancementConfig = this.config.land?.enhancement;

      if (!enhancementConfig) {
        return { success: false, message: '未找到土地强化配置。' };
      }

      const currentLevel = land.enhancementLevel || 0;
      if (currentLevel >= enhancementConfig.maxLevel) {
        return { success: false, message: '该土地已达到最大强化等级。' };
      }

      const nextLevel = currentLevel + 1;
      const cost = enhancementConfig.costs?.[land.quality]?.[nextLevel];

      if (cost === undefined) {
        return { success: false, message: `未找到${land.quality}品质土地强化到${nextLevel}级的成本配置。` };
      }

      if (player.coins < cost) {
        return { success: false, message: `金币不足，强化需要 ${cost} 金币，当前拥有 ${player.coins} 金币。` };
      }

      // 扣除金币并更新土地强化等级
      player.coins -= cost;
      land.enhancementLevel = nextLevel;

      await this.playerService.updatePlayer(userId, player);

      const bonus = enhancementConfig.bonusPerLevel * nextLevel;

      return {
        success: true,
        message: `🎉 土地 ${landId} 强化成功！等级: ${nextLevel}，总加成: +${bonus}%`,
        landId,
        newLevel: nextLevel,
        cost,
        remainingCoins: player.coins
      };
    } catch (error) {
      this.logger.error(`[LandService] 土地强化失败 [${userId}, ${landId}]: ${error.message}`);
      throw error;
    } finally {
      await this.redis.unlock(lock);
    }
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #45b71863, converting CommonJS module.exports to ES Modules export; Principle_Applied: ModuleSystem-Standardization;}}
export { LandService };