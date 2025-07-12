/**
 * 等级计算工具
 * 负责经验值与等级之间的转换、升级奖励计算等
 */

class LevelCalculator {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * 计算经验值对应的等级
   * @param {number} experience 经验值
   * @returns {Object} 等级信息
   */
  calculateLevel(experience) {
    const levels = this.config?.levels?.levels?.requirements;
    
    if (!levels) {
      console.warn('[LevelCalculator] 等级配置不存在，返回默认等级1');
      return { level: 1 };
    }
    
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
  getLevelUpRewards(oldLevel, newLevel) {
    const levelUpRewards = this.config?.levels?.levels?.rewards?.levelUp;
    const coinsPerLevel = levelUpRewards?.coins || 0;

    const levelsGained = newLevel - oldLevel;

    return {
      levelsGained,
      totalCoins: coinsPerLevel * levelsGained
      // 注意：landSlots奖励已移除，土地槽位现在只通过土地扩展系统管理
    };
  }

  /**
   * 获取升级解锁的物品
   * @param {number} oldLevel 旧等级
   * @param {number} newLevel 新等级
   * @returns {Array} 解锁的物品列表
   */
  getUnlockedItems(oldLevel, newLevel) {
    const levels = this.config?.levels?.levels?.requirements;
    const unlockedItems = [];
    
    if (!levels) {
      return unlockedItems;
    }
    
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
   * @param {number} currentLevel 当前等级
   * @param {number} currentExp 当前经验值
   * @returns {Object} 等级信息
   */
  getPlayerLevelInfo(currentLevel, currentExp) {
    const levels = this.config?.levels?.levels?.requirements;
    
    if (!levels) {
      return {
        currentLevel: 1,
        currentExp: 0,
        currentLevelDescription: '新手农夫',
        nextLevelExp: null,
        expToNextLevel: 0,
        maxLevel: 1
      };
    }
    
    const maxLevel = Math.max(...Object.keys(levels).map(Number));
    const currentLevelConfig = levels[currentLevel];
    const nextLevelConfig = levels[currentLevel + 1];
    
    return {
      currentLevel,
      currentExp,
      currentLevelDescription: currentLevelConfig?.description || '未知等级',
      nextLevelExp: nextLevelConfig ? nextLevelConfig.experience : null,
      expToNextLevel: nextLevelConfig ? Math.max(0, nextLevelConfig.experience - currentExp) : 0,
      maxLevel
    };
  }

  /**
   * 获取等级信息
   * @param {number} level 等级
   * @returns {Object|null} 等级信息
   */
  getLevelInfo(level) {
    const levels = this.config?.levels?.levels?.requirements;
    
    if (!levels) {
      return null;
    }
    
    // 获取下一级的配置
    const levelConfig = levels[level + 1];
    if (!levelConfig) {
      return null; // 已达到最高等级
    }
    
    return {
      level: level + 1,
      experienceRequired: levelConfig.experience,
      description: levelConfig.description,
      unlocks: levelConfig.unlocks || []
    };
  }

  /**
   * 检查是否可以升级
   * @param {number} currentLevel 当前等级
   * @param {number} currentExp 当前经验值
   * @returns {Object} 升级检查结果
   */
  canLevelUp(currentLevel, currentExp) {
    const nextLevelInfo = this.getLevelInfo(currentLevel);
    
    if (!nextLevelInfo) {
      return {
        canLevelUp: false,
        reason: '已达到最高等级'
      };
    }
    
    const canLevelUp = currentExp >= nextLevelInfo.experienceRequired;
    
    return {
      canLevelUp,
      reason: canLevelUp ? '可以升级' : '经验值不足',
      nextLevel: nextLevelInfo.level,
      expRequired: nextLevelInfo.experienceRequired,
      expNeeded: Math.max(0, nextLevelInfo.experienceRequired - currentExp)
    };
  }

  /**
   * 计算从当前经验值到目标等级需要的经验值
   * @param {number} currentExp 当前经验值
   * @param {number} targetLevel 目标等级
   * @returns {Object} 计算结果
   */
  getExpToLevel(currentExp, targetLevel) {
    const levels = this.config?.levels?.levels?.requirements;
    
    if (!levels || !levels[targetLevel]) {
      return {
        valid: false,
        message: '目标等级不存在'
      };
    }
    
    const targetLevelConfig = levels[targetLevel];
    const expNeeded = Math.max(0, targetLevelConfig.experience - currentExp);
    
    return {
      valid: true,
      currentExp,
      targetLevel,
      targetExp: targetLevelConfig.experience,
      expNeeded,
      canReach: expNeeded === 0
    };
  }

  /**
   * 获取经验值来源配置
   * @returns {Object} 经验值来源配置
   */
  getExperienceSources() {
    return this.config?.levels?.levels?.experienceSources || {
      planting: 2,
      harvesting: 5,
      selling: 1
    };
  }
}

export default LevelCalculator;
