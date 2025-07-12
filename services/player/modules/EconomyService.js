/**
 * 经济系统服务
 * 负责金币管理、经验值处理、升级逻辑等经济相关功能
 */

import LevelCalculator from '../utils/LevelCalculator.js';

class EconomyService {
  constructor(playerDataService, config, logger = null) {
    this.playerDataService = playerDataService;
    this.config = config;
    this.logger = logger || console;
    this.levelCalculator = new LevelCalculator(config);
  }

  /**
   * 添加金币
   * @param {string} userId 用户ID
   * @param {number} amount 金币数量（可为负数）
   * @returns {Object} 更新后的玩家数据
   */
  async addCoins(userId, amount) {
    try {
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        if (!playerData) {
          throw new Error('玩家不存在');
        }
        
        // 计算新的金币数量（确保不为负数）
        const newCoins = Math.max(0, playerData.coins + amount);
        const actualChange = newCoins - playerData.coins;
        
        // 更新统计数据
        if (actualChange > 0) {
          playerData.statistics.totalMoneyEarned += actualChange;
        } else if (actualChange < 0) {
          playerData.statistics.totalMoneySpent += Math.abs(actualChange);
        }
        
        playerData.coins = newCoins;
        playerData.lastUpdated = Date.now();

        // 使用序列化器统一处理
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));
        
        this.logger.info(`[EconomyService] 玩家 ${userId} 金币变化: ${amount > 0 ? '+' : ''}${actualChange}, 当前: ${newCoins}`);
        return playerData;
      });
    } catch (error) {
      this.logger.error(`[EconomyService] 添加金币失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 添加经验值并处理升级
   * @param {string} userId 用户ID
   * @param {number} amount 经验值
   * @returns {Object} 包含玩家数据和升级信息的对象
   */
  async addExp(userId, amount) {
    try {
      return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        if (!playerData) {
          throw new Error('玩家不存在');
        }
        
        const oldLevel = playerData.level;
        
        // 添加经验值
        playerData.experience += amount;
        
        // 计算新等级
        const levelResult = this.levelCalculator.calculateLevel(playerData.experience);
        const newLevel = levelResult.level;
        
        let levelUpInfo = null;
        
        // 如果等级提升，处理升级奖励
        if (newLevel > oldLevel) {
          levelUpInfo = await this._handleLevelUp(playerData, oldLevel, newLevel);
        }
        
        playerData.level = newLevel;
        playerData.lastUpdated = Date.now();

        // 使用序列化器统一处理
        const serializer = this.playerDataService.getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));
        
        this.logger.info(`[EconomyService] 玩家 ${userId} 经验变化: +${amount}, 当前: ${playerData.experience} (等级 ${newLevel})`);
        
        if (levelUpInfo) {
          this.logger.info(`[EconomyService] 玩家 ${userId} 升级: ${oldLevel} -> ${newLevel}`);
        }
        
        return {
          player: playerData,
          levelUp: levelUpInfo
        };
      });
    } catch (error) {
      this.logger.error(`[EconomyService] 添加经验失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 处理等级提升奖励
   * @param {Object} playerData 玩家数据
   * @param {number} oldLevel 旧等级
   * @param {number} newLevel 新等级
   * @returns {Object} 升级信息
   */
  async _handleLevelUp(playerData, oldLevel, newLevel) {
    const rewards = this.levelCalculator.getLevelUpRewards(oldLevel, newLevel);
    const unlockedItems = this.levelCalculator.getUnlockedItems(oldLevel, newLevel);

    // 应用奖励
    playerData.coins += rewards.totalCoins;
    // 注意：土地槽位现在只通过土地扩展系统管理，不再通过等级奖励增加

    // 更新统计
    playerData.statistics.totalMoneyEarned += rewards.totalCoins;

    return {
      oldLevel,
      newLevel,
      rewards,
      unlockedItems
    };
  }

  /**
   * 获取玩家等级详细信息
   * @param {string} userId 用户ID
   * @returns {Object} 等级信息
   */
  async getPlayerLevelInfo(userId) {
    try {
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      
      if (!playerData) {
        throw new Error('玩家不存在');
      }
      
      const levelInfo = this.levelCalculator.getPlayerLevelInfo(playerData.level, playerData.experience);
      
      return {
        ...levelInfo,
        landCount: playerData.landCount,
        maxLandCount: playerData.maxLandCount,
        inventoryCapacity: playerData.inventoryCapacity,
        maxInventoryCapacity: playerData.maxInventoryCapacity
      };
    } catch (error) {
      this.logger.error(`[EconomyService] 获取等级信息失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查是否有足够的金币
   * @param {string} userId 用户ID
   * @param {number} amount 需要的金币数量
   * @returns {Object} 检查结果
   */
  async hasEnoughCoins(userId, amount) {
    try {
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      
      if (!playerData) {
        return {
          hasEnough: false,
          currentCoins: 0,
          needed: amount,
          shortage: amount
        };
      }
      
      const hasEnough = playerData.coins >= amount;
      
      return {
        hasEnough,
        currentCoins: playerData.coins,
        needed: amount,
        shortage: hasEnough ? 0 : amount - playerData.coins
      };
    } catch (error) {
      this.logger.error(`[EconomyService] 检查金币失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 扣除金币（安全扣除，确保不会为负数）
   *
   * @deprecated 此方法存在事务嵌套问题，不推荐在新代码中使用
   *
   * **问题说明：**
   * 该方法先调用 hasEnoughCoins 检查，然后调用 addCoins 扣款，
   * 在高并发场景下可能导致竞态条件和事务嵌套问题。
   *
   * **推荐替代方案：**
   * 在业务服务的事务中直接使用 _updateCoinsInTransaction 方法：
   *
   * ```javascript
   * // 旧方式（不推荐）
   * await this.economyService.deductCoins(userId, amount);
   *
   * // 新方式（推荐）
   * return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
   *   const playerData = await this.playerDataService.getPlayerFromHash(userId);
   *
   *   // 检查金币是否足够
   *   if (playerData.coins < amount) {
   *     throw new Error(`金币不足！需要 ${amount} 金币，当前拥有: ${playerData.coins}`);
   *   }
   *
   *   // 扣除金币
   *   const actualChange = this.economyService._updateCoinsInTransaction(playerData, -amount);
   *
   *   // 其他业务逻辑...
   *
   *   // 保存数据
   *   const serializer = this.playerDataService.getSerializer();
   *   multi.hSet(playerKey, serializer.serializeForHash(playerData));
   * });
   * ```
   *
   * @param {string} userId 用户ID
   * @param {number} amount 扣除金币数量
   * @returns {Object} 扣除结果
   */
  async deductCoins(userId, amount) {
    // 开发环境警告
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[EconomyService] deductCoins方法已被标记为deprecated，请使用事务内的_updateCoinsInTransaction方法替代');
    }

    try {
      const checkResult = await this.hasEnoughCoins(userId, amount);

      if (!checkResult.hasEnough) {
        return {
          success: false,
          message: `金币不足！需要 ${amount} 金币，当前拥有: ${checkResult.currentCoins}`,
          shortage: checkResult.shortage
        };
      }

      const playerData = await this.addCoins(userId, -amount);

      return {
        success: true,
        message: `成功扣除 ${amount} 金币`,
        remainingCoins: playerData.coins,
        deductedAmount: amount
      };
    } catch (error) {
      this.logger.error(`[EconomyService] 扣除金币失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取经验值来源配置
   * @returns {Object} 经验值来源配置
   */
  getExperienceSources() {
    return this.levelCalculator.getExperienceSources();
  }

  /**
   * 计算到达目标等级需要的经验值
   * @param {string} userId 用户ID
   * @param {number} targetLevel 目标等级
   * @returns {Object} 计算结果
   */
  async getExpToLevel(userId, targetLevel) {
    try {
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      
      if (!playerData) {
        throw new Error('玩家不存在');
      }
      
      return this.levelCalculator.getExpToLevel(playerData.experience, targetLevel);
    } catch (error) {
      this.logger.error(`[EconomyService] 计算升级经验失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取玩家财务统计
   * @param {string} userId 用户ID
   * @returns {Object} 财务统计
   */
  async getFinancialStats(userId) {
    try {
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      
      if (!playerData) {
        throw new Error('玩家不存在');
      }
      
      return {
        currentCoins: playerData.coins,
        totalEarned: playerData.statistics.totalMoneyEarned,
        totalSpent: playerData.statistics.totalMoneySpent,
        netWorth: playerData.statistics.totalMoneyEarned - playerData.statistics.totalMoneySpent,
        currentLevel: playerData.level,
        currentExp: playerData.experience
      };
    } catch (error) {
      this.logger.error(`[EconomyService] 获取财务统计失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 在事务上下文中更新金币和统计数据（内部方法）
   * 该方法用于在已有事务中直接操作玩家数据，避免事务嵌套
   * @param {Object} playerData 玩家数据对象
   * @param {number} amount 金币变化量（可为负数）
   * @returns {number} 实际变化量
   * @private
   */
  _updateCoinsInTransaction(playerData, amount) {
    if (!playerData) {
      throw new Error('玩家数据不能为空');
    }

    // 计算新的金币数量（确保不为负数）
    const newCoins = Math.max(0, playerData.coins + amount);
    const actualChange = newCoins - playerData.coins;

    // 更新统计数据
    if (actualChange > 0) {
      playerData.statistics.totalMoneyEarned += actualChange;
    } else if (actualChange < 0) {
      playerData.statistics.totalMoneySpent += Math.abs(actualChange);
    }

    // 更新金币数量
    playerData.coins = newCoins;
    playerData.lastUpdated = Date.now();

    return actualChange;
  }
}

export default EconomyService;
