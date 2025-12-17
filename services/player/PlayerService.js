/**
 * 统一的玩家服务
 * 整合所有玩家相关功能，包括经济、签到、防御、统计和土地管理
 */

import PlayerDataService from './PlayerDataService.js';
import LevelCalculator from './LevelCalculator.js';
import EconomyService from './EconomyService.js';
import SignInService from './SignInService.js';
// ProtectionService 将由 ServiceContainer 注入，避免循环依赖
import PlayerStatsService from './PlayerStatsService.js';

class PlayerService {
    constructor(redisClient, config) {
        this.redis = redisClient;
        this.config = config;
        // 初始化数据服务
        this.dataService = new PlayerDataService(redisClient, config, logger);

        // 保持原有字段定义（向后兼容）
        this.simpleFields = this.dataService.serializer.simpleFields;
        this.complexFields = this.dataService.serializer.complexFields;

        // 初始化工具类
        this.levelCalculator = new LevelCalculator(config);

        // 初始化子服务
        this.economyService = new EconomyService(redisClient, config, logger);
        this.signInService = new SignInService(redisClient, config, logger);
        this.protectionService = null; // 延迟注入
        this.statisticsService = new PlayerStatsService(redisClient, config, logger);
        this._serviceContainer = null; // 延迟注入ServiceContainer
        this._landServiceCache = null; // LandService缓存
    }

    /**
     * 注入外部 ProtectionService 单例（解决循环依赖）
     * @param {Object} protectionService ProtectionService 实例
     */
    setProtectionService(protectionService) {
        this.protectionService = protectionService;
    }

    /**
     * 注入 ServiceContainer（用于获取 LandService 单例）
     * @param {Object} serviceContainer ServiceContainer 实例
     */
    setServiceContainer(serviceContainer) {
        this._serviceContainer = serviceContainer;
    }

    /**
     * 获取 LandService 单例（Lazy 模式）
     * @returns {LandService} LandService 实例
     * @private
     */
    _getLandService() {
        if (!this._landServiceCache && this._serviceContainer) {
            this._landServiceCache = this._serviceContainer.getService('landService');
        }
        return this._landServiceCache;
    }

    // ==================== 核心玩家管理方法 ====================

    /**
     * 获取玩家数据
     * @param {string} userId 用户ID
     * @param {string|null} userName 用户名（可选）
     * @returns {Player} Player实例
     */
    async getPlayer(userId, userName = null) {
        try {
            // 获取玩家数据
            let playerData = await this.dataService.getPlayer(userId);

            // 如果提供了用户名且玩家名称为空，更新名称
            if (playerData && userName && !playerData.name) {
                playerData.name = userName;
                await this.dataService.updateSimpleField(userId, 'name', userName);
            }

            return playerData;
        } catch (error) {
            logger.error(`[PlayerService] 获取玩家数据失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 检查玩家是否存在
     * @param {string} userId 用户ID
     * @returns {boolean} 是否存在
     */
    async isPlayer(userId) {
        const playerData = await this.getPlayer(userId)
        return !!playerData
    }

    /**
     * 创建新玩家
     * @param {string} userId 用户ID
     * @param {string|null} userName 用户名（可选）
     * @returns {Player} Player实例
     */
    async createPlayer(userId, userName = null) {
        try {

            // 创建新玩家数据
            const playerData = this.dataService.createNewPlayerData(userName || '');
            await this.dataService.savePlayer(userId, playerData);
            logger.info(`[PlayerService] 创建新玩家: ${userId}${userName ? ` (${userName})` : ''}`);

            // 发放初始礼包
            await this._giveInitialGift(userId, playerData);

            return playerData;
        } catch (error) {
            logger.error(`[PlayerService] 创建玩家失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    // ==================== 经济系统方法（委托） ====================

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

    /**
     * 获取等级信息
     * @param {number} level 等级
     * @returns {Object|null} 等级信息
     */
    getLevelInfo(level) {
        return this.levelCalculator.getLevelInfo(level);
    }

    /**
     * 检查是否有足够的金币
     * @param {string} userId 用户ID
     * @param {number} amount 需要的金币数量
     * @returns {Object} 检查结果
     */
    async hasEnoughCoins(userId, amount) {
        return await this.economyService.hasEnoughCoins(userId, amount);
    }

    /**
     * 扣除金币（安全扣除，确保不会为负数）
     * @param {string} userId 用户ID
     * @param {number} amount 扣除金币数量
     * @returns {Object} 扣除结果
     */
    async deductCoins(userId, amount) {
        return await this.economyService.deductCoins(userId, amount);
    }

    // ==================== 签到系统方法（委托） ====================

    /**
     * 签到功能
     * @param {string} userId 用户ID
     * @returns {Object} 签到结果
     */
    async signIn(userId) {
        return await this.signInService.signIn(userId);
    }

    /**
     * 每日签到（别名方法，保持兼容性）
     * @param {string} userId 用户ID
     * @returns {Object} 签到结果
     */
    async dailySignIn(userId) {
        return await this.signInService.dailySignIn(userId);
    }

    /**
     * 获取签到状态
     * @param {string} userId 用户ID
     * @returns {Object} 签到状态
     */
    async getSignInStatus(userId) {
        return await this.signInService.getSignInStatus(userId);
    }

    /**
     * 获取签到历史统计
     * @param {string} userId 用户ID
     * @returns {Object} 签到统计
     */
    async getSignInStats(userId) {
        return await this.signInService.getSignInStats(userId);
    }

    /**
     * 获取签到奖励预览
     * @param {number} consecutiveDays 连续签到天数
     * @returns {Object} 奖励预览
     */
    getSignInRewardsPreview(consecutiveDays) {
        return this.signInService.getSignInRewardsPreview(consecutiveDays);
    }

    /**
     * 检查是否可以签到
     * @param {string} userId 用户ID
     * @returns {Object} 检查结果
     */
    async canSignIn(userId) {
        return await this.signInService.canSignIn(userId);
    }

    /**
     * 重置连续签到天数（管理员功能）
     * @param {string} userId 用户ID
     * @returns {Object} 重置结果
     */
    async resetConsecutiveDays(userId) {
        return await this.signInService.resetConsecutiveDays(userId);
    }

    // ==================== 防御系统方法（委托） ====================

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

    /**
     * 检查是否可以偷菜
     * @param {string} userId 用户ID
     * @returns {Object} 检查结果
     */
    async canSteal(userId) {
        return await this.protectionService.canSteal(userId);
    }

    /**
     * 检查是否受到保护
     * @param {string} userId 用户ID
     * @returns {Object} 保护状态
     */
    async isProtected(userId) {
        return await this.protectionService.isProtected(userId);
    }

    /**
     * 清除过期的防御效果
     * @param {string} userId 用户ID
     * @returns {Object} 清理结果
     */
    async clearExpiredProtections(userId) {
        return await this.protectionService.clearExpiredProtections(userId);
    }

    /**
     * 获取可用的狗粮类型
     * @returns {Array} 狗粮类型列表
     */
    getAvailableDogFoodTypes() {
        return this.protectionService.getAvailableDogFoodTypes();
    }

    /**
     * 计算防御成功率
     * @param {number} defenseBonus 防御加成
     * @param {number} attackPower 攻击力（可选）
     * @returns {number} 防御成功率（0-100）
     */
    calculateDefenseSuccessRate(defenseBonus, attackPower = 100) {
        return this.protectionService.calculateDefenseSuccessRate(defenseBonus, attackPower);
    }

    // ==================== 统计系统方法（委托） ====================

    /**
     * 更新玩家统计数据
     * @param {string} userId 用户ID
     * @param {Object} stats 统计数据更新
     */
    async updateStatistics(userId, stats) {
        return await this.statisticsService.updateStatistics(userId, stats);
    }

    /**
     * 获取玩家统计数据
     * @param {string} userId 用户ID
     * @returns {Object} 统计数据
     */
    async getStatistics(userId) {
        return await this.statisticsService.getStatistics(userId);
    }

    /**
     * 增加收获统计
     * @param {string} userId 用户ID
     * @param {number} amount 收获数量
     * @param {number} value 收获价值（金币）
     */
    async addHarvestStats(userId, amount, value = 0) {
        return await this.statisticsService.addHarvestStats(userId, amount, value);
    }

    /**
     * 增加偷菜统计（被偷）
     * @param {string} userId 用户ID
     * @param {number} amount 被偷数量
     * @param {number} value 被偷价值
     */
    async addStolenFromStats(userId, amount, value = 0) {
        return await this.statisticsService.addStolenFromStats(userId, amount, value);
    }

    /**
     * 增加偷菜统计（偷取）
     * @param {string} userId 用户ID
     * @param {number} amount 偷取数量
     * @param {number} value 偷取价值
     */
    async addStolenByStats(userId, amount, value = 0) {
        return await this.statisticsService.addStolenByStats(userId, amount, value);
    }

    /**
     * 增加消费统计
     * @param {string} userId 用户ID
     * @param {number} amount 消费金额
     * @param {string} category 消费类别
     */
    async addSpendingStats(userId, amount, category = 'general') {
        return await this.statisticsService.addSpendingStats(userId, amount, category);
    }

    /**
     * 获取玩家排行榜数据
     * @param {string} userId 用户ID
     * @returns {Object} 排行榜相关数据
     */
    async getRankingData(userId) {
        return await this.statisticsService.getRankingData(userId);
    }

    /**
     * 重置统计数据（管理员功能）
     * @param {string} userId 用户ID
     * @param {Array} statsToReset 要重置的统计项
     */
    async resetStatistics(userId, statsToReset = []) {
        return await this.statisticsService.resetStatistics(userId, statsToReset);
    }

    // ==================== 土地管理方法（委托） ====================

    /**
     * 扩张土地
     * @param {string} userId 用户ID
     * @returns {Object} 扩张结果
     */
    async expandLand(userId) {
        return await this._getLandService().expandLand(userId);
    }

    /**
     * 智能土地访问方法 - 通过索引获取土地
     * @param {string} userId 用户ID
     * @param {number} index 土地索引（0-based）
     * @returns {Object|null} 土地数据或null
     */
    async getLandByIndex(userId, index) {
        return await this._getLandService().getLandByIndex(userId, index);
    }

    /**
     * 智能土地访问方法 - 通过土地ID获取土地
     * @param {string} userId 用户ID
     * @param {number} landId 土地ID（1-based）
     * @returns {Object|null} 土地数据或null
     */
    async getLandById(userId, landId) {
        const result = await this._getLandService().getLandById(userId, landId);
        return result;
    }

    /**
     * 智能土地更新方法 - 更新指定土地的属性
     * @param {string} userId 用户ID
     * @param {number} landId 土地ID（1-based）
     * @param {Object} updates 要更新的属性
     * @returns {Object} 更新结果
     */
    async updateLand(userId, landId, updates) {
        return await this._getLandService().updateLand(userId, landId, updates);
    }

    /**
     * 获取所有土地信息
     * @param {string} userId 用户ID
     * @returns {Array} 土地数组
     */
    async getAllLands(userId) {
        const result = await this._getLandService().getAllLands(userId);
        return result?.lands ?? [];
    }

    /**
     * 验证土地ID是否有效
     * @param {string} userId 用户ID
     * @param {number} landId 土地ID（1-based）
     * @returns {Object} 验证结果
     */
    async validateLandId(userId, landId) {
        return await this._getLandService().validateLandId(userId, landId);
    }

    /**
     * 获取土地扩张信息
     * @param {string} userId 用户ID
     * @returns {Object} 扩张信息
     */
    async getLandExpansionInfo(userId) {
        return await this._getLandService().getLandExpansionInfo(userId);
    }

    /**
     * 获取土地系统配置
     * @returns {Object} 土地系统配置
     */
    getLandSystemConfig() {
        return this._getLandService().getLandSystemConfig();
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 发放初始礼包
     * @param {string} userId 用户ID
     * @param {Object} playerData 玩家数据
     */
    async _giveInitialGift(userId, _playerData) {
        try {
            const initialGift = this.config.items.initial_gift;

            if (initialGift && initialGift.length > 0) {
                logger.info(`[PlayerService] 为新玩家 ${userId} 准备初始礼包: ${JSON.stringify(initialGift)}`);
                // 注意：这里不能直接调用InventoryService，因为会造成循环依赖
                // 初始礼包将由外部服务在玩家创建后调用
            }
        } catch (error) {
            logger.error(`[PlayerService] 发放初始礼包失败 [${userId}]: ${error.message}`);
        }
    }





    // ==================== 服务访问器（向后兼容）====================

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

}

export default PlayerService; 