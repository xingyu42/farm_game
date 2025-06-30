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
}

module.exports = { LandService }; 