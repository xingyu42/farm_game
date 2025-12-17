/**
 * 玩家数据模型 - 提供玩家数据结构、验证和业务逻辑
 * 支持玩家信息管理、仓库系统、土地管理和游戏统计
 */

import Calculator from '../utils/calculator.js';
import { CommonUtils } from '../utils/CommonUtils.js';

// {{CHENGQI: Action: Added; Timestamp: 2025-07-01 19:48:40 +08:00; Reason: Shrimp Task ID: #092f4ab7, creating Player class basic structure to replace dynamic method injection; Principle_Applied: OOP-Encapsulation-TypeSafety;}}
// {{START MODIFICATIONS}}

class Player {
  constructor(data = {}, config) {
    this.config = config;

    // 基础信息
    this.name = data.name;
    this.level = data.level;
    this.experience = data.experience;
    this.coins = data.coins;

    // 土地系统
    this.landCount = data.landCount
    this.lands = data.lands;
    this.maxLandCount = data.maxLandCount

    // 仓库系统
    this.inventory = data.inventory;
    // 统一使用 inventory_capacity，从旧字段名读取以保持向后兼容
    this.inventory_capacity = data.inventory_capacity
      || data.inventoryCapacity
      || config?.items?.inventory?.startingCapacity
      || 100;
    this.maxInventoryCapacity = data.maxInventoryCapacity;

    // 向后兼容的仓库容量访问器（只读）
    Object.defineProperty(this, 'inventoryCapacity', {
      get() { return this.inventory_capacity; },
      enumerable: true,
      configurable: true
    });

    // 签到系统
    this.signIn = data.signIn

    // 防御系统
    this.protection = data.protection

    // 偷菜系统
    this.stealing = data.stealing

    // 统计数据
    this.statistics = data.statistics

    // 时间戳
    this.createdAt = data.createdAt;
    this.lastUpdated = data.lastUpdated;
    this.lastActiveTime = data.lastActiveTime;

    // 向后兼容的金币访问器
    Object.defineProperty(this, 'gold', {
      get() { return this.coins; },
      set(value) { this.coins = value; },
      enumerable: true,
      configurable: true
    });
  }

  /**
   * 创建空玩家
   * @param {string} name 玩家名称
   * @param {Object} config 配置对象
   * @returns {Player} 玩家实例
   */
  static createEmpty(name = '', config) {
    const defaultConfig = config?.levels?.default
    const landConfig = config?.land?.default
    const inventoryConfig = config?.items?.inventory

    const now = Date.now();

    const playerData = {
      name,
      level: 1,
      experience: 0,
      coins: defaultConfig.startingCoins,
      landCount: landConfig.startingLands,
      maxLandCount: landConfig.maxLands,
      inventory: {},
      inventory_capacity: inventoryConfig.startingCapacity,
      maxInventoryCapacity: inventoryConfig.maxCapacity,
      createdAt: now,
      lastUpdated: now,
      lastActiveTime: now
    };

    // 使用静态方法生成复杂字段的默认值
    playerData.lands = Player._getDefaultComplexField('lands', config);
    playerData.signIn = Player._getDefaultComplexField('signIn', config);
    playerData.protection = Player._getDefaultComplexField('protection', config);
    playerData.stealing = Player._getDefaultComplexField('stealing', config);
    playerData.statistics = Player._getDefaultComplexField('statistics', config);

    return new Player(playerData, config);
  }





  /**
   * 从普通对象数据创建玩家实例
   * @param {Object} rawData 普通对象数据
   * @param {Object} config 配置对象
   * @returns {Player} 玩家实例
   */
  static fromObjectData(rawData, config) {
    return new Player(rawData, config);
  }



  /**
   * 获取复杂字段的默认值
   * @param {string} field 字段名
   * @param {Object} config 配置对象
   * @returns {any} 默认值
   */
  static _getDefaultComplexField(field, config) {
    const landConfig = config?.land?.default

    switch (field) {
      case 'lands':
        return new Array(landConfig.startingLands).fill(null).map((_, i) => ({
          id: i + 1,
          crop: null,
          quality: 'normal',
          plantTime: null,
          harvestTime: null,
          status: 'empty'
        }));
      case 'inventory':
        return {};
      case 'signIn':
        return {
          lastSignDate: null,
          consecutiveDays: 0,
          totalSignDays: 0
        };
      case 'protection':
        return {
          dogFood: {
            type: null,
            effectEndTime: 0,
            defenseBonus: 0
          },
          farmProtection: {
            endTime: 0
          }
        };
      case 'stealing':
        return {
          lastStealTime: 0,
          cooldownEndTime: 0
        };
      case 'statistics':
        return {
          totalHarvested: 0,
          totalStolenFrom: 0,
          totalStolenBy: 0,
          totalMoneyEarned: 0,
          totalMoneySpent: 0
        };
      default:
        return {};
    }
  }

  /**
   * 验证玩家数据
   * @returns {Object} 验证结果 {isValid: boolean, errors: string[]}
   */
  validate() {
    const errors = [];

    // 验证基础字段
    if (typeof this.name !== 'string') {
      errors.push('玩家名称必须是字符串');
    }

    if (!Number.isInteger(this.level) || this.level < 1) {
      errors.push('玩家等级必须是正整数');
    }

    if (!Number.isInteger(this.experience) || this.experience < 0) {
      errors.push('经验值必须是非负整数');
    }

    if (!Number.isInteger(this.coins) || this.coins < 0) {
      errors.push('金币数量必须是非负整数');
    }

    // 验证土地系统
    if (!Number.isInteger(this.landCount) || this.landCount < 0) {
      errors.push('土地数量必须是非负整数');
    }

    if (this.landCount > this.maxLandCount) {
      errors.push('当前土地数量不能超过最大土地数量');
    }

    if (!Array.isArray(this.lands)) {
      errors.push('土地列表必须是数组');
    } else if (this.lands.length !== this.landCount) {
      errors.push('土地列表长度必须与土地数量一致');
    }

    // 验证仓库系统
    if (typeof this.inventory !== 'object' || this.inventory === null) {
      errors.push('仓库必须是对象');
    }

    if (!Number.isInteger(this.inventory_capacity) || this.inventory_capacity < 0) {
      errors.push('仓库容量必须是非负整数');
    }

    if (this.inventory_capacity > this.maxInventoryCapacity) {
      errors.push('当前仓库容量不能超过最大仓库容量');
    }

    // 验证复杂对象结构
    if (typeof this.signIn !== 'object' || this.signIn === null) {
      errors.push('签到数据必须是对象');
    }

    if (typeof this.protection !== 'object' || this.protection === null) {
      errors.push('防护数据必须是对象');
    }

    if (typeof this.stealing !== 'object' || this.stealing === null) {
      errors.push('偷菜数据必须是对象');
    }

    if (typeof this.statistics !== 'object' || this.statistics === null) {
      errors.push('统计数据必须是对象');
    }

    // 验证时间戳
    if (!Number.isInteger(this.createdAt) || this.createdAt < 0) {
      errors.push('创建时间必须是有效的时间戳');
    }

    if (!Number.isInteger(this.lastUpdated) || this.lastUpdated < 0) {
      errors.push('最后更新时间必须是有效的时间戳');
    }

    if (!Number.isInteger(this.lastActiveTime) || this.lastActiveTime < 0) {
      errors.push('最后活跃时间必须是有效的时间戳');
    }

    // 验证时间逻辑
    if (this.lastUpdated < this.createdAt) {
      errors.push('最后更新时间不能早于创建时间');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 检查玩家是否为新玩家
   * @returns {boolean} 是否为新玩家
   */
  isNewPlayer() {
    return this.level === 1 && this.experience === 0 && this.getInventoryUsage() === 0;
  }

  /**
   * 检查玩家数据是否有效
   * @returns {boolean} 数据是否有效
   */
  isValid() {
    return this.validate().isValid;
  }

  /**
   * 检查玩家是否在线（基于最后活跃时间）
   * @param {number} timeoutMs 超时时间（毫秒），默认30分钟
   * @returns {boolean} 是否在线
   */
  isOnline(timeoutMs = 30 * 60 * 1000) {
    return (Date.now() - this.lastActiveTime) < timeoutMs;
  }

  /**
   * 检查玩家是否可以扩张土地
   * @returns {boolean} 是否可以扩张
   */
  canExpandLand() {
    return this.landCount < this.maxLandCount;
  }

  /**
   * 检查玩家是否可以扩张仓库
   * @returns {boolean} 是否可以扩张
   */
  canExpandInventory() {
    return this.inventory_capacity < this.maxInventoryCapacity;
  }

  /**
   * 获取仓库使用情况
   * 使用统一的Calculator.getTotalItems方法，与PlayerService._addPlayerDataMethods.getInventoryUsage保持一致
   * @returns {number} 仓库使用量
   */
  getInventoryUsage() {
    return Calculator.getTotalItems(this.inventory);
  }

  /**
   * 获取狗粮防护状态
   * @returns {string} 防护状态描述
   */
  getDogFoodStatus() {
    const now = Date.now();
    if (this.protection?.dogFood?.effectEndTime > now) {
      const remainingMinutes = CommonUtils.getRemainingMinutes(this.protection.dogFood.effectEndTime, now);
      return `${this.protection.dogFood.type} (${remainingMinutes}分钟)`;
    }
    return '无防护';
  }

  /**
   * 获取偷菜冷却状态
   * @returns {string} 冷却状态描述
   */
  getStealCooldownStatus() {
    const now = Date.now();
    if (this.stealing?.cooldownEndTime > now) {
      const remainingMinutes = CommonUtils.getRemainingMinutes(this.stealing.cooldownEndTime, now);
      return `冷却中 (${remainingMinutes}分钟)`;
    }
    return '可偷菜';
  }

  /**
   * 检查是否有狗粮防护
   * @param {number} currentTime 当前时间戳
   * @returns {boolean} 是否有防护
   */
  hasDogFoodProtection(currentTime = Date.now()) {
    return this.protection?.dogFood?.effectEndTime > currentTime;
  }

  /**
   * 检查是否在偷菜冷却中
   * @param {number} currentTime 当前时间戳
   * @returns {boolean} 是否在冷却中
   */
  isStealOnCooldown(currentTime = Date.now()) {
    return this.stealing?.cooldownEndTime > currentTime;
  }

  /**
   * 获取仓库容量信息
   * @returns {Object} 仓库容量信息
   */
  getInventoryInfo() {
    const usage = this.getInventoryUsage();
    const capacity = this.inventory_capacity;

    return {
      usage,
      capacity,
      available: capacity - usage,
      usagePercentage: Math.round((usage / capacity) * 100),
      isFull: usage >= capacity
    };
  }

  /**
   * 获取玩家显示信息
   * @returns {Object} 显示信息
   */
  getDisplayInfo() {
    const inventoryInfo = this.getInventoryInfo();
    const dogFoodStatus = this.getDogFoodStatus();
    const stealStatus = this.getStealCooldownStatus();

    return {
      name: this.name,
      level: this.level,
      experience: this.experience,
      coins: this.coins,
      gold: this.gold, // 向后兼容
      landCount: this.landCount,
      maxLandCount: this.maxLandCount,
      inventoryUsage: inventoryInfo.usage,
      inventoryCapacity: inventoryInfo.capacity,
      inventoryAvailable: inventoryInfo.available,
      inventoryFull: inventoryInfo.isFull,
      dogFoodStatus,
      stealStatus,
      hasDogFoodProtection: this.hasDogFoodProtection(),
      isStealOnCooldown: this.isStealOnCooldown(),
      displayText: `${this.name} Lv.${this.level} (${this.coins}金币)`
    };
  }

  /**
   * 转换为JSON对象
   * @returns {Object} JSON对象
   */
  toJSON() {
    return {
      name: this.name,
      level: this.level,
      experience: this.experience,
      coins: this.coins,
      landCount: this.landCount,
      lands: this.lands,
      maxLandCount: this.maxLandCount,
      inventory: this.inventory,
      inventory_capacity: this.inventory_capacity,
      inventoryCapacity: this.inventory_capacity, // 向后兼容：导出旧字段名
      maxInventoryCapacity: this.maxInventoryCapacity,
      signIn: this.signIn,
      protection: this.protection,
      stealing: this.stealing,
      statistics: this.statistics,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
      lastActiveTime: this.lastActiveTime
    };
  }

  /**
   * 复制玩家实例（深拷贝）
   * @returns {Player} 新的玩家实例
   */
  clone() {
    // 使用JSON序列化/反序列化进行深拷贝
    const jsonData = this.toJSON();
    const clonedData = JSON.parse(JSON.stringify(jsonData));
    return new Player(clonedData, this.config);
  }

  /**
   * 创建玩家实例的浅拷贝
   * @returns {Player} 新的玩家实例（浅拷贝）
   */
  shallowClone() {
    return new Player(this.toJSON(), this.config);
  }

  /**
   * 获取玩家摘要信息（用于列表显示）
   * @returns {Object} 摘要信息
   */
  getSummary() {
    return {
      name: this.name,
      level: this.level,
      coins: this.coins,
      landCount: this.landCount,
      inventoryUsage: this.getInventoryUsage(),
      inventoryCapacity: this.inventory_capacity, // 使用标准字段，但保持旧字段名用于向后兼容
      isOnline: this.isOnline(),
      lastActiveTime: this.lastActiveTime
    };
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 19:48:40 +08:00; Reason: Shrimp Task ID: #f25ebd87, implementing Player class validation and serialization methods following existing model patterns; Principle_Applied: OOP-DataIntegrity-Serialization;}}
export default Player;

// {{END MODIFICATIONS}}
