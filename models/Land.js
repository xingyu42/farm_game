/**
 * 土地数据模型 - 提供土地数据验证和状态检查
 */

class Land {
  constructor(data = {}) {
    this.id = data.id;
    this.quality = data.quality;
    this.status = data.status;
    this.crop = data.crop;
    this.plantTime = data.plantTime;
    this.harvestTime = data.harvestTime;
    this.health = data.health;
    this.needsWater = data.needsWater;
    this.hasPests = data.hasPests;
    this.stealable = data.stealable;
    this.lastUpgradeTime = data.lastUpgradeTime;
    this.upgradeLevel = data.upgradeLevel ?? 0;
  }

  /**
   * 验证土地数据
   */
  validate() {
    const errors = [];

    if (!this.id || this.id < 1) {
      errors.push('土地ID必须是正整数');
    }

    const validQualities = ['normal', 'red', 'black', 'gold'];
    if (!validQualities.includes(this.quality)) {
      errors.push(`土地品质必须是以下之一: ${validQualities.join(', ')}`);
    }

    const validStatuses = ['empty', 'growing', 'ready'];
    if (!validStatuses.includes(this.status)) {
      errors.push(`土地状态必须是以下之一: ${validStatuses.join(', ')}`);
    }

    if (this.health < 0 || this.health > 100) {
      errors.push('土地健康度必须在0-100之间');
    }

    if (this.plantTime && (!Number.isInteger(this.plantTime) || this.plantTime < 0)) {
      errors.push('种植时间必须是有效的时间戳');
    }

    if (this.harvestTime && (!Number.isInteger(this.harvestTime) || this.harvestTime < 0)) {
      errors.push('收获时间必须是有效的时间戳');
    }

    if (!Number.isInteger(this.upgradeLevel) || this.upgradeLevel < 0) {
      errors.push('升级等级必须是非负整数');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 检查是否为空土地
   */
  isEmpty() {
    return this.status === 'empty' && !this.crop;
  }

  /**
   * 检查是否在种植状态
   */
  isGrowing() {
    return this.status === 'growing' && this.crop && this.harvestTime;
  }

  /**
   * 检查作物是否成熟
   */
  isReady(currentTime = Date.now()) {
    return this.isGrowing() && this.harvestTime <= currentTime;
  }
}

export default Land;
