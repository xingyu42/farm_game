/**
 * 经济服务
 * 处理玩家金币和经验值相关功能
 */

import PlayerDataService from './PlayerDataService.js';
import LevelCalculator from './LevelCalculator.js';

class EconomyService {
    constructor(redisClient, config) {
        this.redis = redisClient;
        this.config = config;
        // 初始化数据服务
        this.dataService = new PlayerDataService(redisClient, config);

        // 初始化等级计算器
        this.levelCalculator = new LevelCalculator(config);
    }

    /**
     * 通用金币变更接口 
     * 正数 amount 代表增加，负数代表减少
     * @param {string} userId
     * @param {number} amount 变化量
     */
    async changeCoins(userId, amount) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (dataService, uid) => {
                const playerData = await dataService.getPlayer(uid);
                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                // 复用内部原子更新工具，自动处理统计 + 边界
                const actualChange = this._updateCoinsInTransaction(playerData, amount);

                // 持久化数据
                await dataService.savePlayer(uid, playerData);

                return playerData;
            });
        } catch (error) {
            logger.error(`[EconomyService] 金币变更失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 添加金币
     * @param {string} userId 用户ID
     * @param {number} amount 金币数量（可为负数）
     * @returns {Object} 更新后的玩家数据
     */
    async addCoins(userId, amount) {
        return this.changeCoins(userId, amount);
    }

    /**
     * 扣除金币
     * @param {string} userId 用户ID
     * @param {number} amount 扣除金币数量
     * @returns {Object} 扣除结果
     */
    async deductCoins(userId, amount) {
        return this.changeCoins(userId, -Math.abs(amount));
    }


    /**
     * 添加经验值并处理升级
     * @param {string} userId 用户ID
     * @param {number} amount 经验值
     * @returns {Object} 包含玩家数据和升级信息的对象
     */
    async addExp(userId, amount) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (dataService, userId) => {
                const playerData = await dataService.getPlayer(userId);

                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                const oldLevel = playerData.level;

                // 添加经验值
                playerData.experience += amount;

                // 计算新等级
                const levelResult = this.levelCalculator.calculateLevel(playerData.experience);
                const newLevel = levelResult.level;

                let levelUpInfo = null;

                // 如果等级提升，处理升级奖励
                if (newLevel > oldLevel) {
                    levelUpInfo = await this._handleLevelUp(playerData, oldLevel, newLevel);
                }

                playerData.level = newLevel;
                playerData.lastUpdated = Date.now();

                // 保存更新后的数据
                await dataService.savePlayer(userId, playerData);

                return {
                    player: playerData,
                    levelUp: levelUpInfo
                };
            });
        } catch (error) {
            logger.error(`[EconomyService] 添加经验失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 处理等级提升奖励
     * @param {Object} playerData 玩家数据
     * @param {number} oldLevel 旧等级
     * @param {number} newLevel 新等级
     * @returns {Object} 升级信息
     */
    async _handleLevelUp(playerData, oldLevel, newLevel) {
        const rewards = this.levelCalculator.getLevelUpRewards(oldLevel, newLevel);
        const unlockedItems = this.levelCalculator.getUnlockedItems(oldLevel, newLevel);

        // 应用奖励
        playerData.coins += rewards.totalCoins;
        // 注意：土地槽位现在只通过土地扩展系统管理，不再通过等级奖励增加

        // 更新统计
        playerData.statistics.totalMoneyEarned += rewards.totalCoins;

        return {
            oldLevel,
            newLevel,
            rewards,
            unlockedItems
        };
    }

    /**
     * 获取玩家等级详细信息
     * @param {string} userId 用户ID
     * @returns {Object} 等级信息
     */
    async getPlayerLevelInfo(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const levelInfo = this.levelCalculator.getPlayerLevelInfo(playerData.level, playerData.experience);

            return {
                ...levelInfo,
                landCount: playerData.landCount,
                maxLandCount: playerData.maxLandCount,
                inventoryCapacity: playerData.inventoryCapacity,
                maxInventoryCapacity: playerData.maxInventoryCapacity
            };
        } catch (error) {
            logger.error(`[EconomyService] 获取等级信息失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 检查是否有足够的金币
     * @param {string} userId 用户ID
     * @param {number} amount 需要的金币数量
     * @returns {Object} 检查结果
     */
    async hasEnoughCoins(userId, amount) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                return {
                    hasEnough: false,
                    currentCoins: 0,
                    needed: amount,
                    shortage: amount
                };
            }

            const hasEnough = playerData.coins >= amount;

            return {
                hasEnough,
                currentCoins: playerData.coins,
                needed: amount,
                shortage: hasEnough ? 0 : amount - playerData.coins
            };
        } catch (error) {
            logger.error(`[EconomyService] 检查金币失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /** @private */
    _updateCoinsInTransaction(playerData, amount) {
        return EconomyService.updateCoinsInTransaction(playerData, amount);
    }

    /**
     * 事务内更新金币（静态方法，供其他服务复用）
     * @param {Object} playerData 玩家数据对象
     * @param {number} amount 金币变化量（可为负数）
     * @returns {number} 实际变化量
     */
    static updateCoinsInTransaction(playerData, amount) {
        if (!playerData) {
            throw new Error('玩家数据不能为空');
        }

        const newCoins = Math.floor(Math.max(0, playerData.coins + amount));
        const actualChange = newCoins - playerData.coins;

        if (actualChange > 0) {
            playerData.statistics.totalMoneyEarned += actualChange;
        } else if (actualChange < 0) {
            playerData.statistics.totalMoneySpent += Math.abs(actualChange);
        }

        playerData.coins = newCoins;
        playerData.lastUpdated = Date.now();

        return actualChange;
    }
}

export default EconomyService; 