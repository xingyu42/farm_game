/**
 * @fileoverview 游戏计算器 - 土地加成、产量、经验值计算
 *
 * Input:
 * - ./ItemResolver.js - ItemResolver (物品配置查询)
 * - ./CommonUtils.js - CommonUtils (通用工具函数)
 *
 * Output:
 * - Calculator (default) - 游戏计算器类,提供静态方法:
 *   - calculateGrowTime: 计算带土地品质加成的生长时间
 *   - calculateYield: 计算带土地品质加成的作物产量
 *   - getTotalItems: 统计仓库总物品数量
 *   - calculateExpGain: 计算经验值增益
 *   - calculatePrice: 计算价格(含浮动)
 *
 * Pos: 工具类层,封装所有游戏数值计算逻辑,确保计算规则统一
 */

import ItemResolver from './ItemResolver.js';
import { CommonUtils } from './CommonUtils.js';

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T14:41:00+08:00; Reason: Shrimp Task ID: #5492e748, implementing calculator utilities with land quality bonuses for T8;
// }}
// {{START MODIFICATIONS}}

class Calculator {
  /**
   * 计算带有土地品质加成的生长时间
   * @param {number} baseGrowTime 基础生长时间（毫秒）
   * @param {string} landQuality 土地品质
   * @param {Object} config 配置
   * @returns {number} 实际生长时间（毫秒）
   */
  static calculateGrowTime(baseGrowTime, landQuality = 'normal', config) {
    const qualityConfig = Calculator._getLandQualityConfig(landQuality, config);
    const timeReduction = Number(qualityConfig.timeReduction) || 0;

    // 时间减少百分比计算
    const reduction = timeReduction / 100;
    const actualGrowTime = Math.floor(baseGrowTime * (1 - reduction));

    return Math.max(actualGrowTime, 1000); // 最小1秒
  }

  /**
   * 计算带有土地品质加成的产量
   * @param {number} baseYield 基础产量
   * @param {string} landQuality 土地品质
   * @param {Object} config 配置
   * @returns {number} 实际产量
   */
  static calculateYield(baseYield, landQuality = 'normal', config) {
    const qualityConfig = Calculator._getLandQualityConfig(landQuality, config);
    const productionBonus = Number(qualityConfig.productionBonus) || 0;

    // 品质加成计算
    const qualityMultiplier = 1 + (productionBonus / 100);

    const actualYield = Math.floor(baseYield * qualityMultiplier);

    return Math.max(actualYield, 1); // 最小产量为1
  }

  /**
   * 获取土地品质对应的产量加成倍数
   * 与 calculateYield 中的品质加成逻辑保持一致
   * @param {string} landQuality 土地品质
   * @param {Object} config 配置
   * @returns {number} 倍数（例如 1.2 表示 +20%）
   */
  static getQualityMultiplier(landQuality = 'normal', config) {
    const qualityConfig = Calculator._getLandQualityConfig(landQuality, config) || { productionBonus: 0 };
    const productionBonus = Number(qualityConfig.productionBonus) || 0;
    return 1 + (productionBonus / 100);
  }

  /**
   * 获取土地品质对应的经验加成倍数
   * @param {string} landQuality 土地品质
   * @param {Object} config 配置
   * @returns {number} 倍数（例如 1.28 表示 +28%）
   */
  static getExperienceMultiplier(landQuality = 'normal', config) {
    const qualityConfig = Calculator._getLandQualityConfig(landQuality, config) || { experienceBonus: 0 };
    const experienceBonus = Number(qualityConfig.experienceBonus) || 0;
    return 1 + (experienceBonus / 100);
  }

  /**
   * 计算作物经验值
   * @param {string} cropType 作物类型
   * @param {number} quantity 收获数量
   * @param {string} landQuality 土地品质
   * @param {Object} config 配置
   * @returns {number} 获得的经验值
   */
  static calculateCropExperience(cropType, quantity = 1, landQuality = 'normal', config) {
    const cropConfig = Calculator._getCropConfig(cropType, config);
    const baseExp = cropConfig.experience;

    const qualityConfig = Calculator._getLandQualityConfig(landQuality, config);
    const expBonus = Number(qualityConfig.experienceBonus) || 0;

    // 品质经验加成
    const expMultiplier = 1 + (expBonus / 100);

    const totalExp = Math.floor(baseExp * quantity * expMultiplier);

    return Math.max(totalExp, 1);
  }

  /**
   * 计算玩家等级
   * @param {number} experience 当前经验值
   * @param {Object} config 配置
   * @returns {Object} 等级信息
   */
  static calculateLevel(experience, config) {
    if (!config?.levels) {
      // 默认等级计算公式
      const level = Math.floor(Math.sqrt(experience / 100)) + 1;
      const currentLevelExp = (level - 1) * (level - 1) * 100;
      const nextLevelExp = level * level * 100;

      return {
        level,
        currentExp: experience,
        currentLevelExp,
        nextLevelExp,
        expToNext: nextLevelExp - experience,
        progress: ((experience - currentLevelExp) / (nextLevelExp - currentLevelExp)) * 100
      };
    }

    // 基于配置的等级计算
    const levels = config.levels;
    let level = 1;
    let currentLevelExp = 0;

    for (const [levelStr, levelData] of Object.entries(levels)) {
      const levelNum = parseInt(levelStr);
      if (experience >= levelData.experience) {
        level = levelNum;
        currentLevelExp = levelData.experience;
      } else {
        break;
      }
    }

    const nextLevel = level + 1;
    const nextLevelData = levels[nextLevel];
    const nextLevelExp = nextLevelData?.experience || currentLevelExp + 1000;

    return {
      level,
      currentExp: experience,
      currentLevelExp,
      nextLevelExp,
      expToNext: nextLevelExp - experience,
      progress: ((experience - currentLevelExp) / (nextLevelExp - currentLevelExp)) * 100
    };
  }

  /**
   * 计算商店购买/出售价格
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @param {string} operation 操作类型（'buy' | 'sell'）
   * @param {number} playerLevel 玩家等级
   * @param {Object} config 配置
   * @returns {Object} 价格信息
   */
  static calculateShopPrice(itemId, quantity, operation = 'buy', playerLevel = 1, config) {
    const itemConfig = Calculator._getItemConfig(itemId, config);

    if (!itemConfig) {
      return {
        success: false,
        error: `找不到物品配置: ${itemId}`
      };
    }

    const basePrice = itemConfig.price;

    if (!basePrice || basePrice <= 0) {
      return {
        success: false,
        error: `物品 ${itemId} 不支持交易`
      };
    }

    // 等级折扣（高等级玩家购买便宜，出售贵）
    const levelDiscount = Calculator._calculateLevelDiscount(playerLevel, operation);

    // 批量折扣（大量购买/出售时的折扣）
    const bulkDiscount = Calculator._calculateBulkDiscount(quantity, operation);

    const finalPrice = Math.floor(basePrice * levelDiscount * bulkDiscount);
    const totalPrice = CommonUtils.calcCoins(finalPrice, quantity);

    return {
      success: true,
      itemId,
      quantity,
      operation,
      basePrice,
      finalPrice,
      totalPrice,
      levelDiscount: (1 - levelDiscount) * 100,
      bulkDiscount: (1 - bulkDiscount) * 100,
      savings: CommonUtils.calcCoins(basePrice - finalPrice, quantity)
    };
  }

  /**
   * 计算仓库物品总数量（统一方法）
   * 统一PlayerService._addPlayerDataMethods.getInventoryUsage和InventoryService._calculateInventoryUsage的逻辑
   * @param {Object} inventory 仓库物品对象
   * @returns {number} 物品总数量
   * @static
   * @example
   * // 对象格式仓库（包含quantity字段）
   * Calculator.getTotalItems({
   *   'wheat': { quantity: 10, name: '小麦' },
   *   'corn': { quantity: 5, name: '玉米' }
   * }); // 返回 15
   *
   * // 直接数值格式仓库
   * Calculator.getTotalItems({
   *   'wheat': 10,
   *   'corn': 5
   * }); // 返回 15
   *
   * // Item实例格式（支持Item模型）
   * Calculator.getTotalItems({
   *   'wheat': itemInstance1, // itemInstance.quantity = 10
   *   'corn': itemInstance2   // itemInstance.quantity = 5
   * }); // 返回 15
   */
  static getTotalItems(inventory) {
    if (!inventory || typeof inventory !== 'object') {
      return 0;
    }

    return Object.values(inventory).reduce((sum, item) => {
      // 处理两种数据格式：
      // 1. 直接数值：{ itemId: quantity }
      // 2. 对象格式：{ itemId: { quantity: number, ... } }
      if (typeof item === 'number') {
        return sum + (item || 0);
      } else if (typeof item === 'object' && item !== null) {
        return sum + (item.quantity || 0);
      }
      return sum;
    }, 0);
  }

  /**
   * @deprecated 使用 getTotalItems 代替
   * @param {Object} inventory 仓库物品对象
   * @returns {number} 物品总数量
   */
  static calculateInventoryUsage(inventory) {
    return Calculator.getTotalItems(inventory);
  }

  /**
   * 计算仓库容量需求
   * @param {Object} inventory 仓库物品
   * @param {Object} itemsToAdd 要添加的物品
   * @returns {Object} 容量计算结果
   */
  static calculateInventorySpace(inventory, itemsToAdd = {}) {
    // 使用统一的计算方法
    const currentUsed = Calculator.getTotalItems(inventory);

    // 计算添加物品后的容量
    const combinedInventory = { ...inventory };
    for (const [itemId, quantity] of Object.entries(itemsToAdd)) {
      if (typeof combinedInventory[itemId] === 'object' && combinedInventory[itemId] !== null) {
        // 对象格式
        combinedInventory[itemId] = {
          ...combinedInventory[itemId],
          quantity: (combinedInventory[itemId].quantity || 0) + quantity
        };
      } else {
        // 直接数值格式
        combinedInventory[itemId] = (combinedInventory[itemId] || 0) + quantity;
      }
    }

    const afterAddUsed = Calculator.getTotalItems(combinedInventory);

    return {
      currentUsed,
      afterAddUsed,
      requiredSpace: afterAddUsed - currentUsed,
      itemsToAdd: Object.keys(itemsToAdd).length
    };
  }

  /**
   * 私有方法：获取土地品质配置
   * @param {string} quality 品质类型
   * @param {Object} config 配置
   * @returns {Object} 品质配置
   */
  static _getLandQualityConfig(quality, config) {
    const qualityMap = config?.land?.quality;
    if (!qualityMap || typeof qualityMap !== 'object') {
      return { timeReduction: 0, productionBonus: 0, experienceBonus: 0 };
    }

    return qualityMap[quality] || qualityMap.normal || { timeReduction: 0, productionBonus: 0, experienceBonus: 0 };
  }

  /**
   * 私有方法：获取作物配置
   * @param {string} cropType 作物类型
   * @param {Object} config 配置
   * @returns {Object} 作物配置
   */
  static _getCropConfig(cropType, config) {
    return config?.crops?.[cropType];
  }

  /**
   * 私有方法：获取物品配置 - 使用统一的ItemResolver
   * @param {string} itemId 物品ID
   * @param {Object} config 配置
   * @returns {Object} 物品配置
   */
  static _getItemConfig(itemId, config) {
    if (!config) {
      logger?.warn?.('[Calculator] config未提供，无法获取物品配置');
      return null;
    }

    try {
      const resolver = new ItemResolver(config);
      return resolver.findItemById(itemId);
    } catch (error) {
      logger?.warn?.(`[Calculator] ItemResolver初始化失败: ${error?.message || error}`);
      return null;
    }
  }

  /**
   * 私有方法：计算等级折扣
   * @param {number} playerLevel 玩家等级
   * @param {string} operation 操作类型
   * @returns {number} 折扣倍数
   */
  static _calculateLevelDiscount(playerLevel, operation) {
    // 每10级提供1%的折扣
    const discountRate = Math.floor(playerLevel / 10) * 0.01;
    const maxDiscount = 0.1; // 最大10%折扣

    const actualDiscount = Math.min(discountRate, maxDiscount);

    if (operation === 'buy') {
      return 1 - actualDiscount; // 购买时减少成本
    } else {
      return 1 + actualDiscount; // 出售时增加收益
    }
  }

  /**
   * 私有方法：计算批量折扣
   * @param {number} quantity 数量
   * @param {string} operation 操作类型
   * @returns {number} 折扣倍数
   */
  static _calculateBulkDiscount(quantity, operation) {
    if (quantity < 10) return 1; // 少于10个不打折

    // 每增加10个提供0.5%折扣，最大5%
    const discountRate = Math.floor(quantity / 10) * 0.005;
    const maxDiscount = 0.05;

    const actualDiscount = Math.min(discountRate, maxDiscount);

    if (operation === 'buy') {
      return 1 - actualDiscount;
    } else {
      return 1 - actualDiscount * 0.5; // 出售时折扣减半
    }
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 19:48:40 +08:00; Reason: Shrimp Task ID: #10c63387, adding static calculateInventoryUsage method to unify inventory calculation logic; Principle_Applied: DRY-CodeReuse-Standardization;}}
// {{CHENGQI: Action: Modified; Timestamp: 2025-07-13 15:15:00 +08:00; Reason: PlantingService重构测试, converting to default export for consistency; Principle_Applied: ModuleSystem-Standardization;}}
export default Calculator;

// {{END MODIFICATIONS}}
