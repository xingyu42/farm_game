/**
 * 计算器工具类 - 提供游戏中各种计算功能
 * 包括土地品质加成、作物产量、经验计算等核心逻辑
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T14:41:00+08:00; Reason: Shrimp Task ID: #5492e748, implementing calculator utilities with land quality bonuses for T8;
// }}
// {{START MODIFICATIONS}}

class Calculator {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * 计算带有土地品质加成的生长时间
   * @param {number} baseGrowTime 基础生长时间（毫秒）
   * @param {string} landQuality 土地品质
   * @returns {number} 实际生长时间（毫秒）
   */
  calculateGrowTime(baseGrowTime, landQuality = 'normal') {
    const qualityConfig = this._getLandQualityConfig(landQuality);
    const timeReduction = qualityConfig?.timeReduction || 0;
    
    // 时间减少百分比计算
    const reduction = timeReduction / 100;
    const actualGrowTime = Math.floor(baseGrowTime * (1 - reduction));
    
    return Math.max(actualGrowTime, 1000); // 最小1秒
  }

  /**
   * 计算带有土地品质加成的产量
   * @param {number} baseYield 基础产量
   * @param {string} landQuality 土地品质
   * @param {number} landHealth 土地健康度（0-100）
   * @returns {number} 实际产量
   */
  calculateYield(baseYield, landQuality = 'normal', landHealth = 100) {
    const qualityConfig = this._getLandQualityConfig(landQuality);
    const productionBonus = qualityConfig?.productionBonus || 0;
    
    // 品质加成计算
    const qualityMultiplier = 1 + (productionBonus / 100);
    
    // 健康度影响计算（健康度低于50%时开始影响产量）
    const healthMultiplier = landHealth >= 50 ? 1 : (landHealth / 50);
    
    const actualYield = Math.floor(baseYield * qualityMultiplier * healthMultiplier);
    
    return Math.max(actualYield, 1); // 最小产量为1
  }

  /**
   * 计算作物经验值
   * @param {string} cropType 作物类型
   * @param {number} quantity 收获数量
   * @param {string} landQuality 土地品质
   * @returns {number} 获得的经验值
   */
  calculateCropExperience(cropType, quantity = 1, landQuality = 'normal') {
    const cropConfig = this._getCropConfig(cropType);
    const baseExp = cropConfig?.experience || 1;
    
    const qualityConfig = this._getLandQualityConfig(landQuality);
    const expBonus = qualityConfig?.experienceBonus || 0;
    
    // 品质经验加成
    const expMultiplier = 1 + (expBonus / 100);
    
    const totalExp = Math.floor(baseExp * quantity * expMultiplier);
    
    return Math.max(totalExp, 1);
  }

  /**
   * 计算玩家等级
   * @param {number} experience 当前经验值
   * @returns {Object} 等级信息
   */
  calculateLevel(experience) {
    if (!this.config?.levels) {
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
    const levels = this.config.levels;
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
   * 计算土地扩张成本
   * @param {number} currentLandCount 当前土地数量
   * @param {number} targetLandCount 目标土地数量
   * @returns {Object} 扩张成本信息
   */
  calculateLandExpansionCost(currentLandCount, targetLandCount) {
    if (!this.config?.land?.expansion) {
      // 默认扩张成本计算
      const baseCost = 1000;
      const costMultiplier = 1.5;
      let totalCost = 0;
      
      for (let i = currentLandCount + 1; i <= targetLandCount; i++) {
        totalCost += Math.floor(baseCost * Math.pow(costMultiplier, i - 7));
      }
      
      return {
        totalCost,
        canAfford: false,
        expansionSteps: []
      };
    }

    const expansionConfig = this.config.land.expansion;
    let totalGoldCost = 0;
    let maxLevelRequired = 1;
    const expansionSteps = [];

    for (let landNum = currentLandCount + 1; landNum <= targetLandCount; landNum++) {
      const landConfig = expansionConfig[landNum];
      
      if (landConfig) {
        totalGoldCost += landConfig.goldCost || 0;
        maxLevelRequired = Math.max(maxLevelRequired, landConfig.levelRequired || 1);
        
        expansionSteps.push({
          landNumber: landNum,
          goldCost: landConfig.goldCost || 0,
          levelRequired: landConfig.levelRequired || 1
        });
      }
    }

    return {
      totalGoldCost,
      maxLevelRequired,
      expansionSteps,
      stepCount: expansionSteps.length
    };
  }

  /**
   * 计算土地品质升级成本
   * @param {string} currentQuality 当前品质
   * @param {string} targetQuality 目标品质
   * @returns {Object} 升级成本信息
   */
  calculateQualityUpgradeCost(currentQuality, targetQuality) {
    const qualityOrder = ['normal', 'copper', 'silver', 'gold'];
    const currentIndex = qualityOrder.indexOf(currentQuality);
    const targetIndex = qualityOrder.indexOf(targetQuality);

    if (currentIndex === -1 || targetIndex === -1 || targetIndex <= currentIndex) {
      return {
        canUpgrade: false,
        error: '无效的品质升级路径'
      };
    }

    let totalGoldCost = 0;
    let maxLevelRequired = 1;
    const materialCosts = {};
    const upgradeSteps = [];

    for (let i = currentIndex + 1; i <= targetIndex; i++) {
      const quality = qualityOrder[i];
      const qualityConfig = this._getLandQualityConfig(quality);
      const upgradeConfig = qualityConfig?.upgrade;

      if (upgradeConfig) {
        totalGoldCost += upgradeConfig.goldCost || 0;
        maxLevelRequired = Math.max(maxLevelRequired, upgradeConfig.levelRequired || 1);

        // 累计材料需求
        if (upgradeConfig.materials) {
          for (const [materialId, quantity] of Object.entries(upgradeConfig.materials)) {
            materialCosts[materialId] = (materialCosts[materialId] || 0) + quantity;
          }
        }

        upgradeSteps.push({
          fromQuality: qualityOrder[i - 1],
          toQuality: quality,
          goldCost: upgradeConfig.goldCost || 0,
          levelRequired: upgradeConfig.levelRequired || 1,
          materials: upgradeConfig.materials || {}
        });
      }
    }

    return {
      canUpgrade: true,
      totalGoldCost,
      maxLevelRequired,
      materialCosts,
      upgradeSteps,
      stepCount: upgradeSteps.length
    };
  }

  /**
   * 计算商店购买/出售价格
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @param {string} operation 操作类型（'buy' | 'sell'）
   * @param {number} playerLevel 玩家等级
   * @returns {Object} 价格信息
   */
  calculateShopPrice(itemId, quantity, operation = 'buy', playerLevel = 1) {
    const itemConfig = this._getItemConfig(itemId);
    
    if (!itemConfig) {
      return {
        success: false,
        error: `找不到物品配置: ${itemId}`
      };
    }

    const basePrice = operation === 'buy' ? itemConfig.buyPrice : itemConfig.sellPrice;
    
    if (!basePrice || basePrice <= 0) {
      return {
        success: false,
        error: `物品 ${itemId} 不支持${operation === 'buy' ? '购买' : '出售'}`
      };
    }

    // 等级折扣（高等级玩家购买便宜，出售贵）
    const levelDiscount = this._calculateLevelDiscount(playerLevel, operation);
    
    // 批量折扣（大量购买/出售时的折扣）
    const bulkDiscount = this._calculateBulkDiscount(quantity, operation);
    
    const finalPrice = Math.floor(basePrice * levelDiscount * bulkDiscount);
    const totalPrice = finalPrice * quantity;

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
      savings: (basePrice - finalPrice) * quantity
    };
  }

  /**
   * 计算仓库容量需求
   * @param {Object} inventory 仓库物品
   * @param {Object} itemsToAdd 要添加的物品
   * @returns {Object} 容量计算结果
   */
  calculateInventorySpace(inventory, itemsToAdd = {}) {
    let currentUsed = 0;
    let afterAddUsed = 0;

    // 计算当前已使用容量
    for (const quantity of Object.values(inventory)) {
      currentUsed += quantity || 0;
    }

    // 计算添加物品后的容量
    const combinedInventory = { ...inventory };
    for (const [itemId, quantity] of Object.entries(itemsToAdd)) {
      combinedInventory[itemId] = (combinedInventory[itemId] || 0) + quantity;
    }

    for (const quantity of Object.values(combinedInventory)) {
      afterAddUsed += quantity || 0;
    }

    return {
      currentUsed,
      afterAddUsed,
      requiredSpace: afterAddUsed - currentUsed,
      itemsToAdd: Object.keys(itemsToAdd).length
    };
  }

  /**
   * 计算偷菜收益
   * @param {string} cropType 作物类型
   * @param {number} baseYield 基础产量
   * @param {string} landQuality 土地品质
   * @param {number} stealerLevel 偷菜者等级
   * @param {number} ownerLevel 土地主人等级
   * @returns {Object} 偷菜收益
   */
  calculateStealYield(cropType, baseYield, landQuality = 'normal', stealerLevel = 1, ownerLevel = 1) {
    // 基础偷菜比例（10-30%）
    const baseStealRatio = 0.2;
    
    // 等级差异影响（偷菜者等级高时收益增加）
    const levelDiff = stealerLevel - ownerLevel;
    const levelBonus = Math.max(-0.1, Math.min(0.1, levelDiff * 0.01));
    
    // 土地品质影响（高品质土地偷菜收益更高）
    const qualityConfig = this._getLandQualityConfig(landQuality);
    const qualityBonus = (qualityConfig?.productionBonus || 0) / 200; // 品质加成的一半
    
    const finalStealRatio = baseStealRatio + levelBonus + qualityBonus;
    const stealYield = Math.floor(baseYield * finalStealRatio);
    
    // 主人损失（通常是偷菜者收益的1.5倍）
    const ownerLoss = Math.floor(stealYield * 1.5);

    return {
      stealerGain: Math.max(stealYield, 1),
      ownerLoss: Math.max(ownerLoss, 1),
      stealRatio: finalStealRatio * 100,
      baseRatio: baseStealRatio * 100,
      levelBonus: levelBonus * 100,
      qualityBonus: qualityBonus * 100
    };
  }

  /**
   * 私有方法：获取土地品质配置
   * @param {string} quality 品质类型
   * @returns {Object} 品质配置
   */
  _getLandQualityConfig(quality) {
    return this.config?.land?.quality?.[quality] || {};
  }

  /**
   * 私有方法：获取作物配置
   * @param {string} cropType 作物类型
   * @returns {Object} 作物配置
   */
  _getCropConfig(cropType) {
    return this.config?.crops?.[cropType] || {};
  }

  /**
   * 私有方法：获取物品配置
   * @param {string} itemId 物品ID
   * @returns {Object} 物品配置
   */
  _getItemConfig(itemId) {
    const items = this.config?.items || {};
    
    // 查找各个类别中的物品
    for (const category of ['crops', 'seeds', 'materials', 'tools', 'landMaterials']) {
      if (items[category] && items[category][itemId]) {
        return items[category][itemId];
      }
    }
    
    return null;
  }

  /**
   * 私有方法：计算等级折扣
   * @param {number} playerLevel 玩家等级
   * @param {string} operation 操作类型
   * @returns {number} 折扣倍数
   */
  _calculateLevelDiscount(playerLevel, operation) {
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
  _calculateBulkDiscount(quantity, operation) {
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

  /**
   * 获取计算器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      hasConfig: !!this.config,
      supportedCalculations: [
        'growTime',
        'yield',
        'experience',
        'level',
        'landExpansion',
        'qualityUpgrade',
        'shopPrice',
        'inventorySpace',
        'stealYield'
      ],
      configModules: this.config ? Object.keys(this.config) : []
    };
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #b795c240, converting CommonJS module.exports to ES Modules export default; Principle_Applied: ModuleSystem-Standardization;}}
export default Calculator;

// {{END MODIFICATIONS}}