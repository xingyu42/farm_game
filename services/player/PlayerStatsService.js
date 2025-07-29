/**
 * 统计服务
 * 处理玩家统计数据相关功能
 */

import PlayerDataService from './PlayerDataService.js';

class PlayerStatsService {
    constructor(redisClient, config) {
        this.redis = redisClient;
        this.config = config;
        // 初始化数据服务
        this.dataService = new PlayerDataService(redisClient, config, logger);
    }

    /**
     * 更新玩家统计数据
     * @param {string} userId 用户ID
     * @param {Object} stats 统计数据更新
     */
    async updateStatistics(userId, stats) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (multi, playerKey) => {
                const playerData = await this.dataService.getPlayer(userId);

                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                // 更新各种统计数据
                if (stats.harvested) playerData.statistics.totalHarvested += stats.harvested;
                if (stats.stolenFrom) playerData.statistics.totalStolenFrom += stats.stolenFrom;
                if (stats.stolenBy) playerData.statistics.totalStolenBy += stats.stolenBy;
                if (stats.moneyEarned) playerData.statistics.totalMoneyEarned += stats.moneyEarned;
                if (stats.moneySpent) playerData.statistics.totalMoneySpent += stats.moneySpent;

                playerData.lastUpdated = Date.now();
                playerData.lastActiveTime = Date.now();

                // 使用序列化器统一处理
                const serializer = this.dataService.getSerializer();
                multi.hSet(playerKey, serializer.serializeForHash(playerData));

                return playerData;
            });
        } catch (error) {
            logger.error(`[StatisticsService] 更新统计数据失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取玩家统计数据
     * @param {string} userId 用户ID
     * @returns {Object} 统计数据
     */
    async getStatistics(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            return {
                ...playerData.statistics,
                // 计算衍生统计
                netWorth: playerData.statistics.totalMoneyEarned - playerData.statistics.totalMoneySpent,
                stealSuccessRate: this._calculateStealSuccessRate(playerData.statistics),
                harvestEfficiency: this._calculateHarvestEfficiency(playerData.statistics),
                accountAge: this._calculateAccountAge(playerData.createdAt),
                lastActiveTime: playerData.lastActiveTime
            };
        } catch (error) {
            logger.error(`[StatisticsService] 获取统计数据失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 增加收获统计
     * @param {string} userId 用户ID
     * @param {number} amount 收获数量
     * @param {number} value 收获价值（金币）
     */
    async addHarvestStats(userId, amount, value = 0) {
        try {
            await this.updateStatistics(userId, {
                harvested: amount,
                moneyEarned: value
            });

            logger.info(`[StatisticsService] 玩家 ${userId} 收获统计: +${amount} 作物, +${value} 金币`);
        } catch (error) {
            logger.error(`[StatisticsService] 更新收获统计失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 增加偷菜统计（被偷）
     * @param {string} userId 用户ID
     * @param {number} amount 被偷数量
     * @param {number} value 被偷价值
     */
    async addStolenFromStats(userId, amount, _value = 0) {
        try {
            await this.updateStatistics(userId, {
                stolenFrom: amount
            });

            logger.info(`[StatisticsService] 玩家 ${userId} 被偷统计: +${amount} 作物`);
        } catch (error) {
            logger.error(`[StatisticsService] 更新被偷统计失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 增加偷菜统计（偷取）
     * @param {string} userId 用户ID
     * @param {number} amount 偷取数量
     * @param {number} value 偷取价值
     */
    async addStolenByStats(userId, amount, value = 0) {
        try {
            await this.updateStatistics(userId, {
                stolenBy: amount,
                moneyEarned: value
            });

            logger.info(`[StatisticsService] 玩家 ${userId} 偷取统计: +${amount} 作物, +${value} 金币`);
        } catch (error) {
            logger.error(`[StatisticsService] 更新偷取统计失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 增加消费统计
     * @param {string} userId 用户ID
     * @param {number} amount 消费金额
     * @param {string} category 消费类别
     */
    async addSpendingStats(userId, amount, category = 'general') {
        try {
            await this.updateStatistics(userId, {
                moneySpent: amount
            });

            logger.info(`[StatisticsService] 玩家 ${userId} 消费统计: +${amount} 金币 (${category})`);
        } catch (error) {
            logger.error(`[StatisticsService] 更新消费统计失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取玩家排行榜数据
     * @param {string} userId 用户ID
     * @returns {Object} 排行榜相关数据
     */
    async getRankingData(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            return {
                level: playerData.level,
                experience: playerData.experience,
                coins: playerData.coins,
                totalHarvested: playerData.statistics.totalHarvested,
                totalMoneyEarned: playerData.statistics.totalMoneyEarned,
                netWorth: playerData.statistics.totalMoneyEarned - playerData.statistics.totalMoneySpent,
                consecutiveSignDays: playerData.signIn.consecutiveDays,
                totalSignDays: playerData.signIn.totalSignDays,
                landCount: playerData.landCount
            };
        } catch (error) {
            logger.error(`[StatisticsService] 获取排行榜数据失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取详细统计报告
     * @param {string} userId 用户ID
     * @returns {Object} 详细统计报告
     */
    async getDetailedReport(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const accountAge = this._calculateAccountAge(playerData.createdAt);
            const stats = playerData.statistics;

            return {
                // 基础信息
                playerInfo: {
                    name: playerData.name,
                    level: playerData.level,
                    experience: playerData.experience,
                    coins: playerData.coins,
                    accountAge
                },

                // 经济统计
                economy: {
                    totalEarned: stats.totalMoneyEarned,
                    totalSpent: stats.totalMoneySpent,
                    netWorth: stats.totalMoneyEarned - stats.totalMoneySpent,
                    dailyAverageEarning: Math.round(stats.totalMoneyEarned / Math.max(1, accountAge)),
                    dailyAverageSpending: Math.round(stats.totalMoneySpent / Math.max(1, accountAge))
                },

                // 农场统计
                farming: {
                    totalHarvested: stats.totalHarvested,
                    dailyAverageHarvest: Math.round(stats.totalHarvested / Math.max(1, accountAge)),
                    harvestEfficiency: this._calculateHarvestEfficiency(stats),
                    landCount: playerData.landCount,
                    maxLandCount: playerData.maxLandCount
                },

                // 偷菜统计
                stealing: {
                    totalStolenBy: stats.totalStolenBy,
                    totalStolenFrom: stats.totalStolenFrom,
                    stealSuccessRate: this._calculateStealSuccessRate(stats),
                    netStealBalance: stats.totalStolenBy - stats.totalStolenFrom
                },

                // 签到统计
                signIn: {
                    totalSignDays: playerData.signIn.totalSignDays,
                    consecutiveDays: playerData.signIn.consecutiveDays,
                    signInRate: Math.round((playerData.signIn.totalSignDays / Math.max(1, accountAge)) * 100),
                    lastSignDate: playerData.signIn.lastSignDate
                },

                // 活跃度统计
                activity: {
                    lastActiveTime: playerData.lastActiveTime,
                    lastUpdated: playerData.lastUpdated,
                    createdAt: playerData.createdAt,
                    accountAge
                }
            };
        } catch (error) {
            logger.error(`[StatisticsService] 获取详细报告失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 重置统计数据（管理员功能）
     * @param {string} userId 用户ID
     * @param {Array} statsToReset 要重置的统计项
     */
    async resetStatistics(userId, statsToReset = []) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const resetStats = {};

            if (statsToReset.length === 0) {
                // 重置所有统计
                resetStats.statistics = {
                    totalHarvested: 0,
                    totalStolenFrom: 0,
                    totalStolenBy: 0,
                    totalMoneyEarned: 0,
                    totalMoneySpent: 0
                };
            } else {
                // 重置指定统计
                resetStats.statistics = { ...playerData.statistics };
                for (const stat of statsToReset) {
                    if (Object.prototype.hasOwnProperty.call(resetStats.statistics, stat)) {
                        resetStats.statistics[stat] = 0;
                    }
                }
            }

            await this.dataService.updateComplexField(userId, 'statistics', resetStats.statistics);

            logger.info(`[StatisticsService] 重置玩家 ${userId} 统计数据: ${statsToReset.join(', ') || '全部'}`);

            return {
                success: true,
                message: '统计数据已重置',
                resetStats: statsToReset.length === 0 ? '全部' : statsToReset
            };
        } catch (error) {
            logger.error(`[StatisticsService] 重置统计数据失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 计算收获效率
     * @param {Object} stats 统计数据
     * @returns {number} 效率值
     */
    _calculateHarvestEfficiency(stats) {
        // 简化的效率计算：收获数量 / (收获数量 + 被偷数量)
        const totalProduction = stats.totalHarvested + stats.totalStolenFrom;
        if (totalProduction === 0) return 100;

        return Math.round((stats.totalHarvested / totalProduction) * 100);
    }

    /**
     * 计算账户年龄（天数）
     * @param {number} createdAt 创建时间戳
     * @returns {number} 天数
     */
    _calculateAccountAge(createdAt) {
        return Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24)) + 1;
    }

    /**
     * 计算偷菜成功率
     * @param {Object} stats 统计数据
     * @returns {number} 成功率
     */
    _calculateStealSuccessRate(stats) {
        const totalStolen = stats.totalStolenBy + stats.totalStolenFrom;
        if (totalStolen === 0) return 0;
        return Math.round((stats.totalStolenBy / totalStolen) * 100);
    }
}

export default PlayerStatsService;