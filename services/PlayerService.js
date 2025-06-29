/**
 * 玩家服务 - 管理玩家核心数据（根据PRD v3.2设计）
 * 包含：等级、经验、金币、土地、仓库、签到、防御状态等
 */

class PlayerService {
  constructor(redisClient, config, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.logger = logger || console;
  }

  /**
   * 获取玩家数据，如果不存在则创建新玩家
   * @param {string} userId 用户ID
   * @returns {Object} 玩家数据
   */
  async getPlayer(userId) {
    try {
      // 生成玩家数据的Redis Key
      const playerKey = this.redis.generateKey('player', userId);
      
      // 尝试从Redis获取玩家数据
      let playerData = await this.redis.get(playerKey);
      
      // 如果玩家不存在，创建新玩家
      if (!playerData) {
        playerData = this._createNewPlayer();
        await this.redis.set(playerKey, playerData);
        this.logger.info(`[PlayerService] 创建新玩家: ${userId}`);
        
        // 发放初始礼包
        await this._giveInitialGift(userId, playerData);
      }
      
      return playerData;
    } catch (error) {
      this.logger.error(`[PlayerService] 获取玩家数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取增强后的玩家数据（包含辅助方法）
   * @param {string} userId 用户ID
   * @returns {Object} 增强后的玩家数据
   */
  async getPlayerData(userId) {
    try {
      const playerData = await this.getPlayer(userId);
      return this._addPlayerDataMethods(playerData);
    } catch (error) {
      this.logger.error(`[PlayerService] 获取增强玩家数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 确保玩家存在（如果不存在则创建）
   * @param {string} userId 用户ID
   * @param {string} userName 用户名
   * @returns {Object} 玩家数据
   */
  async ensurePlayer(userId, userName = null) {
    try {
      const playerData = await this.getPlayerData(userId);
      
      // 如果提供了用户名且玩家名称为空，更新名称
      if (userName && !playerData.name) {
        playerData.name = userName;
        const playerKey = this.redis.generateKey('player', userId);
        await this.redis.set(playerKey, this.redis.serialize(playerData));
      }
      
      return playerData;
    } catch (error) {
      this.logger.error(`[PlayerService] 确保玩家存在失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 创建玩家（显式创建）
   * @param {string} userId 用户ID
   * @param {string} userName 用户名
   * @returns {Object} 新玩家数据
   */
  async createPlayer(userId, userName) {
    try {
      // 检查玩家是否已存在
      const existingPlayer = await this.getPlayerData(userId);
      if (existingPlayer) {
        return existingPlayer;
      }
      
      // 创建新玩家
      const playerData = this._createNewPlayer();
      playerData.name = userName;
      
      const playerKey = this.redis.generateKey('player', userId);
      await this.redis.set(playerKey, this.redis.serialize(playerData));
      
      this.logger.info(`[PlayerService] 显式创建新玩家: ${userId} (${userName})`);
      
      // 发放初始礼包
      await this._giveInitialGift(userId, playerData);
      
      return this._addPlayerDataMethods(playerData);
    } catch (error) {
      this.logger.error(`[PlayerService] 创建玩家失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 每日签到
   * @param {string} userId 用户ID
   * @returns {Object} 签到结果
   */
  async dailySignIn(userId) {
    try {
      return await this.signIn(userId);
    } catch (error) {
      this.logger.error(`[PlayerService] 每日签到失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 创建新玩家数据
   * @returns {Object} 新玩家数据
   */
  _createNewPlayer() {
    const defaultConfig = this.config.levels?.default || {};
    const landConfig = this.config.land?.default || {};
    const inventoryConfig = this.config.items?.inventory || {};
    
    const now = Date.now();
    
    return {
      // 基础信息
      name: '',                                         // 玩家名称
      level: 1,
      experience: 0,
      coins: defaultConfig.startingCoins || 100,       // 保持coins兼容性
      
      // 向后兼容的金币访问
      get gold() { return this.coins; },
      set gold(value) { this.coins = value; },
      
      // 土地系统
      landCount: landConfig.startingLands || 6,        // 当前土地数量
      lands: new Array(landConfig.startingLands || 6).fill(null).map((_, i) => ({
        id: i + 1,
        crop: null,
        quality: 'normal',
        plantTime: null,
        harvestTime: null,
        status: 'empty'
      })),
      maxLandCount: landConfig.maxLands || 24,         // 最大土地数量
      
      // 仓库系统
      inventory: {},                                   // 仓库物品
      inventoryCapacity: inventoryConfig.startingCapacity || 20,  // 保持原字段名
      inventory_capacity: inventoryConfig.startingCapacity || 20, // 新字段名
      maxInventoryCapacity: inventoryConfig.maxCapacity || 200,
      
      // 统计数据（向后兼容）
      stats: {
        total_signin_days: 0,                         // 总签到天数
        total_income: 0,                              // 总收入
        total_expenses: 0,                            // 总支出
        consecutive_signin_days: 0                    // 连续签到天数
      },
      
      // 签到系统
      signIn: {
        lastSignDate: null,               // 最后签到日期
        consecutiveDays: 0,               // 连续签到天数
        totalSignDays: 0                  // 总签到天数
      },
      
      // 防御系统
      protection: {
        dogFood: {
          type: null,                     // 狗粮类型 (null/normal/premium/deluxe)
          effectEndTime: 0,               // 防御效果结束时间
          defenseBonus: 0                 // 防御加成百分比
        },
        farmProtection: {
          endTime: 0                      // 农场保护结束时间
        }
      },
      
      // 偷菜系统
      stealing: {
        lastStealTime: 0,                 // 最后偷菜时间
        cooldownEndTime: 0                // 冷却结束时间
      },
      
      // 统计数据
      statistics: {
        totalHarvested: 0,                // 总收获次数
        totalStolenFrom: 0,               // 被偷次数
        totalStolenBy: 0,                 // 偷菜次数
        totalMoneyEarned: 0,              // 总赚取金币
        totalMoneySpent: 0                // 总花费金币
      },
      
      // 时间戳
      createdAt: now,
      lastUpdated: now,
      lastActiveTime: now
    };
  }

  /**
   * 发放初始礼包
   * @param {string} userId 用户ID
   * @param {Object} playerData 玩家数据
   */
  async _giveInitialGift(userId, playerData) {
    try {
      const initialGift = this.config.items?.initial_gift || [];
      
      if (initialGift.length > 0) {
        // 这里应该调用InventoryService来添加物品
        // 暂时记录日志，实际实现需要等InventoryService完成
        this.logger.info(`[PlayerService] 为新玩家 ${userId} 准备初始礼包: ${JSON.stringify(initialGift)}`);
        // TODO: await inventoryService.addItems(userId, initialGift);
      }
    } catch (error) {
      this.logger.error(`[PlayerService] 发放初始礼包失败 [${userId}]: ${error.message}`);
    }
  }

  /**
   * 添加金币
   * @param {string} userId 用户ID
   * @param {number} amount 金币数量（可为负数）
   * @returns {Object} 更新后的玩家数据
   */
  async addCoins(userId, amount) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.getPlayer(userId);
        
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
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[PlayerService] 玩家 ${userId} 金币变化: ${amount > 0 ? '+' : ''}${actualChange}, 当前: ${newCoins}`);
        return playerData;
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 添加金币失败 [${userId}]: ${error.message}`);
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
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.getPlayer(userId);
        const oldLevel = playerData.level;
        
        // 添加经验值
        playerData.experience += amount;
        
        // 计算新等级
        const levelResult = this._calculateLevel(playerData.experience);
        const newLevel = levelResult.level;
        
        let levelUpInfo = null;
        
        // 如果等级提升，处理升级奖励
        if (newLevel > oldLevel) {
          levelUpInfo = await this._handleLevelUp(playerData, oldLevel, newLevel);
        }
        
        playerData.level = newLevel;
        playerData.lastUpdated = Date.now();
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[PlayerService] 玩家 ${userId} 经验变化: +${amount}, 当前: ${playerData.experience} (等级 ${newLevel})`);
        
        if (levelUpInfo) {
          this.logger.info(`[PlayerService] 玩家 ${userId} 升级: ${oldLevel} -> ${newLevel}`);
        }
        
        return {
          player: playerData,
          levelUp: levelUpInfo
        };
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 添加经验失败 [${userId}]: ${error.message}`);
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
    const rewards = this._getLevelUpRewards(oldLevel, newLevel);
    const unlockedItems = this._getUnlockedItems(oldLevel, newLevel);
    
    // 应用奖励
    playerData.coins += rewards.totalCoins;
    playerData.maxLandCount += rewards.landSlots;
    
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
   * 计算经验值对应的等级
   * @param {number} experience 经验值
   * @returns {Object} 等级信息
   */
  _calculateLevel(experience) {
    const levels = this.config.levels?.levels?.requirements || {};
    
    let currentLevel = 1;
    const maxLevel = Math.max(...Object.keys(levels).map(Number));
    
    // 从高等级向低等级查找
    for (let level = maxLevel; level >= 1; level--) {
      const levelConfig = levels[level];
      if (levelConfig && experience >= levelConfig.experience) {
        currentLevel = level;
        break;
      }
    }
    
    return { level: currentLevel };
  }

  /**
   * 计算升级奖励
   * @param {number} oldLevel 旧等级
   * @param {number} newLevel 新等级
   * @returns {Object} 奖励信息
   */
  _getLevelUpRewards(oldLevel, newLevel) {
    const levelUpRewards = this.config.levels?.levels?.rewards?.levelUp || {};
    const coinsPerLevel = levelUpRewards.coins || 50;
    const landSlotsPerLevel = levelUpRewards.landSlots || 1;
    
    const levelsGained = newLevel - oldLevel;
    
    return {
      levelsGained,
      totalCoins: coinsPerLevel * levelsGained,
      landSlots: landSlotsPerLevel * levelsGained
    };
  }

  /**
   * 获取升级解锁的物品
   * @param {number} oldLevel 旧等级
   * @param {number} newLevel 新等级
   * @returns {Array} 解锁的物品列表
   */
  _getUnlockedItems(oldLevel, newLevel) {
    const levels = this.config.levels?.levels?.requirements || {};
    const unlockedItems = [];
    
    for (let level = oldLevel + 1; level <= newLevel; level++) {
      const levelConfig = levels[level];
      if (levelConfig && levelConfig.unlocks) {
        unlockedItems.push(...levelConfig.unlocks);
      }
    }
    
    return unlockedItems;
  }

  /**
   * 获取玩家等级详细信息
   * @param {string} userId 用户ID
   * @returns {Object} 等级信息
   */
  async getPlayerLevelInfo(userId) {
    try {
      const playerData = await this.getPlayer(userId);
      const levels = this.config.levels?.levels?.requirements || {};
      const maxLevel = Math.max(...Object.keys(levels).map(Number));
      
      const currentLevelConfig = levels[playerData.level] || {};
      const nextLevelConfig = levels[playerData.level + 1] || null;
      
      return {
        currentLevel: playerData.level,
        currentExp: playerData.experience,
        currentLevelDescription: currentLevelConfig.description || '',
        nextLevelExp: nextLevelConfig ? nextLevelConfig.experience : null,
        expToNextLevel: nextLevelConfig ? Math.max(0, nextLevelConfig.experience - playerData.experience) : 0,
        maxLevel,
        landCount: playerData.landCount,
        maxLandCount: playerData.maxLandCount,
        inventoryCapacity: playerData.inventoryCapacity,
        maxInventoryCapacity: playerData.maxInventoryCapacity
      };
    } catch (error) {
      this.logger.error(`[PlayerService] 获取等级信息失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 签到功能
   * @param {string} userId 用户ID
   * @returns {Object} 签到结果
   */
  async signIn(userId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.getPlayer(userId);
        const now = new Date();
        const today = now.toDateString();
        
        // 检查是否已经签到
        if (playerData.signIn.lastSignDate === today) {
          return {
            success: false,
            message: '今日已经签到过了！',
            playerData: null
          };
        }
        
        // 计算连续签到天数
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();
        if (playerData.signIn.lastSignDate === yesterday) {
          playerData.signIn.consecutiveDays += 1;
        } else {
          playerData.signIn.consecutiveDays = 1;
        }
        
        playerData.signIn.lastSignDate = today;
        playerData.signIn.totalSignDays += 1;
        
        // 计算签到奖励
        const rewards = this._calculateSignInRewards(playerData.signIn.consecutiveDays);
        
        // 发放奖励
        playerData.coins += rewards.coins;
        playerData.experience += rewards.experience;
        playerData.statistics.totalMoneyEarned += rewards.coins;
        
        playerData.lastUpdated = Date.now();
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[PlayerService] 玩家 ${userId} 签到成功，连续 ${playerData.signIn.consecutiveDays} 天`);
        
        return {
          success: true,
          message: `签到成功！连续签到 ${playerData.signIn.consecutiveDays} 天`,
          rewards,
          consecutiveDays: playerData.signIn.consecutiveDays,
          playerData
        };
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 签到失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 计算签到奖励
   * @param {number} consecutiveDays 连续签到天数
   * @returns {Object} 奖励信息
   */
  _calculateSignInRewards(consecutiveDays) {
    const baseCoins = 50;
    const baseExp = 10;
    
    // 连续签到加成
    let multiplier = 1;
    if (consecutiveDays >= 7) multiplier = 1.5;
    if (consecutiveDays >= 30) multiplier = 2.0;
    
    return {
      coins: Math.floor(baseCoins * multiplier),
      experience: Math.floor(baseExp * multiplier),
      // TODO: 根据连续天数给予特殊物品奖励
      items: []
    };
  }

  /**
   * 使用狗粮设置防御
   * @param {string} userId 用户ID
   * @param {string} dogFoodType 狗粮类型
   * @returns {Object} 使用结果
   */
  async useDogFood(userId, dogFoodType) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.getPlayer(userId);
        
        // 获取狗粮配置
        const dogFoodConfig = this.config.items?.dogFood?.[dogFoodType];
        if (!dogFoodConfig) {
          throw new Error(`未知的狗粮类型: ${dogFoodType}`);
        }
        
        const now = Date.now();
        const duration = dogFoodConfig.duration * 60 * 1000; // 转换为毫秒
        
        // 设置防御效果（新效果覆盖旧效果）
        playerData.protection.dogFood = {
          type: dogFoodType,
          effectEndTime: now + duration,
          defenseBonus: dogFoodConfig.defenseBonus
        };
        
        playerData.lastUpdated = now;
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[PlayerService] 玩家 ${userId} 使用 ${dogFoodType} 狗粮，防御 ${dogFoodConfig.defenseBonus}%，持续 ${dogFoodConfig.duration} 分钟`);
        
        return {
          success: true,
          dogFoodType,
          defenseBonus: dogFoodConfig.defenseBonus,
          durationMinutes: dogFoodConfig.duration,
          endTime: playerData.protection.dogFood.effectEndTime
        };
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 使用狗粮失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查玩家防御状态
   * @param {string} userId 用户ID
   * @returns {Object} 防御状态
   */
  async getProtectionStatus(userId) {
    try {
      const playerData = await this.getPlayer(userId);
      const now = Date.now();
      
      const dogFoodActive = playerData.protection.dogFood.effectEndTime > now;
      const farmProtectionActive = playerData.protection.farmProtection.endTime > now;
      const stealCooldownActive = playerData.stealing.cooldownEndTime > now;
      
      return {
        dogFood: {
          active: dogFoodActive,
          type: dogFoodActive ? playerData.protection.dogFood.type : null,
          defenseBonus: dogFoodActive ? playerData.protection.dogFood.defenseBonus : 0,
          endTime: playerData.protection.dogFood.effectEndTime
        },
        farmProtection: {
          active: farmProtectionActive,
          endTime: playerData.protection.farmProtection.endTime
        },
        stealCooldown: {
          active: stealCooldownActive,
          endTime: playerData.stealing.cooldownEndTime
        }
      };
    } catch (error) {
      this.logger.error(`[PlayerService] 获取防御状态失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 设置偷菜冷却
   * @param {string} userId 用户ID
   * @param {number} cooldownMinutes 冷却时间（分钟）
   */
  async setStealCooldown(userId, cooldownMinutes = 5) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.getPlayer(userId);
        
        const now = Date.now();
        playerData.stealing.lastStealTime = now;
        playerData.stealing.cooldownEndTime = now + (cooldownMinutes * 60 * 1000);
        playerData.lastUpdated = now;
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[PlayerService] 玩家 ${userId} 偷菜冷却 ${cooldownMinutes} 分钟`);
        return playerData;
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 设置偷菜冷却失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 设置农场保护
   * @param {string} userId 用户ID
   * @param {number} protectionMinutes 保护时间（分钟）
   */
  async setFarmProtection(userId, protectionMinutes = 30) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.getPlayer(userId);
        
        const now = Date.now();
        playerData.protection.farmProtection.endTime = now + (protectionMinutes * 60 * 1000);
        playerData.lastUpdated = now;
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[PlayerService] 玩家 ${userId} 农场保护 ${protectionMinutes} 分钟`);
        return playerData;
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 设置农场保护失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 更新玩家统计数据
   * @param {string} userId 用户ID
   * @param {Object} stats 统计数据更新
   */
  async updateStatistics(userId, stats) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.getPlayer(userId);
        
        // 更新各种统计数据
        if (stats.harvested) playerData.statistics.totalHarvested += stats.harvested;
        if (stats.stolenFrom) playerData.statistics.totalStolenFrom += stats.stolenFrom;
        if (stats.stolenBy) playerData.statistics.totalStolenBy += stats.stolenBy;
        if (stats.moneyEarned) playerData.statistics.totalMoneyEarned += stats.moneyEarned;
        if (stats.moneySpent) playerData.statistics.totalMoneySpent += stats.moneySpent;
        
        playerData.lastUpdated = Date.now();
        playerData.lastActiveTime = Date.now();
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        return playerData;
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 更新统计数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 扩张土地
   * @param {string} userId 用户ID
   * @returns {Object} 扩张结果
   */
  async expandLand(userId) {
    try {
      const playerData = await this.getPlayer(userId);
      
      // 检查是否已达到上限
      if (playerData.landCount >= playerData.maxLandCount) {
        return {
          success: false,
          message: '土地数量已达到上限！',
          currentLandCount: playerData.landCount,
          maxLandCount: playerData.maxLandCount
        };
      }
      
      // 获取扩张配置
      const nextLandNumber = playerData.landCount + 1;
      const landConfig = this.config.land?.expansion?.[nextLandNumber];
      
      if (!landConfig) {
        return {
          success: false,
          message: '无法获取土地扩张配置！'
        };
      }
      
      // 检查等级要求
      if (playerData.level < landConfig.levelRequired) {
        return {
          success: false,
          message: `需要等级 ${landConfig.levelRequired} 才能扩张第 ${nextLandNumber} 块土地！当前等级: ${playerData.level}`
        };
      }
      
      // 检查金币是否足够
      if (playerData.coins < landConfig.goldCost) {
        return {
          success: false,
          message: `金币不足！需要 ${landConfig.goldCost} 金币，当前拥有: ${playerData.coins}`
        };
      }
      
      // 执行扩张
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        playerData.coins -= landConfig.goldCost;
        playerData.landCount += 1;
        playerData.statistics.totalMoneySpent += landConfig.goldCost;
        playerData.lastUpdated = Date.now();
        
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[PlayerService] 玩家 ${userId} 扩张土地成功，第 ${nextLandNumber} 块土地，花费 ${landConfig.goldCost} 金币`);
        
        return {
          success: true,
          message: `成功扩张第 ${nextLandNumber} 块土地！`,
          landNumber: nextLandNumber,
          costGold: landConfig.goldCost,
          currentLandCount: playerData.landCount,
          remainingCoins: playerData.coins
        };
      });
    } catch (error) {
      this.logger.error(`[PlayerService] 扩张土地失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取等级信息
   * @param {number} level 等级
   * @returns {Object} 等级信息
   */
  async getLevelInfo(level) {
    try {
      // 从配置中获取等级信息
      const levelConfig = this.config.levels?.levels?.[level + 1];
      if (!levelConfig) {
        return null; // 已达到最高等级
      }
      
      return {
        level: level + 1,
        experienceRequired: levelConfig.experienceRequired,
        rewards: levelConfig.rewards || {}
      };
    } catch (error) {
      this.logger.error(`[PlayerService] 获取等级信息失败 [Level ${level}]: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取仓库使用情况（方法添加到PlayerData原型）
   */
  _addPlayerDataMethods(playerData) {
    // 获取仓库使用情况
    playerData.getInventoryUsage = function() {
      const inventorySize = Object.values(this.inventory || {}).reduce((sum, item) => sum + (item.quantity || 0), 0);
      return inventorySize;
    };

    // 获取狗粮防护状态
    playerData.getDogFoodStatus = function() {
      const now = Date.now();
      if (this.protection?.dogFood?.effectEndTime > now) {
        const remainingTime = Math.ceil((this.protection.dogFood.effectEndTime - now) / (1000 * 60));
        return `${this.protection.dogFood.type} (${remainingTime}分钟)`;
      }
      return '无防护';
    };

    // 获取偷菜冷却状态
    playerData.getStealCooldownStatus = function() {
      const now = Date.now();
      if (this.stealing?.cooldownEndTime > now) {
        const remainingTime = Math.ceil((this.stealing.cooldownEndTime - now) / (1000 * 60));
        return `冷却中 (${remainingTime}分钟)`;
      }
      return '可偷菜';
    };

    return playerData;
  }
}

module.exports = PlayerService; 