/**
 * 玩家数据模型 - 提供玩家数据结构、验证和业务逻辑
 * 支持玩家信息管理、仓库系统、土地管理和游戏统计
 */

import Calculator from '../utils/calculator.js';

// {{CHENGQI: Action: Added; Timestamp: 2025-07-01 19:48:40 +08:00; Reason: Shrimp Task ID: #092f4ab7, creating Player class basic structure to replace dynamic method injection; Principle_Applied: OOP-Encapsulation-TypeSafety;}}
// {{START MODIFICATIONS}}

class Player {
  constructor(data = {}, config = null) {
    this.config = config;
    
    // 基础信息
    this.name = data.name;
    this.level = data.level;
    this.experience = data.experience;
    this.coins = data.coins;
    
    // 土地系统
    this.landCount = data.landCount
    this.lands = data.lands || this._createDefaultLands(this.landCount);
    this.maxLandCount = data.maxLandCount
    
    // 仓库系统
    this.inventory = data.inventory;
    this.inventoryCapacity = data.inventoryCapacity;
    this.inventory_capacity = data.inventory_capacity; // 新字段名兼容
    this.maxInventoryCapacity = data.maxInventoryCapacity;
    
    // 统计数据
    this.stats = data.stats;
    
    // 签到系统
    this.signIn = data.signIn
    
    // 防御系统
    this.protection = data.protection
    
    // 偷菜系统
    this.stealing = data.stealing
    
    // 统计数据
    this.statistics = data.statistics
    
    // 时间戳
    this.createdAt = data.createdAt || Date.now();
    this.lastUpdated = data.lastUpdated || Date.now();
    this.lastActiveTime = data.lastActiveTime || Date.now();
    
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
  static createEmpty(name = '', config = null) {
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
      inventoryCapacity: inventoryConfig.startingCapacity,
      inventory_capacity: inventoryConfig.startingCapacity,
      maxInventoryCapacity: inventoryConfig.maxCapacity,
      createdAt: now,
      lastUpdated: now,
      lastActiveTime: now
    };

    // 使用静态方法生成复杂字段的默认值
    playerData.lands = Player._getDefaultComplexField('lands', config);
    playerData.stats = Player._getDefaultComplexField('stats', config);
    playerData.signIn = Player._getDefaultComplexField('signIn', config);
    playerData.protection = Player._getDefaultComplexField('protection', config);
    playerData.stealing = Player._getDefaultComplexField('stealing', config);
    playerData.statistics = Player._getDefaultComplexField('statistics', config);

    return new Player(playerData, config);
  }

  /**
   * 验证Redis Hash数据的完整性
   * @param {Object} hashData Redis Hash数据
   * @returns {Object} 验证结果
   */
  static validateHashData(hashData) {
    const errors = [];

    if (!hashData || typeof hashData !== 'object') {
      errors.push('Hash数据必须是有效对象');
      return { isValid: false, errors };
    }

    // 检查必要的简单字段
    const requiredSimpleFields = ['name', 'level', 'coins'];
    for (const field of requiredSimpleFields) {
      if (hashData[field] === undefined || hashData[field] === null) {
        errors.push(`缺少必要字段: ${field}`);
      }
    }

    // 验证数值字段格式
    const numericFields = ['level', 'experience', 'coins', 'landCount', 'createdAt'];
    for (const field of numericFields) {
      if (hashData[field] !== undefined && isNaN(parseInt(hashData[field]))) {
        errors.push(`字段 ${field} 必须是有效数值`);
      }
    }

    // 验证JSON字段格式
    const jsonFields = ['lands', 'inventory', 'stats', 'signIn', 'protection', 'stealing', 'statistics'];
    for (const field of jsonFields) {
      if (hashData[field]) {
        try {
          JSON.parse(hashData[field]);
        } catch (error) {
          errors.push(`字段 ${field} 包含无效JSON: ${error.message}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 从Redis Hash数据创建玩家实例
   * @param {Object} hashData Redis Hash数据
   * @param {Object} config 配置对象
   * @returns {Player} 玩家实例
   */
  static fromRawData(hashData, config = null) {
    // 验证输入数据
    const validation = Player.validateHashData(hashData);
    if (!validation.isValid) {
      throw new Error(`Redis Hash数据验证失败: ${validation.errors.join(', ')}`);
    }

    const playerData = {};

    // 定义简单字段（与PlayerService保持一致）
    const simpleFields = [
      'name', 'level', 'experience', 'coins', 'landCount', 'maxLandCount',
      'inventoryCapacity', 'inventory_capacity', 'maxInventoryCapacity',
      'createdAt', 'lastUpdated', 'lastActiveTime'
    ];

    // 定义复杂字段（与PlayerService保持一致）
    const complexFields = [
      'lands', 'inventory', 'stats', 'signIn', 'protection', 'stealing', 'statistics'
    ];

    // 处理简单字段
    for (const field of simpleFields) {
      if (hashData[field] !== undefined) {
        // 数值字段转换
        if (['level', 'experience', 'coins', 'landCount', 'maxLandCount',
             'inventoryCapacity', 'inventory_capacity', 'maxInventoryCapacity',
             'createdAt', 'lastUpdated', 'lastActiveTime'].includes(field)) {
          const numValue = parseInt(hashData[field]);
          playerData[field] = isNaN(numValue) ? 0 : numValue;
        } else {
          playerData[field] = hashData[field]
        }
      } else {
        // 为缺失的简单字段提供默认值
        if (['level'].includes(field)) {
          playerData[field] = 1;
        } else if (['experience', 'coins', 'landCount', 'maxLandCount',
                   'inventoryCapacity', 'inventory_capacity', 'maxInventoryCapacity'].includes(field)) {
          playerData[field] = 0;
        } else if (['createdAt', 'lastUpdated', 'lastActiveTime'].includes(field)) {
          playerData[field] = Date.now();
        } else {
          playerData[field] = '';
        }
      }
    }

    // 处理复杂字段（JSON反序列化）
    for (const field of complexFields) {
      if (hashData[field]) {
        try {
          const parsedData = JSON.parse(hashData[field]);
          playerData[field] = parsedData;
        } catch (error) {
          console.warn(`[Player] 解析复杂字段失败 [${field}]: ${error.message}`);
          playerData[field] = Player._getDefaultComplexField(field, config);
        }
      } else {
        playerData[field] = Player._getDefaultComplexField(field, config);
      }
    }

    // 确保关键字段存在
    if (!playerData.name) playerData.name = '';
    if (!playerData.level || playerData.level < 1) playerData.level = 1;
    if (playerData.coins < 0) playerData.coins = 0;

    return new Player(playerData, config);
  }

  /**
   * 从普通对象数据创建玩家实例
   * @param {Object} rawData 普通对象数据
   * @param {Object} config 配置对象
   * @returns {Player} 玩家实例
   */
  static fromObjectData(rawData, config = null) {
    return new Player(rawData, config);
  }

  /**
   * 创建默认土地数组
   * @param {number} landCount 土地数量
   * @returns {Array} 土地数组
   * @private
   */
  _createDefaultLands(landCount) {
    return new Array(landCount).fill(null).map((_, i) => ({
      id: i + 1,
      crop: null,
      quality: 'normal',
      plantTime: null,
      harvestTime: null,
      status: 'empty'
    }));
  }

  /**
   * 获取复杂字段的默认值
   * @param {string} field 字段名
   * @param {Object} config 配置对象
   * @returns {any} 默认值
   */
  static _getDefaultComplexField(field, config = null) {
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
      case 'stats':
        return {
          total_signin_days: 0,
          total_income: 0,
          total_expenses: 0,
          consecutive_signin_days: 0
        };
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

    if (!Number.isInteger(this.inventoryCapacity) || this.inventoryCapacity < 0) {
      errors.push('仓库容量必须是非负整数');
    }

    if (!Number.isInteger(this.inventory_capacity) || this.inventory_capacity < 0) {
      errors.push('仓库容量(新字段)必须是非负整数');
    }

    if (this.inventoryCapacity > this.maxInventoryCapacity) {
      errors.push('当前仓库容量不能超过最大仓库容量');
    }

    // 验证复杂对象结构
    if (typeof this.stats !== 'object' || this.stats === null) {
      errors.push('统计数据必须是对象');
    }

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
    return this.inventoryCapacity < this.maxInventoryCapacity;
  }

  /**
   * 获取仓库使用情况
   * 使用统一的Calculator.calculateInventoryUsage方法，与PlayerService._addPlayerDataMethods.getInventoryUsage保持一致
   * @returns {number} 仓库使用量
   */
  getInventoryUsage() {
    return Calculator.calculateInventoryUsage(this.inventory);
  }

  /**
   * 获取狗粮防护状态
   * 与PlayerService._addPlayerDataMethods.getDogFoodStatus保持完全一致的行为
   * @returns {string} 防护状态描述
   */
  getDogFoodStatus() {
    const now = Date.now();
    if (this.protection?.dogFood?.effectEndTime > now) {
      const remainingTime = Math.ceil((this.protection.dogFood.effectEndTime - now) / (1000 * 60));
      return `${this.protection.dogFood.type} (${remainingTime}分钟)`;
    }
    return '无防护';
  }

  /**
   * 获取偷菜冷却状态
   * 与PlayerService._addPlayerDataMethods.getStealCooldownStatus保持完全一致的行为
   * @returns {string} 冷却状态描述
   */
  getStealCooldownStatus() {
    const now = Date.now();
    if (this.stealing?.cooldownEndTime > now) {
      const remainingTime = Math.ceil((this.stealing.cooldownEndTime - now) / (1000 * 60));
      return `冷却中 (${remainingTime}分钟)`;
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
    const capacity = this.inventory_capacity || this.inventoryCapacity;

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
      inventoryCapacity: this.inventoryCapacity,
      inventory_capacity: this.inventory_capacity,
      maxInventoryCapacity: this.maxInventoryCapacity,
      stats: this.stats,
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
   * 转换为Redis Hash存储格式
   * @returns {Object} Redis Hash格式的数据
   */
  toHashData() {
    const hashData = {};

    // 简单字段（与PlayerService保持一致）
    const simpleFields = [
      'name', 'level', 'experience', 'coins', 'landCount', 'maxLandCount',
      'inventoryCapacity', 'inventory_capacity', 'maxInventoryCapacity',
      'createdAt', 'lastUpdated', 'lastActiveTime'
    ];

    // 复杂字段（与PlayerService保持一致）
    const complexFields = [
      'lands', 'inventory', 'stats', 'signIn', 'protection', 'stealing', 'statistics'
    ];

    // 处理简单字段
    for (const field of simpleFields) {
      if (this[field] !== undefined) {
        hashData[field] = this[field].toString();
      }
    }

    // 处理复杂字段（JSON序列化）
    for (const field of complexFields) {
      if (this[field] !== undefined) {
        hashData[field] = JSON.stringify(this[field]);
      }
    }

    return hashData;
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
      inventoryCapacity: this.inventoryCapacity,
      isOnline: this.isOnline(),
      lastActiveTime: this.lastActiveTime
    };
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 19:48:40 +08:00; Reason: Shrimp Task ID: #f25ebd87, implementing Player class validation and serialization methods following existing model patterns; Principle_Applied: OOP-DataIntegrity-Serialization;}}
export default Player;

// {{END MODIFICATIONS}}
