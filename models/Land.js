/**
 * 土地数据模型 - 提供土地数据结构、验证和业务逻辑
 * 支持土地状态管理、品质系统和扩张功能
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T14:41:00+08:00; Reason: Shrimp Task ID: #5492e748, implementing Land data model for T8;
// }}
// {{START MODIFICATIONS}}

class Land {
  constructor(data = {}, config = null) {
    this.config = config;
    
    // 基础属性
    this.id = data.id || null;
    this.quality = data.quality || 'normal';
    this.status = data.status || 'empty';
    
    // 作物信息
    this.crop = data.crop || null;
    this.plantTime = data.plantTime || null;
    this.harvestTime = data.harvestTime || null;
    
    // 土地状态
    this.health = data.health || 100;
    this.needsWater = data.needsWater || false;
    this.hasPests = data.hasPests || false;
    this.stealable = data.stealable || false;
    
    // 扩展属性
    this.lastUpgradeTime = data.lastUpgradeTime || null;
    this.upgradeLevel = data.upgradeLevel || 0;
  }

  /**
   * 创建空土地
   * @param {number} id 土地ID
   * @param {string} quality 土地品质
   * @returns {Land} 土地实例
   */
  static createEmpty(id, quality = 'normal') {
    return new Land({
      id,
      quality,
      status: 'empty',
      health: 100,
      needsWater: false,
      hasPests: false,
      stealable: false
    });
  }

  /**
   * 从原始数据创建土地实例
   * @param {Object} rawData 原始数据
   * @param {Object} config 配置对象
   * @returns {Land} 土地实例
   */
  static fromRawData(rawData, config = null) {
    return new Land(rawData, config);
  }

  /**
   * 验证土地数据
   * @returns {Object} 验证结果
   */
  validate() {
    const errors = [];

    // 验证必要字段
    if (!this.id || this.id < 1) {
      errors.push('土地ID必须是正整数');
    }

    // 验证品质
    const validQualities = ['normal', 'copper', 'silver', 'gold'];
    if (!validQualities.includes(this.quality)) {
      errors.push(`土地品质必须是以下之一: ${validQualities.join(', ')}`);
    }

    // 验证状态
    const validStatuses = ['empty', 'growing', 'ready', 'withered'];
    if (!validStatuses.includes(this.status)) {
      errors.push(`土地状态必须是以下之一: ${validStatuses.join(', ')}`);
    }

    // 验证健康度
    if (this.health < 0 || this.health > 100) {
      errors.push('土地健康度必须在0-100之间');
    }

    // 验证时间字段
    if (this.plantTime && (!Number.isInteger(this.plantTime) || this.plantTime < 0)) {
      errors.push('种植时间必须是有效的时间戳');
    }

    if (this.harvestTime && (!Number.isInteger(this.harvestTime) || this.harvestTime < 0)) {
      errors.push('收获时间必须是有效的时间戳');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 检查是否为空土地
   * @returns {boolean}
   */
  isEmpty() {
    return this.status === 'empty' && !this.crop;
  }

  /**
   * 检查是否在种植状态
   * @returns {boolean}
   */
  isGrowing() {
    return this.status === 'growing' && this.crop && this.harvestTime;
  }

  /**
   * 检查作物是否成熟
   * @param {number} currentTime 当前时间戳
   * @returns {boolean}
   */
  isReady(currentTime = Date.now()) {
    return this.isGrowing() && this.harvestTime <= currentTime;
  }

  /**
   * 检查作物是否枯萎
   * @param {number} currentTime 当前时间戳
   * @param {number} witherTimeout 枯萎超时时间（毫秒）
   * @returns {boolean}
   */
  isWithered(currentTime = Date.now(), witherTimeout = 24 * 60 * 60 * 1000) {
    return this.isReady(currentTime) && 
           (currentTime - this.harvestTime) > witherTimeout;
  }

  /**
   * 检查是否可以偷菜
   * @param {number} currentTime 当前时间戳
   * @returns {boolean}
   */
  isStealable(currentTime = Date.now()) {
    return this.stealable && this.isReady(currentTime) && !this.isWithered(currentTime);
  }

  /**
   * 种植作物
   * @param {string} cropType 作物类型
   * @param {number} growTime 生长时间（毫秒）
   * @param {number} plantTime 种植时间戳
   * @returns {Land} 返回自身以支持链式调用
   */
  plant(cropType, growTime, plantTime = Date.now()) {
    this.crop = cropType;
    this.status = 'growing';
    this.plantTime = plantTime;
    this.harvestTime = plantTime + growTime;
    this.health = 100;
    this.needsWater = false;
    this.hasPests = false;
    this.stealable = false;
    
    return this;
  }

  /**
   * 收获作物
   * @returns {Object} 收获结果
   */
  harvest() {
    if (!this.isReady()) {
      throw new Error('作物尚未成熟，无法收获');
    }

    const harvestedCrop = this.crop;
    const plantDuration = this.harvestTime - this.plantTime;
    
    // 重置土地状态
    this.crop = null;
    this.status = 'empty';
    this.plantTime = null;
    this.harvestTime = null;
    this.health = 100;
    this.needsWater = false;
    this.hasPests = false;
    this.stealable = false;

    return {
      cropType: harvestedCrop,
      plantDuration,
      harvestTime: Date.now()
    };
  }

  /**
   * 升级土地品质
   * @param {string} newQuality 新品质
   * @param {number} upgradeTime 升级时间戳
   * @returns {Land} 返回自身以支持链式调用
   */
  upgradeQuality(newQuality, upgradeTime = Date.now()) {
    const qualityOrder = ['normal', 'copper', 'silver', 'gold'];
    const currentIndex = qualityOrder.indexOf(this.quality);
    const newIndex = qualityOrder.indexOf(newQuality);

    if (newIndex === -1) {
      throw new Error(`无效的土地品质: ${newQuality}`);
    }

    if (newIndex <= currentIndex) {
      throw new Error(`无法降级土地品质，当前: ${this.quality}, 目标: ${newQuality}`);
    }

    this.quality = newQuality;
    this.lastUpgradeTime = upgradeTime;
    this.upgradeLevel += 1;

    return this;
  }

  /**
   * 获取土地品质信息
   * @returns {Object} 品质信息
   */
  getQualityInfo() {
    if (!this.config) {
      return null;
    }

    const qualityConfig = this.config.land?.quality?.[this.quality];
    
    if (!qualityConfig) {
      return null;
    }

    return {
      quality: this.quality,
      icon: qualityConfig.icon || '🟫',
      name: qualityConfig.name || this.quality,
      productionBonus: qualityConfig.productionBonus || 0,
      timeReduction: qualityConfig.timeReduction || 0,
      description: qualityConfig.description || '',
      upgradeLevel: this.upgradeLevel
    };
  }

  /**
   * 获取下一级品质的升级信息
   * @returns {Object|null} 升级信息
   */
  getUpgradeInfo() {
    if (!this.config) {
      return null;
    }

    const qualityOrder = ['normal', 'copper', 'silver', 'gold'];
    const currentIndex = qualityOrder.indexOf(this.quality);
    
    if (currentIndex === -1 || currentIndex >= qualityOrder.length - 1) {
      return null; // 已是最高品质
    }

    const nextQuality = qualityOrder[currentIndex + 1];
    const upgradeConfig = this.config.land?.quality?.[nextQuality]?.upgrade;

    if (!upgradeConfig) {
      return null;
    }

    return {
      targetQuality: nextQuality,
      levelRequired: upgradeConfig.levelRequired || 0,
      goldCost: upgradeConfig.goldCost || 0,
      materials: upgradeConfig.materials || {},
      canUpgrade: true
    };
  }

  /**
   * 更新作物状态
   * @param {number} currentTime 当前时间戳
   * @returns {boolean} 状态是否发生变化
   */
  updateStatus(currentTime = Date.now()) {
    const previousStatus = this.status;

    if (this.isGrowing()) {
      if (this.isWithered(currentTime)) {
        this.status = 'withered';
      } else if (this.isReady(currentTime)) {
        this.status = 'ready';
        this.stealable = true;
      }
    }

    return this.status !== previousStatus;
  }

  /**
   * 获取土地显示信息
   * @param {Object} cropsConfig 作物配置
   * @param {number} currentTime 当前时间戳
   * @returns {Object} 显示信息
   */
  getDisplayInfo(cropsConfig = {}, currentTime = Date.now()) {
    const qualityInfo = this.getQualityInfo();
    const baseInfo = {
      id: this.id,
      qualityIcon: qualityInfo?.icon || '🟫',
      qualityName: qualityInfo?.name || this.quality,
      status: this.status,
      health: this.health
    };

    if (this.isEmpty()) {
      return {
        ...baseInfo,
        displayText: `[${baseInfo.qualityIcon}][${this.id}]：空地`,
        isEmpty: true
      };
    }

    const cropName = cropsConfig[this.crop]?.name || this.crop;
    let statusText = '';
    let timeInfo = '';

    if (this.isWithered(currentTime)) {
      statusText = '已枯萎';
    } else if (this.isReady(currentTime)) {
      statusText = '可收获';
    } else if (this.isGrowing()) {
      const remainingTime = this.harvestTime - currentTime;
      timeInfo = this._formatRemainingTime(remainingTime);
      statusText = `生长中 ${timeInfo}`;
    }

    const healthText = this.health < 100 ? ` [健康度:${this.health}%]` : '';
    const stealableText = this.stealable ? ' [可偷]' : '';

    return {
      ...baseInfo,
      cropName,
      statusText,
      timeInfo,
      remainingTime: this.harvestTime ? this.harvestTime - currentTime : 0,
      displayText: `[${baseInfo.qualityIcon}][${this.id}]：${cropName} ${statusText}${healthText}${stealableText}`,
      isEmpty: false,
      isReady: this.isReady(currentTime),
      isWithered: this.isWithered(currentTime),
      isStealable: this.isStealable(currentTime)
    };
  }

  /**
   * 格式化剩余时间
   * @param {number} remainingMs 剩余毫秒数
   * @returns {string} 格式化的时间字符串
   */
  _formatRemainingTime(remainingMs) {
    if (remainingMs <= 0) return '0秒';

    const seconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}小时${minutes % 60}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * 转换为JSON对象
   * @returns {Object} JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      quality: this.quality,
      status: this.status,
      crop: this.crop,
      plantTime: this.plantTime,
      harvestTime: this.harvestTime,
      health: this.health,
      needsWater: this.needsWater,
      hasPests: this.hasPests,
      stealable: this.stealable,
      lastUpgradeTime: this.lastUpgradeTime,
      upgradeLevel: this.upgradeLevel
    };
  }

  /**
   * 复制土地实例
   * @returns {Land} 新的土地实例
   */
  clone() {
    return new Land(this.toJSON(), this.config);
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:35:24 +08:00; Reason: Shrimp Task ID: #9e864eaf, converting CommonJS module.exports to ES Modules export default; Principle_Applied: ModuleSystem-Standardization;}}
export default Land;

// {{END MODIFICATIONS}}