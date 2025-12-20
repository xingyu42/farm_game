/**
 * 偷窃核心服务 - 实现完整的偷窃逻辑
 * 包含成功率计算、双重锁机制、防重复偷取等功能
 */

import { CommonUtils } from '../../utils/CommonUtils.js';



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

    // 使用批量锁：确保操作原子性，避免嵌套锁冲突
    const lockTimeout = Math.ceil(this.stealConfig.locks.timeout / 1000); // 转换为秒

    try {
      // 批量获取双用户锁，内部已按排序顺序避免死锁
      return await this.redisClient.withUserLocks([attackerId, targetId], async () => {
        // 执行偷窃核心逻辑
        return await this._executeStealCore(attackerId, targetId);
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
    // 1. 检查冷却状态（在锁内检查，避免竞态条件）
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
    const cropsConfig = this.config.crops || {};
    let inventoryFull = false;

    // 遍历所有可偷取的土地
    for (const land of stealableLands) {
      // 获取作物配置（land.crop 是作物ID字符串）
      const cropConfig = cropsConfig[land.crop];
      if (!cropConfig) {
        logger.warn(`[StealService] 未找到作物配置: ${land.crop}`);
        continue;
      }

      // 计算偷取数量
      const stealAmount = this._calculateStealAmount(land, cropConfig);

      if (stealAmount > 0) {
        const addResult = await this.inventoryService.addItem(attackerId, land.crop, stealAmount);

        const addedQuantity = addResult?.success
          ? stealAmount
          : (addResult?.partialSuccess && Number.isFinite(addResult.added) ? addResult.added : 0);

        if (addedQuantity > 0) {
          rewards.push({
            cropId: land.crop,
            cropName: cropConfig.name,
            quantity: addedQuantity,
            fromLand: land.landId
          });
        } else if (typeof addResult?.message === 'string' && addResult.message.includes('仓库容量不足')) {
          inventoryFull = true;
        }
      }
    }

    // 检查是否实际偷到东西
    if (rewards.length === 0) {
      // 未偷到任何东西，仅设置冷却，不设置目标保护
      await this._setStealCooldown(attackerId);
      await this._recordStealAttempt(attackerId, targetId);

      return {
        success: false,
        result: 'steal_empty',
        successRate,
        rewards: [],
        totalStolen: 0,
        message: inventoryFull ? '仓库容量不足，偷到的作物放不下' : '没有获得任何作物'
      };
    }

    // 设置偷窃冷却
    await this._setStealCooldown(attackerId);

    // 设置目标保护
    await this.protectionService.setFarmProtection(
      targetId,
      this.stealConfig.basic.protectionMinutes
    );

    // 记录偷窃记录
    await this._recordStealAttempt(attackerId, targetId);

    return {
      success: true,
      result: 'steal_success',
      successRate,
      rewards,
      totalStolen: rewards.reduce((sum, r) => sum + r.quantity, 0),
      message: `偷窃成功！获得了 ${rewards.length} 种作物`
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
    // 设置偷窃冷却（失败也有冷却）
    await this._setStealCooldown(attackerId);

    // 记录偷窃记录
    await this._recordStealAttempt(attackerId, targetId);

    return {
      success: false,
      result: 'steal_failed',
      successRate,
      message: '偷窃失败！被发现了'
    };
  }

  /**
   * 检查偷窃冷却状态
   * @param {string} userId 用户ID
   * @returns {Object} 冷却状态
   */
  async getStealCooldownStatus(userId) {
    try {
      const key = `farm_game:steal_cooldown:${userId}`;
      const cooldownEnd = await this.redisClient.get(key);

      if (!cooldownEnd) {
        return {
          canSteal: true,
          cooldownEnd: 0,
          remainingTime: 0
        };
      }

      const now = Date.now();
      const endTime = parseInt(cooldownEnd, 10) || 0;
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
      const protectionStatus = await this.protectionService.getProtectionStatus(targetId);
      if (protectionStatus?.farmProtection?.active) {
        const remainingMs = protectionStatus.farmProtection.remainingTime || 0;
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        return {
          canBeStolen: false,
          reason: `目标受到保护，剩余时间: ${remainingMinutes} 分钟`
        };
      }
      if (protectionStatus?.dogFood?.active) {
        const remainingMs = protectionStatus.dogFood.remainingTime || 0;
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        return {
          canBeStolen: false,
          reason: `目标狗粮防护中，剩余时间: ${remainingMinutes} 分钟`
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
      const result = await this.landService.getAllLands(targetId);
      const allLands = result?.lands || [];
      const stealableLands = [];
      const excludeStates = this.stealConfig.landRequirements.excludeStates;
      const now = Date.now();

      for (const land of allLands) {
        if (excludeStates.includes(land.status)) {
          continue;
        }

        // 检查是否有作物（land.crop 是作物ID字符串）
        if (!land.crop) {
          continue;
        }

        // 检查是否有有效的种植和收获时间
        if (!land.plantTime || !land.harvestTime) {
          continue;
        }

        // 计算生长进度
        const totalGrowTime = land.harvestTime - land.plantTime;
        const timeSincePlant = now - land.plantTime;
        const growthProgress = totalGrowTime > 0 ? timeSincePlant / totalGrowTime : 0;

        // 只有成熟作物才能偷
        if (growthProgress < 1.0) {
          continue;
        }

        stealableLands.push({
          landId: land.id,
          crop: land.crop,
          quality: land.quality,
          growthProgress
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
  _calculateStealAmount(land, cropConfig) {
    try {
      const rewardConfig = this.stealConfig.rewards;
      const baseRate = rewardConfig.baseRewardRate;
      const maxRate = rewardConfig.maxRewardRate;
      const qualityBonus = rewardConfig.bonusByQuality;
      const randomRange = rewardConfig.randomRange;

      // 获取作物基础产量
      const baseYield = cropConfig.baseYield || 1;

      // 基础偷取比例
      let stealRate = baseRate;

      // 土地品质加成
      const qualityMultiplier = qualityBonus[land.quality] || 1;
      stealRate *= qualityMultiplier;

      // 生长进度加成（成熟度越高偷得越多）
      const progressMultiplier = Math.min(1.5, land.growthProgress || 1);
      stealRate *= progressMultiplier;

      // 限制最大偷取比例
      stealRate = Math.min(maxRate, stealRate);

      // 计算基础偷取数量
      const baseAmount = baseYield * stealRate;

      // 应用随机波动
      const randomFactor = randomRange.min + Math.random() * (randomRange.max - randomRange.min);
      const stealAmount = Math.max(1, Math.floor(baseAmount * randomFactor));

      return stealAmount;
    } catch (error) {
      logger.error(`[StealService] 计算偷取数量失败: ${error.message}`);
      return 1;
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

      const key = `farm_game:steal_cooldown:${userId}`;
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
      const today = CommonUtils.getTodayKey(now);

      // 检查对同一目标的冷却
      const cooldownKey = `farm_game:steal_target_cooldown:${attackerId}:${targetId}`;
      const lastAttemptTime = await this.redisClient.get(cooldownKey);

      if (lastAttemptTime) {
        const cooldownEndTime = (parseInt(lastAttemptTime, 10) || 0) + cooldownMinutes * 60 * 1000;
        const remainingMinutes = CommonUtils.getRemainingMinutes(cooldownEndTime, now);

        if (remainingMinutes > 0) {
          return {
            allowed: false,
            reason: `对此目标的冷却中，剩余时间: ${remainingMinutes} 分钟`
          };
        }
      }

      // 检查今日尝试次数
      const attemptsKey = `farm_game:steal_attempts:${attackerId}:${targetId}:${today}`;
      const attemptCount = parseInt(await this.redisClient.get(attemptsKey), 10) || 0;

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
   * @private
   */
  async _recordStealAttempt(attackerId, targetId) {
    try {
      const now = Date.now();
      const today = CommonUtils.getTodayKey(now);

      // 更新目标冷却时间
      const cooldownKey = `farm_game:steal_target_cooldown:${attackerId}:${targetId}`;
      const cooldownMinutes = this.stealConfig.antiRepeat.sameTargetCooldownMinutes;
      await this.redisClient.setex(cooldownKey, cooldownMinutes * 60, now.toString());

      // 更新今日尝试次数
      const attemptsKey = `farm_game:steal_attempts:${attackerId}:${targetId}:${today}`;
      await this.redisClient.incr(attemptsKey);
      await this.redisClient.expire(attemptsKey, 24 * 60 * 60); // 24小时过期
    } catch (error) {
      logger.error(`[StealService] 记录偷窃尝试失败: ${error.message}`);
      // 记录失败不应影响主流程
    }
  }

  /**
   * 获取偷窃统计信息
   * @param {string} userId 用户ID
   * @returns {Object} 统计信息
   */
  async getStealStatistics(userId) {
    try {
      const today = CommonUtils.getTodayKey();
      const cooldownStatus = await this.getStealCooldownStatus(userId);

      // 获取今日偷窃次数（所有目标）
      const pattern = `farm_game:steal_attempts:${userId}:*:${today}`;
      const keys = await this.redisClient.keys(pattern);
      let totalAttemptsToday = 0;

      for (const key of keys) {
        const count = parseInt(await this.redisClient.get(key), 10) || 0;
        totalAttemptsToday += count;
      }

      return {
        cooldownStatus,
        totalAttemptsToday,
        config: {
          cooldownMinutes: this.stealConfig.basic.cooldownMinutes,
          baseSuccessRate: this.stealConfig.basic.baseSuccessRate
        }
      };
    } catch (error) {
      logger.error(`[StealService] 获取偷窃统计失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }
}

// {{END_MODIFICATIONS}}

export default StealService;
