/**
 * 偷窃核心服务 - 实现完整的偷窃逻辑
 * 包含成功率计算、双重锁机制、防重复偷取等功能
 */



// {{RIPER-5:
// Action: Added
// Task: #1e674b9e-1986-4cd2-a707-4d9330f6cb06 | Time: 2025-07-13
// Reason: 实现偷窃核心服务(StealService)
// Principle: SOC 关注点分离原则 - 专注于偷窃机制功能
// Architecture_Note: [AR] 使用分布式锁确保并发安全，采用依赖注入模式
// Knowledge_Reference: PRD偷窃流程设计和技术规范
// Quality_Check: [LD] 实现完整的错误处理、日志记录和并发控制
// }}

// {{START_MODIFICATIONS}}
export class StealService {
  constructor(redisClient, config, playerService, inventoryService, protectionService, landService) {
    this.redisClient = redisClient;
    this.config = config;
    this.playerService = playerService;
    this.inventoryService = inventoryService;
    this.protectionService = protectionService;
    this.landService = landService;


    // 获取偷窃配置
    this.stealConfig = this.config.steal;

    logger.info('[StealService] 偷窃服务已初始化');
  }

  /**
   * 执行偷窃操作 - 主要入口方法
   * @param {string} attackerId 偷窃者ID
   * @param {string} targetId 目标用户ID
   * @returns {Object} 偷窃结果
   */
  async executeSteal(attackerId, targetId) {
    // 输入验证
    if (!attackerId || !targetId) {
      throw new Error('偷窃者ID和目标ID不能为空');
    }

    if (attackerId === targetId) {
      throw new Error('不能偷窃自己的农场');
    }

    logger.info(`[StealService] 玩家 ${attackerId} 尝试偷窃 ${targetId}`);

    // 双重分布式锁：确保操作原子性
    const lockKeys = [attackerId, targetId].sort(); // 按字母序排序防止死锁
    const lockTimeout = Math.ceil(this.stealConfig.locks.timeout / 1000); // 转换为秒

    try {
      // 嵌套获取双重锁，按排序顺序避免死锁
      return await this.redisClient.withLock(lockKeys[0], async () => {
        return await this.redisClient.withLock(lockKeys[1], async () => {
          // 执行偷窃核心逻辑
          return await this._executeStealCore(attackerId, targetId);
        }, 'steal_operation', lockTimeout);
      }, 'steal_operation', lockTimeout);

    } catch (error) {
      logger.error(`[StealService] 偷窃操作失败 [${attackerId} -> ${targetId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 偷窃核心逻辑（需要在锁保护下执行）
   * @param {string} attackerId 偷窃者ID
   * @param {string} targetId 目标用户ID
   * @returns {Object} 偷窃结果
   * @private
   */
  async _executeStealCore(attackerId, targetId) {
    // 1. 检查偷窃者冷却状态
    const cooldownStatus = await this.getStealCooldownStatus(attackerId);
    if (!cooldownStatus.canSteal) {
      throw new Error(`偷窃冷却中，剩余时间: ${Math.ceil(cooldownStatus.remainingTime / 60000)} 分钟`);
    }

    // 2. 检查目标可偷状态
    const targetStatus = await this.getStealableStatus(targetId);
    if (!targetStatus.canBeStolen) {
      throw new Error(targetStatus.reason);
    }

    // 3. 检查防重复偷取
    const repeatStatus = await this._checkAntiRepeat(attackerId, targetId);
    if (!repeatStatus.allowed) {
      throw new Error(repeatStatus.reason);
    }

    // 4. 获取可偷取的土地
    const stealableLands = await this._getStealableLands(targetId);
    if (stealableLands.length === 0) {
      throw new Error('目标没有可偷取的作物');
    }

    // 5. 计算偷窃成功率
    const successRate = await this._calculateSuccessRate(attackerId, targetId);

    // 6. 执行偷窃判定
    const isSuccess = Math.random() * 100 < successRate;

    if (isSuccess) {
      return await this._handleStealSuccess(attackerId, targetId, stealableLands, successRate);
    } else {
      return await this._handleStealFailure(attackerId, targetId, successRate);
    }
  }

  /**
   * 处理偷窃成功
   * @param {string} attackerId 偷窃者ID
   * @param {string} targetId 目标用户ID
   * @param {Array} stealableLands 可偷取的土地
   * @param {number} successRate 成功率
   * @returns {Object} 成功结果
   * @private
   */
  async _handleStealSuccess(attackerId, targetId, stealableLands, successRate) {
    const rewards = [];

    // 随机选择要偷取的土地（最多maxStealPerAttempt块）
    const maxSteal = this.stealConfig.basic.maxStealPerAttempt;
    const selectedLands = this._selectRandomLands(stealableLands, maxSteal);

    // 使用Redis Pipeline优化连续写操作
    const pipeline = this.redisClient.multi();

    for (const land of selectedLands) {
      // 计算偷取数量
      const stealAmount = await this._calculateStealAmount(land);

      if (stealAmount > 0) {
        // 减少目标作物数量
        const newQuantity = Math.max(0, land.crop.quantity - stealAmount);

        // 更新土地数据
        await this.landService.updateLandCrop(targetId, land.landId, {
          ...land.crop,
          quantity: newQuantity
        });

        // 偷窃者获得作物
        await this.inventoryService.addItem(attackerId, land.crop.cropId, stealAmount);

        rewards.push({
          cropId: land.crop.cropId,
          cropName: land.crop.cropName,
          quantity: stealAmount,
          fromLand: land.landId
        });

        logger.info(`[StealService] 偷窃成功：${attackerId} 从 ${targetId} 的土地 ${land.landId} 偷得 ${stealAmount} 个 ${land.crop.cropName}`);
      }
    }

    // 执行Pipeline
    await pipeline.exec();

    // 设置偷窃冷却
    await this._setStealCooldown(attackerId);

    // 设置目标保护
    await this.protectionService.setFarmProtection(
      targetId,
      this.stealConfig.basic.protectionMinutes
    );

    // 记录偷窃记录
    await this._recordStealAttempt(attackerId, targetId, true, rewards);

    return {
      success: true,
      result: 'steal_success',
      successRate,
      rewards,
      totalStolen: rewards.reduce((sum, r) => sum + r.quantity, 0),
      message: `偷窃成功！获得了 ${rewards.length} 种作物`,
      protectionSet: true
    };
  }

  /**
   * 处理偷窃失败
   * @param {string} attackerId 偷窃者ID
   * @param {string} targetId 目标用户ID
   * @param {number} successRate 成功率
   * @returns {Object} 失败结果
   * @private
   */
  async _handleStealFailure(attackerId, targetId, successRate) {
    // 计算失败惩罚
    const penalty = await this._calculateFailurePenalty(attackerId);

    if (penalty > 0) {
      // 扣除偷窃者金币
      await this.playerService.updateEconomyField(attackerId, 'coins', -penalty);

      logger.info(`[StealService] 偷窃失败：${attackerId} 被罚款 ${penalty} 金币`);
    }

    // 设置偷窃冷却（失败也有冷却）
    await this._setStealCooldown(attackerId);

    // 记录偷窃记录
    await this._recordStealAttempt(attackerId, targetId, false, [], penalty);

    return {
      success: false,
      result: 'steal_failed',
      successRate,
      penalty,
      message: `偷窃失败！被发现并罚款 ${penalty} 金币`,
      protectionSet: false
    };
  }

  /**
   * 检查偷窃冷却状态
   * @param {string} userId 用户ID
   * @returns {Object} 冷却状态
   */
  async getStealCooldownStatus(userId) {
    try {
      const key = `steal_cooldown:${userId}`;
      const cooldownEnd = await this.redisClient.get(key);

      if (!cooldownEnd) {
        return {
          canSteal: true,
          cooldownEnd: 0,
          remainingTime: 0
        };
      }

      const now = Date.now();
      const endTime = parseInt(cooldownEnd);
      const remainingTime = Math.max(0, endTime - now);

      return {
        canSteal: remainingTime <= 0,
        cooldownEnd: endTime,
        remainingTime
      };
    } catch (error) {
      logger.error(`[StealService] 检查偷窃冷却失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查目标可偷状态
   * @param {string} targetId 目标用户ID
   * @returns {Object} 可偷状态
   */
  async getStealableStatus(targetId) {
    try {
      // 检查目标是否存在
      const targetData = await this.playerService.getDataService().getPlayer(targetId);
      if (!targetData) {
        return {
          canBeStolen: false,
          reason: '目标玩家不存在'
        };
      }

      // 检查目标是否受保护
      const protectionStatus = await this.protectionService.isProtected(targetId);
      if (protectionStatus.isProtected) {
        const remainingMinutes = Math.ceil(protectionStatus.protectionRemaining / 60000);
        return {
          canBeStolen: false,
          reason: `目标受到保护，剩余时间: ${remainingMinutes} 分钟`
        };
      }

      // 检查目标是否有可偷取的作物
      const stealableLands = await this._getStealableLands(targetId);
      if (stealableLands.length === 0) {
        return {
          canBeStolen: false,
          reason: '目标没有可偷取的作物'
        };
      }

      return {
        canBeStolen: true,
        availableLands: stealableLands.length,
        reason: null
      };
    } catch (error) {
      logger.error(`[StealService] 检查目标可偷状态失败 [${targetId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取可偷取的土地
   * @param {string} targetId 目标用户ID
   * @returns {Array} 可偷取的土地列表
   * @private
   */
  async _getStealableLands(targetId) {
    try {
      const allLands = await this.landService.getAllLands(targetId);
      const stealableLands = [];
      const minGrowthProgress = this.stealConfig.landRequirements.minGrowthProgress;
      const excludeStates = this.stealConfig.landRequirements.excludeStates;

      for (const land of allLands) {
        // 检查土地状态
        if (excludeStates.includes(land.status)) {
          continue;
        }

        // 检查是否有作物
        if (!land.crop || !land.crop.cropId) {
          continue;
        }

        // 检查生长进度
        if (land.crop.growthProgress < minGrowthProgress) {
          continue;
        }

        // 检查作物数量
        if (land.crop.quantity <= 0) {
          continue;
        }

        stealableLands.push({
          landId: land.landId,
          crop: land.crop,
          quality: land.quality
        });
      }

      return stealableLands;
    } catch (error) {
      logger.error(`[StealService] 获取可偷取土地失败 [${targetId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 计算偷窃成功率
   * @param {string} attackerId 偷窃者ID
   * @param {string} targetId 目标用户ID
   * @returns {number} 成功率（0-100）
   * @private
   */
  async _calculateSuccessRate(attackerId, targetId) {
    try {
      const baseRate = this.stealConfig.basic.baseSuccessRate;
      const factors = this.stealConfig.successRateFactors;

      let finalRate = baseRate;

      // 获取玩家数据
      const [attackerData, targetData] = await Promise.all([
        this.playerService.getDataService().getPlayer(attackerId),
        this.playerService.getDataService().getPlayer(targetId)
      ]);

      // 等级差异影响
      const levelDiff = attackerData.level - targetData.level;
      const levelFactor = factors.levelDifferenceFactor;
      finalRate += levelDiff * levelFactor * 10; // 每级差异影响1%（levelFactor * 10）

      // 目标防护加成
      const protectionBonus = await this.protectionService.getProtectionBonus(targetId);
      if (protectionBonus > 0) {
        const protectionPenalty = factors.targetProtectionPenalty;
        finalRate -= protectionBonus * protectionPenalty;
      }

      // 限制成功率范围
      const maxRate = factors.maxSuccessRate;
      const minRate = factors.minSuccessRate;
      finalRate = Math.min(maxRate, Math.max(minRate, finalRate));

      return Math.round(finalRate);
    } catch (error) {
      logger.error(`[StealService] 计算成功率失败: ${error.message}`);
      return this.stealConfig.basic.baseSuccessRate;
    }
  }

  /**
   * 计算偷取数量
   * @param {Object} land 土地对象
   * @returns {number} 偷取数量
   * @private
   */
  async _calculateStealAmount(land) {
    try {
      const rewardConfig = this.stealConfig.rewards;
      const baseRate = rewardConfig.baseRewardRate;
      const maxRate = rewardConfig.maxRewardRate;
      const qualityBonus = rewardConfig.bonusByQuality;

      // 基础偷取比例
      let stealRate = baseRate;

      // 土地品质加成
      const qualityMultiplier = qualityBonus[land.quality];
      stealRate *= qualityMultiplier;

      // 限制最大偷取比例
      stealRate = Math.min(maxRate, stealRate);

      // 计算偷取数量（至少偷1个，如果有的话）
      const stealAmount = Math.max(1, Math.floor(land.crop.quantity * stealRate));

      return Math.min(stealAmount, land.crop.quantity);
    } catch (error) {
      logger.error(`[StealService] 计算偷取数量失败: ${error.message}`);
      return 1; // 默认偷取1个
    }
  }

  /**
   * 计算失败惩罚
   * @param {string} attackerId 偷窃者ID
   * @returns {number} 惩罚金额
   * @private
   */
  async _calculateFailurePenalty(attackerId) {
    try {
      const penaltyConfig = this.stealConfig.penalties;
      const penaltyRate = penaltyConfig.basePenaltyRate;
      const maxPenalty = penaltyConfig.maxPenalty;
      const minPenalty = penaltyConfig.minPenalty;

      // 获取玩家金币
      const playerData = await this.playerService.getDataService().getPlayer(attackerId);
      const currentCoins = playerData.economy.coins;

      // 计算惩罚金额
      let penalty = Math.floor(currentCoins * penaltyRate);
      penalty = Math.min(maxPenalty, Math.max(minPenalty, penalty));

      // 确保不超过玩家现有金币
      penalty = Math.min(penalty, currentCoins);

      return penalty;
    } catch (error) {
      logger.error(`[StealService] 计算失败惩罚失败: ${error.message}`);
      return this.stealConfig.penalties.minPenalty;
    }
  }

  /**
   * 设置偷窃冷却
   * @param {string} userId 用户ID
   * @private
   */
  async _setStealCooldown(userId) {
    try {
      const cooldownMinutes = this.stealConfig.basic.cooldownMinutes;
      const cooldownMs = cooldownMinutes * 60 * 1000;
      const cooldownEnd = Date.now() + cooldownMs;

      const key = `steal_cooldown:${userId}`;
      await this.redisClient.setex(key, Math.ceil(cooldownMs / 1000), cooldownEnd.toString());

      logger.debug(`[StealService] 设置偷窃冷却 [${userId}]: ${cooldownMinutes} 分钟`);
    } catch (error) {
      logger.error(`[StealService] 设置偷窃冷却失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查防重复偷取
   * @param {string} attackerId 偷窃者ID
   * @param {string} targetId 目标用户ID
   * @returns {Object} 检查结果
   * @private
   */
  async _checkAntiRepeat(attackerId, targetId) {
    try {
      const antiRepeatConfig = this.stealConfig.antiRepeat;
      const cooldownMinutes = antiRepeatConfig.sameTargetCooldownMinutes;
      const maxAttempts = antiRepeatConfig.maxAttemptsPerTarget;

      const now = Date.now();
      const today = new Date(now).toDateString();

      // 检查对同一目标的冷却
      const cooldownKey = `steal_target_cooldown:${attackerId}:${targetId}`;
      const lastAttemptTime = await this.redisClient.get(cooldownKey);

      if (lastAttemptTime) {
        const timeDiff = now - parseInt(lastAttemptTime);
        const cooldownMs = cooldownMinutes * 60 * 1000;

        if (timeDiff < cooldownMs) {
          const remainingMinutes = Math.ceil((cooldownMs - timeDiff) / 60000);
          return {
            allowed: false,
            reason: `对此目标的冷却中，剩余时间: ${remainingMinutes} 分钟`
          };
        }
      }

      // 检查今日尝试次数
      const attemptsKey = `steal_attempts:${attackerId}:${targetId}:${today}`;
      const attemptCount = parseInt(await this.redisClient.get(attemptsKey));

      if (attemptCount >= maxAttempts) {
        return {
          allowed: false,
          reason: `今日对此目标的偷窃次数已达上限 (${maxAttempts})`
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error(`[StealService] 检查防重复偷取失败: ${error.message}`);
      return { allowed: true }; // 出错时允许继续，避免阻塞正常游戏
    }
  }

  /**
   * 记录偷窃尝试
   * @param {string} attackerId 偷窃者ID
   * @param {string} targetId 目标用户ID
   * @param {boolean} success 是否成功
   * @param {Array} rewards 奖励列表
   * @param {number} penalty 惩罚金额
   * @private
   */
  async _recordStealAttempt(attackerId, targetId, success, rewards = [], penalty = 0) {
    try {
      const now = Date.now();
      const today = new Date(now).toDateString();

      // 更新目标冷却时间
      const cooldownKey = `steal_target_cooldown:${attackerId}:${targetId}`;
      const cooldownMinutes = this.stealConfig.antiRepeat.sameTargetCooldownMinutes;
      await this.redisClient.setex(cooldownKey, cooldownMinutes * 60, now.toString());

      // 更新今日尝试次数
      const attemptsKey = `steal_attempts:${attackerId}:${targetId}:${today}`;
      await this.redisClient.incr(attemptsKey);
      await this.redisClient.expire(attemptsKey, 24 * 60 * 60); // 24小时过期

      // 记录详细日志（可用于后续统计分析）
      const logData = {
        timestamp: now,
        attackerId,
        targetId,
        success,
        rewards: rewards.length,
        totalStolen: rewards.reduce((sum, r) => sum + r.quantity, 0),
        penalty
      };

      logger.info(`[StealService] 偷窃记录: ${JSON.stringify(logData)}`);
    } catch (error) {
      logger.error(`[StealService] 记录偷窃尝试失败: ${error.message}`);
      // 记录失败不应影响主流程
    }
  }

  /**
   * 随机选择土地
   * @param {Array} lands 土地列表
   * @param {number} maxCount 最大选择数量
   * @returns {Array} 选中的土地
   * @private
   */
  _selectRandomLands(lands, maxCount) {
    if (lands.length <= maxCount) {
      return [...lands];
    }

    const selected = [];
    const available = [...lands];

    for (let i = 0; i < maxCount && available.length > 0; i++) {
      const randomIndex = Math.floor(Math.random() * available.length);
      selected.push(available.splice(randomIndex, 1)[0]);
    }

    return selected;
  }

  /**
   * 获取默认配置
   * @returns {Object} 默认配置
   * @private
   */
  _getDefaultConfig() {
    return {
      basic: {
        cooldownMinutes: 60,
        baseSuccessRate: 50,
        maxStealPerAttempt: 3,
        protectionMinutes: 30
      },
      successRateFactors: {
        targetProtectionPenalty: 0.5,
        levelDifferenceFactor: 0.1,
        maxSuccessRate: 95,
        minSuccessRate: 5
      },
      rewards: {
        baseRewardRate: 0.1,
        maxRewardRate: 0.3,
        bonusByQuality: {
          normal: 1.0,
          bronze: 1.2,
          silver: 1.5,
          gold: 2.0
        }
      },
      penalties: {
        basePenaltyRate: 0.05,
        maxPenalty: 1000,
        minPenalty: 10
      },
      landRequirements: {
        minGrowthProgress: 0.5,
        excludeStates: ['empty', 'harvested']
      },
      antiRepeat: {
        sameTargetCooldownMinutes: 30,
        maxAttemptsPerTarget: 3
      },
      locks: {
        timeout: 10000,
        retryDelay: 100,
        maxRetries: 50
      }
    };
  }

  /**
   * 获取偷窃统计信息
   * @param {string} userId 用户ID
   * @returns {Object} 统计信息
   */
  async getStealStatistics(userId) {
    try {
      const today = new Date().toDateString();
      const cooldownStatus = await this.getStealCooldownStatus(userId);

      // 获取今日偷窃次数（所有目标）
      const pattern = `steal_attempts:${userId}:*:${today}`;
      const keys = await this.redisClient.keys(pattern);
      let totalAttemptsToday = 0;

      for (const key of keys) {
        const count = parseInt(await this.redisClient.get(key));
        totalAttemptsToday += count;
      }

      return {
        cooldownStatus,
        totalAttemptsToday,
        config: {
          cooldownMinutes: this.stealConfig.basic.cooldownMinutes,
          maxStealPerAttempt: this.stealConfig.basic.maxStealPerAttempt,
          baseSuccessRate: this.stealConfig.basic.baseSuccessRate
        }
      };
    } catch (error) {
      logger.error(`[StealService] 获取偷窃统计失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 清理过期的偷窃相关数据
   * @returns {Object} 清理结果
   */
  async cleanupExpiredData() {
    try {
      const patterns = [
        'steal_cooldown:*',
        'steal_target_cooldown:*',
        'steal_attempts:*'
      ];

      let totalCleaned = 0;

      for (const pattern of patterns) {
        const keys = await this.redisClient.keys(pattern);
        for (const key of keys) {
          const ttl = await this.redisClient.ttl(key);
          if (ttl === -1) { // 没有过期时间的键，手动清理
            await this.redisClient.del(key);
            totalCleaned++;
          }
        }
      }

      logger.info(`[StealService] 清理过期数据完成，清理 ${totalCleaned} 个键`);

      return {
        success: true,
        cleanedKeys: totalCleaned
      };
    } catch (error) {
      logger.error(`[StealService] 清理过期数据失败: ${error.message}`);
      throw error;
    }
  }
}

// {{END_MODIFICATIONS}}

export default StealService;