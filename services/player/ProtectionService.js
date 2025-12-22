/**
 * @fileoverview 防御机制服务 - 狗粮防护系统管理
 *
 * Input:
 * - ../../utils/ItemResolver.js - ItemResolver (物品配置查询)
 * - playerService - (依赖注入,玩家服务,用于仓库和数据操作)
 *
 * Output:
 * - ProtectionService (class) - 防御服务类,提供:
 *   - applyDogFood: 应用狗粮防御效果
 *   - checkProtection: 检查玩家当前防护状态
 *   - consumeProtection: 消耗一次防护次数
 *
 * Pos: 服务层子服务,负责狗粮防护系统(防御效果应用、防护状态查询、防护消耗)
 *
 * 业务逻辑:
 * - 狗粮分类: category === 'defense'
 * - 防护字段: Player.protection { count, endTime }
 * - 防护效果: 基于物品配置 effect.duration 和 effect.stealProtectionCount
 * - 状态检查: 检查防护次数和过期时间
 * - 防护消耗: 偷窃失败时消耗一次防护次数
 *
 * 循环依赖解决:
 * - ProtectionService 和 PlayerService 循环依赖
 * - 通过构造函数注入 PlayerService 实例解决
 */

import ItemResolver from '../../utils/ItemResolver.js';

// {{RIPER-5:
// Action: Added
// Task: #ae6da383-9ca7-48e5-b85f-2bbd102015b5 | Time: 2025-07-13
// Reason: 实现防御机制服务(ProtectionService)
// Principle: SOC 关注点分离原则 - 专注于防御机制功能
// Architecture_Note: [AR] 采用依赖注入模式，与现有服务架构保持一致
// Knowledge_Reference: Player模型protection字段结构兼容
// Quality_Check: [LD] 实现完整的错误处理和日志记录
// }}

// {{START_MODIFICATIONS}}
export class ProtectionService {
  constructor(redisClient, config, playerService = null) {
    this.redisClient = redisClient;
    this.config = config;
    this.playerService = playerService;
    // 创建 ItemResolver 实例并复用
    this.itemResolver = new ItemResolver(this.config);
  }

  /**
   * 应用狗粮防御效果
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @returns {Object} 应用结果
   */
  async applyDogFood(userId, itemId) {
    try {
      if (!userId || !itemId) {
        throw new Error('用户ID和物品ID不能为空');
      }

      // 解析物品配置
      const itemInfo = this.itemResolver.findItemById(itemId);

      if (!itemInfo) {
        throw new Error(`未找到物品: ${itemId}`);
      }

      // 验证是否为狗粮类型
      if (itemInfo.category !== 'defense') {
        throw new Error(`物品 ${itemId} 不是防御类道具`);
      }

      // 获取狗粮配置
      const dogFoodConfig = this.config.items?.defense?.[itemId];
      if (!dogFoodConfig) {
        throw new Error(`未找到狗粮配置: ${itemId}`);
      }

      // 获取玩家数据
      const playerData = await this.playerService.getDataService().getPlayer(userId);
      if (!playerData) {
        throw new Error('玩家不存在');
      }

      const now = Date.now();
      const duration = dogFoodConfig.duration * 60 * 1000; // 转换为毫秒

      // 应用防御效果（新效果覆盖旧效果）
      const newProtection = {
        ...playerData.protection,
        dogFood: {
          type: itemId,
          effectEndTime: now + duration
        }
      };

      // 更新玩家防护数据
      await this.playerService.getDataService().updateMixedFields(
        userId,
        { lastUpdated: now },
        { protection: newProtection }
      );

      return {
        success: true,
        itemId,
        itemName: dogFoodConfig.name,
        durationMinutes: dogFoodConfig.duration,
        endTime: now + duration,
        message: `成功使用${dogFoodConfig.name}，持续${dogFoodConfig.duration}分钟`
      };
    } catch (error) {
      logger.error(`[ProtectionService] 应用狗粮失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查防护状态
   * @param {string} userId 用户ID
   * @returns {Object} 防护状态信息
   */
  async getProtectionStatus(userId) {
    try {
      if (!userId) {
        throw new Error('用户ID不能为空');
      }

      const playerData = await this.playerService.getDataService().getPlayer(userId);
      if (!playerData) {
        throw new Error('玩家不存在');
      }

      const now = Date.now();
      const protection = playerData.protection || {};

      // 狗粮防护状态
      const dogFoodActive = protection.dogFood?.effectEndTime > now;
      const dogFoodInfo = {
        active: dogFoodActive,
        type: dogFoodActive ? protection.dogFood.type : null,
        endTime: protection.dogFood?.effectEndTime || 0,
        remainingTime: dogFoodActive ? protection.dogFood.effectEndTime - now : 0
      };

      // 农场防护状态
      const farmProtectionActive = protection.farmProtection?.endTime > now;
      const farmProtectionInfo = {
        active: farmProtectionActive,
        endTime: protection.farmProtection?.endTime || 0,
        remainingTime: farmProtectionActive ? protection.farmProtection.endTime - now : 0
      };

      // 偷菜冷却状态
      const stealCooldownActive = playerData.stealing?.cooldownEndTime > now;
      const stealCooldownInfo = {
        active: stealCooldownActive,
        endTime: playerData.stealing?.cooldownEndTime || 0,
        remainingTime: stealCooldownActive ? playerData.stealing.cooldownEndTime - now : 0
      };

      return {
        dogFood: dogFoodInfo,
        farmProtection: farmProtectionInfo,
        stealCooldown: stealCooldownInfo,
        isProtected: dogFoodActive || farmProtectionActive
      };
    } catch (error) {
      logger.error(`[ProtectionService] 获取防护状态失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 设置农场防护
   * @param {string} userId 用户ID
   * @param {number} protectionMinutes 防护时间（分钟）
   * @returns {Object} 设置结果
   */
  async setFarmProtection(userId, protectionMinutes = 30) {
    try {
      if (!userId) {
        throw new Error('用户ID不能为空');
      }

      const playerData = await this.playerService.getDataService().getPlayer(userId);
      if (!playerData) {
        throw new Error('玩家不存在');
      }

      const now = Date.now();
      const endTime = now + (protectionMinutes * 60 * 1000);

      const newProtection = {
        ...playerData.protection,
        farmProtection: {
          ...playerData.protection.farmProtection,
          endTime: endTime
        }
      };

      await this.playerService.getDataService().updateMixedFields(
        userId,
        { lastUpdated: now },
        { protection: newProtection }
      );


      return {
        success: true,
        protectionMinutes,
        endTime,
        message: `农场防护已激活，持续${protectionMinutes}分钟`
      };
    } catch (error) {
      logger.error(`[ProtectionService] 设置农场防护失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 移除过期的防护效果
   * @param {string} userId 用户ID
   * @returns {Object} 清理结果
   */
  async removeExpiredProtections(userId) {
    try {
      if (!userId) {
        throw new Error('用户ID不能为空');
      }

      const playerData = await this.playerService.getDataService().getPlayer(userId);
      if (!playerData) {
        throw new Error('玩家不存在');
      }

      const now = Date.now();
      let hasChanges = false;
      const clearedEffects = [];

      const newProtection = { ...playerData.protection };
      const newStealing = { ...playerData.stealing };

      // 清除过期的狗粮效果
      if (newProtection.dogFood?.effectEndTime > 0 && newProtection.dogFood.effectEndTime <= now) {
        newProtection.dogFood = {
          type: null,
          effectEndTime: 0
        };
        hasChanges = true;
        clearedEffects.push('狗粮防御');
      }

      // 清除过期的农场防护
      if (newProtection.farmProtection?.endTime > 0 && newProtection.farmProtection.endTime <= now) {
        newProtection.farmProtection.endTime = 0;
        hasChanges = true;
        clearedEffects.push('农场防护');
      }

      // 清除过期的偷菜冷却
      if (newStealing.cooldownEndTime > 0 && newStealing.cooldownEndTime <= now) {
        newStealing.cooldownEndTime = 0;
        hasChanges = true;
        clearedEffects.push('偷菜冷却');
      }

      if (hasChanges) {
        await this.playerService.getDataService().updateMixedFields(
          userId,
          { lastUpdated: now },
          { protection: newProtection, stealing: newStealing }
        );

      }

      return {
        hasChanges,
        clearedEffects
      };
    } catch (error) {
      logger.error(`[ProtectionService] 清除过期防护失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查玩家是否受到保护
   * @param {string} userId 用户ID
   * @returns {Object} 保护状态
   */
  async isProtected(userId) {
    try {
      const status = await this.getProtectionStatus(userId);

      return {
        isProtected: status.isProtected,
        protectionTypes: {
          dogFood: status.dogFood.active,
          farmProtection: status.farmProtection.active
        },
        protectionRemaining: Math.max(
          status.dogFood.remainingTime,
          status.farmProtection.remainingTime
        )
      };
    } catch (error) {
      logger.error(`[ProtectionService] 检查保护状态失败 [${userId}]: ${error.message}`);
      throw error; // 重新抛出错误而不是返回默认值
    }
  }

  /**
   * 获取可用的狗粮类型列表
   * @returns {Array} 狗粮类型配置列表
   */
  getAvailableDogFoodTypes() {
    try {
      const dogFoodConfig = this.config.items.defense;

      return Object.keys(dogFoodConfig).map(type => ({
        type,
        name: dogFoodConfig[type].name,
        price: dogFoodConfig[type].price,
        duration: dogFoodConfig[type].duration,
        description: dogFoodConfig[type].description
      }));
    } catch (error) {
      logger.error(`[ProtectionService] 获取狗粮类型失败: ${error.message}`);
      throw error; // 重新抛出错误而不是返回默认值
    }
  }

  /**
   * 设置偷菜冷却
   * @param {string} userId 用户ID
   * @param {number} cooldownMinutes 冷却时间（分钟）
   */
  async setStealCooldown(userId, cooldownMinutes = 5) {
    try {
      if (!userId) {
        throw new Error('用户ID不能为空');
      }

      const dataService = this.playerService.getDataService();
      const playerData = await dataService.getPlayer(userId);

      if (!playerData) {
        throw new Error('玩家不存在');
      }

      const now = Date.now();
      const newStealing = {
        ...playerData.stealing,
        lastStealTime: now,
        cooldownEndTime: now + cooldownMinutes * 60 * 1000
      };

      await dataService.updateMixedFields(
        userId,
        { lastUpdated: now },
        { stealing: newStealing }
      );

      return {
        success: true,
        endTime: newStealing.cooldownEndTime,
        cooldownMinutes
      };
    } catch (error) {
      logger.error(`[ProtectionService] 设置偷菜冷却失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查是否可以偷菜
   * @param {string} userId 用户ID
   * @returns {Object} 检查结果
   */
  async canSteal(userId) {
    try {
      const status = await this.getProtectionStatus(userId);

      return {
        canSteal: !status.stealCooldown.active,
        reason: status.stealCooldown.active ? '偷菜冷却中' : '可以偷菜',
        cooldownRemaining: status.stealCooldown.remainingTime
      };
    } catch (error) {
      logger.error(`[ProtectionService] 检查偷菜状态失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }
}

export default ProtectionService;