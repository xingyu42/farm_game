/**
 * 玩家管理主服务
 * 作为统一入口，整合各个子服务，保持与原PlayerService的接口兼容性
 */

import PlayerDataService from './PlayerDataService.js';
import EconomyService from './modules/EconomyService.js';
import SignInService from './modules/SignInService.js';
import ProtectionService from './modules/ProtectionService.js';
import StatisticsService from './modules/StatisticsService.js';
import LandManagerService from './modules/LandManagerService.js';

class PlayerManagerService {
  constructor(redisClient, config, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.logger = logger || console;

    // 初始化子服务
    this.dataService = new PlayerDataService(redisClient, config, logger);
    this.economyService = new EconomyService(this.dataService, config, logger);
    this.signInService = new SignInService(this.dataService, this.economyService, config, logger);
    this.protectionService = new ProtectionService(this.dataService, config, logger);
    this.statisticsService = new StatisticsService(this.dataService, config, logger);
    this.landManagerService = new LandManagerService(this.dataService, this.economyService, config, logger);

    // 保持原有字段定义（向后兼容）
    this.simpleFields = this.dataService.serializer.simpleFields;
    this.complexFields = this.dataService.serializer.complexFields;
  }

  // ==================== 核心玩家管理方法 ====================

  /**
   * 获取玩家数据，如果不存在则创建新玩家
   * @param {string} userId 用户ID
   * @returns {Object} 玩家数据
   */
  async getPlayer(userId) {
    try {
      // 尝试从Redis Hash获取玩家数据
      let playerData = await this.dataService.getPlayerFromHash(userId);

      // 如果玩家不存在，创建新玩家
      if (!playerData) {
        playerData = this.dataService.createNewPlayerData();
        await this.dataService.savePlayerToHash(userId, playerData);
        this.logger.info(`[PlayerManagerService] 创建新玩家: ${userId}`);

        // 发放初始礼包
        await this._giveInitialGift(userId, playerData);
      }

      return playerData;
    } catch (error) {
      this.logger.error(`[PlayerManagerService] 获取玩家数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取玩家数据（统一返回Player实例）
   * @param {string} userId 用户ID
   * @returns {Player} Player实例
   */
  async getPlayerData(userId) {
    return await this.getPlayer(userId);
  }

  /**
   * 确保玩家存在（如果不存在则创建）
   * @param {string} userId 用户ID
   * @param {string} userName 用户名
   * @returns {Player} Player实例
   */
  async ensurePlayer(userId, userName = null) {
    try {
      const playerData = await this.getPlayerData(userId);

      // 如果提供了用户名且玩家名称为空，更新名称
      if (userName && !playerData.name) {
        playerData.name = userName;
        await this.dataService.updateSimpleField(userId, 'name', userName);
      }

      return playerData;
    } catch (error) {
      this.logger.error(`[PlayerManagerService] 确保玩家存在失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 创建玩家（显式创建）
   * @param {string} userId 用户ID
   * @param {string} userName 用户名
   * @returns {Player} Player实例
   */
  async createPlayer(userId, userName) {
    try {
      // 检查玩家是否已存在
      const existingPlayer = await this.dataService.getPlayerFromHash(userId);
      if (existingPlayer) {
        return existingPlayer;
      }

      // 创建新玩家
      const playerData = this.dataService.createNewPlayerData();
      playerData.name = userName;

      await this.dataService.savePlayerToHash(userId, playerData);

      this.logger.info(`[PlayerManagerService] 显式创建新玩家: ${userId} (${userName})`);

      // 发放初始礼包
      await this._giveInitialGift(userId, playerData);

      // 重新获取玩家数据以确保返回Player实例
      return await this.getPlayer(userId);
    } catch (error) {
      this.logger.error(`[PlayerManagerService] 创建玩家失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  // ==================== 经济系统方法（委托给EconomyService）====================

  /**
   * 添加金币
   * @param {string} userId 用户ID
   * @param {number} amount 金币数量（可为负数）
   * @returns {Object} 更新后的玩家数据
   */
  async addCoins(userId, amount) {
    return await this.economyService.addCoins(userId, amount);
  }

  /**
   * 添加经验值并处理升级
   * @param {string} userId 用户ID
   * @param {number} amount 经验值
   * @returns {Object} 包含玩家数据和升级信息的对象
   */
  async addExp(userId, amount) {
    return await this.economyService.addExp(userId, amount);
  }

  /**
   * 获取玩家等级详细信息
   * @param {string} userId 用户ID
   * @returns {Object} 等级信息
   */
  async getPlayerLevelInfo(userId) {
    return await this.economyService.getPlayerLevelInfo(userId);
  }

  // ==================== 签到系统方法（委托给SignInService）====================

  /**
   * 签到功能
   * @param {string} userId 用户ID
   * @returns {Object} 签到结果
   */
  async signIn(userId) {
    return await this.signInService.signIn(userId);
  }

  /**
   * 每日签到（别名方法）
   * @param {string} userId 用户ID
   * @returns {Object} 签到结果
   */
  async dailySignIn(userId) {
    return await this.signInService.dailySignIn(userId);
  }

  // ==================== 防御系统方法（委托给ProtectionService）====================

  /**
   * 使用狗粮设置防御
   * @param {string} userId 用户ID
   * @param {string} dogFoodType 狗粮类型
   * @returns {Object} 使用结果
   */
  async useDogFood(userId, dogFoodType) {
    return await this.protectionService.useDogFood(userId, dogFoodType);
  }

  /**
   * 检查玩家防御状态
   * @param {string} userId 用户ID
   * @returns {Object} 防御状态
   */
  async getProtectionStatus(userId) {
    return await this.protectionService.getProtectionStatus(userId);
  }

  /**
   * 设置偷菜冷却
   * @param {string} userId 用户ID
   * @param {number} cooldownMinutes 冷却时间（分钟）
   */
  async setStealCooldown(userId, cooldownMinutes = 5) {
    return await this.protectionService.setStealCooldown(userId, cooldownMinutes);
  }

  /**
   * 设置农场保护
   * @param {string} userId 用户ID
   * @param {number} protectionMinutes 保护时间（分钟）
   */
  async setFarmProtection(userId, protectionMinutes = 30) {
    return await this.protectionService.setFarmProtection(userId, protectionMinutes);
  }

  // ==================== 统计系统方法（委托给StatisticsService）====================

  /**
   * 更新玩家统计数据
   * @param {string} userId 用户ID
   * @param {Object} stats 统计数据更新
   */
  async updateStatistics(userId, stats) {
    return await this.statisticsService.updateStatistics(userId, stats);
  }

  // ==================== 土地管理方法（委托给LandManagerService）====================

  /**
   * 扩张土地
   * @param {string} userId 用户ID
   * @returns {Object} 扩张结果
   */
  async expandLand(userId) {
    return await this.landManagerService.expandLand(userId);
  }

  /**
   * 智能土地访问方法 - 通过索引获取土地
   * @param {string} userId 用户ID
   * @param {number} index 土地索引（0-based）
   * @returns {Object|null} 土地数据或null
   */
  async getLandByIndex(userId, index) {
    return await this.landManagerService.getLandByIndex(userId, index);
  }

  /**
   * 智能土地访问方法 - 通过土地ID获取土地
   * @param {string} userId 用户ID
   * @param {number} landId 土地ID（1-based）
   * @returns {Object|null} 土地数据或null
   */
  async getLandById(userId, landId) {
    return await this.landManagerService.getLandById(userId, landId);
  }

  /**
   * 智能土地更新方法 - 更新指定土地的属性
   * @param {string} userId 用户ID
   * @param {number} landId 土地ID（1-based）
   * @param {Object} updates 要更新的属性
   * @returns {Object} 更新结果
   */
  async updateLand(userId, landId, updates) {
    return await this.landManagerService.updateLand(userId, landId, updates);
  }

  /**
   * 获取所有土地信息
   * @param {string} userId 用户ID
   * @returns {Array} 土地数组
   */
  async getAllLands(userId) {
    return await this.landManagerService.getAllLands(userId);
  }

  /**
   * 验证土地ID是否有效
   * @param {string} userId 用户ID
   * @param {number} landId 土地ID（1-based）
   * @returns {Object} 验证结果
   */
  async validateLandId(userId, landId) {
    return await this.landManagerService.validateLandId(userId, landId);
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 发放初始礼包
   * @param {string} userId 用户ID
   * @param {Object} playerData 玩家数据
   */
  async _giveInitialGift(userId, _playerData) {
    try {
      const initialGift = this.config.items?.initial_gift;

      if (initialGift && initialGift.length > 0) {
        this.logger.info(`[PlayerManagerService] 为新玩家 ${userId} 准备初始礼包: ${JSON.stringify(initialGift)}`);
        // 注意：这里不能直接调用InventoryService，因为会造成循环依赖
        // 初始礼包将由外部服务在玩家创建后调用
      }
    } catch (error) {
      this.logger.error(`[PlayerManagerService] 发放初始礼包失败 [${userId}]: ${error.message}`);
    }
  }

  // ==================== 向后兼容的方法 ====================

  /**
   * 获取等级信息（向后兼容）
   * @param {number} level 等级
   * @returns {Object} 等级信息
   */
  async getLevelInfo(level) {
    return this.economyService.levelCalculator.getLevelInfo(level);
  }

  /**
   * 高效更新单个简单字段（向后兼容）
   * @param {string} userId 用户ID
   * @param {string} field 字段名
   * @param {any} value 新值
   */
  async _updateSimpleField(userId, field, value) {
    return await this.dataService.updateSimpleField(userId, field, value);
  }

  /**
   * 高效更新多个简单字段（向后兼容）
   * @param {string} userId 用户ID
   * @param {Object} fieldUpdates 字段更新映射
   */
  async _updateSimpleFields(userId, fieldUpdates) {
    return await this.dataService.updateSimpleFields(userId, fieldUpdates);
  }

  /**
   * 智能序列化玩家数据为Redis Hash格式（向后兼容）
   * @param {Object|Player} playerData 玩家数据对象或Player实例
   * @returns {Object} Redis Hash格式的数据对象
   */
  _serializePlayerForHash(playerData) {
    return this.dataService.serializer.serializeForHash(playerData);
  }

  /**
   * 从Redis Hash读取玩家数据（向后兼容）
   * @param {string} playerKey Redis Key
   * @returns {Player|null} Player实例或null
   */
  async _getPlayerFromHash(playerKey) {
    // 从playerKey提取userId
    const userId = playerKey.split(':').pop();
    return await this.dataService.getPlayerFromHash(userId);
  }

  /**
   * 将玩家数据保存到Redis Hash（向后兼容）
   * @param {string} playerKey Redis Key
   * @param {Object|Player} playerData 玩家数据或Player实例
   */
  async _savePlayerToHash(playerKey, playerData) {
    // 从playerKey提取userId
    const userId = playerKey.split(':').pop();
    return await this.dataService.savePlayerToHash(userId, playerData);
  }

  /**
   * 创建新玩家数据（向后兼容）
   * @returns {Player} Player实例
   */
  _createNewPlayer() {
    return this.dataService.createNewPlayerData();
  }

  /**
   * 获取复杂字段的默认值（向后兼容）
   * @param {string} field 字段名
   * @returns {any} 默认值
   */
  _getDefaultComplexField(field) {
    return this.dataService.serializer._getDefaultComplexField(field);
  }

  /**
   * 计算经验值对应的等级（向后兼容）
   * @param {number} experience 经验值
   * @returns {Object} 等级信息
   */
  _calculateLevel(experience) {
    return this.economyService.levelCalculator.calculateLevel(experience);
  }

  /**
   * 计算升级奖励（向后兼容）
   * @param {number} oldLevel 旧等级
   * @param {number} newLevel 新等级
   * @returns {Object} 奖励信息
   */
  _getLevelUpRewards(oldLevel, newLevel) {
    return this.economyService.levelCalculator.getLevelUpRewards(oldLevel, newLevel);
  }

  /**
   * 获取升级解锁的物品（向后兼容）
   * @param {number} oldLevel 旧等级
   * @param {number} newLevel 新等级
   * @returns {Array} 解锁的物品列表
   */
  _getUnlockedItems(oldLevel, newLevel) {
    return this.economyService.levelCalculator.getUnlockedItems(oldLevel, newLevel);
  }

  /**
   * 处理等级提升奖励（向后兼容）
   * @param {Object} playerData 玩家数据
   * @param {number} oldLevel 旧等级
   * @param {number} newLevel 新等级
   * @returns {Object} 升级信息
   */
  async _handleLevelUp(playerData, oldLevel, newLevel) {
    return await this.economyService._handleLevelUp(playerData, oldLevel, newLevel);
  }

  /**
   * 计算签到奖励（向后兼容）
   * @param {number} consecutiveDays 连续签到天数
   * @returns {Object} 奖励信息
   */
  _calculateSignInRewards(consecutiveDays) {
    return this.signInService._calculateSignInRewards(consecutiveDays);
  }

  // ==================== 子服务访问器 ====================

  /**
   * 获取数据服务实例
   * @returns {PlayerDataService} 数据服务实例
   */
  getDataService() {
    return this.dataService;
  }

  /**
   * 获取经济服务实例
   * @returns {EconomyService} 经济服务实例
   */
  getEconomyService() {
    return this.economyService;
  }

  /**
   * 获取签到服务实例
   * @returns {SignInService} 签到服务实例
   */
  getSignInService() {
    return this.signInService;
  }

  /**
   * 获取防御服务实例
   * @returns {ProtectionService} 防御服务实例
   */
  getProtectionService() {
    return this.protectionService;
  }

  /**
   * 获取统计服务实例
   * @returns {StatisticsService} 统计服务实例
   */
  getStatisticsService() {
    return this.statisticsService;
  }

  /**
   * 获取土地管理服务实例
   * @returns {LandManagerService} 土地管理服务实例
   */
  getLandManagerService() {
    return this.landManagerService;
  }
}

export default PlayerManagerService;
