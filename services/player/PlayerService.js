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
import LandManagerService from './LandManagerService.js';

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
        this.landManagerService = new LandManagerService(redisClient, config, logger);
    }

    /**
     * 注入外部 ProtectionService 单例（解决循环依赖）
     * @param {Object} protectionService ProtectionService 实例
     */
    setProtectionService(protectionService) {
        this.protectionService = protectionService;
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
                logger.info(`[PlayerService] 创建新玩家: ${userId}`);

                // 发放初始礼包
                await this._giveInitialGift(userId, playerData);
            }

            return playerData;
        } catch (error) {
            logger.error(`[PlayerService] 获取玩家数据失败 [${userId}]: ${error.message}`);
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
            logger.error(`[PlayerService] 确保玩家存在失败 [${userId}]: ${error.message}`);
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

            logger.info(`[PlayerService] 显式创建新玩家: ${userId} (${userName})`);

            // 发放初始礼包
            await this._giveInitialGift(userId, playerData);

            // 重新获取玩家数据以确保返回Player实例
            return await this.getPlayer(userId);
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
     * @deprecated 此方法存在事务嵌套问题，不推荐在新代码中使用
     * @param {string} userId 用户ID
     * @param {number} amount 扣除金币数量
     * @returns {Object} 扣除结果
     */
    async deductCoins(userId, amount) {
        return await this.economyService.deductCoins(userId, amount);
    }

    /**
     * 获取经验值来源配置
     * @returns {Object} 经验值来源配置
     */
    getExperienceSources() {
        return this.economyService.getExperienceSources();
    }

    /**
     * 计算到达目标等级需要的经验值
     * @param {string} userId 用户ID
     * @param {number} targetLevel 目标等级
     * @returns {Object} 计算结果
     */
    async getExpToLevel(userId, targetLevel) {
        return await this.economyService.getExpToLevel(userId, targetLevel);
    }

    /**
     * 获取玩家财务统计
     * @param {string} userId 用户ID
     * @returns {Object} 财务统计
     */
    async getFinancialStats(userId) {
        return await this.economyService.getFinancialStats(userId);
    }

    /**
     * 在事务上下文中更新金币和统计数据（内部方法）
     * @param {Object} playerData 玩家数据对象
     * @param {number} amount 金币变化量（可为负数）
     * @returns {number} 实际变化量
     * @private
     */
    _updateCoinsInTransaction(playerData, amount) {
        return this.economyService._updateCoinsInTransaction(playerData, amount);
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
     * 获取详细统计报告
     * @param {string} userId 用户ID
     * @returns {Object} 详细统计报告
     */
    async getDetailedReport(userId) {
        return await this.statisticsService.getDetailedReport(userId);
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

    /**
     * 获取土地扩张信息
     * @param {string} userId 用户ID
     * @returns {Object} 扩张信息
     */
    async getLandExpansionInfo(userId) {
        return await this.landManagerService.getLandExpansionInfo(userId);
    }

    /**
     * 获取土地系统配置
     * @returns {Object} 土地系统配置
     */
    getLandSystemConfig() {
        return this.landManagerService.getLandSystemConfig();
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

    /**
     * 获取土地管理服务实例
     * @returns {LandManagerService} 土地管理服务实例
     */
    getLandManagerService() {
        return this.landManagerService;
    }
}

export default PlayerService; 