/**
 * 签到服务
 * 处理玩家签到相关功能
 */

import PlayerDataService from './PlayerDataService.js';

class SignInService {
    constructor(redisClient, config) {
        this.redis = redisClient;
        this.config = config;
        // 初始化数据服务
        this.dataService = new PlayerDataService(redisClient, config, logger);
    }

    /**
     * 签到功能
     * @param {string} userId 用户ID
     * @returns {Object} 签到结果
     */
    async signIn(userId) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (multi, playerKey) => {
                const playerData = await this.dataService.getPlayer(userId);
                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                const now = new Date();
                const today = now.toDateString();

                // 检查是否已经签到
                if (playerData.signIn.lastSignDate === today) {
                    return {
                        success: false,
                        message: '今日已经签到过了！',
                        playerData: null
                    };
                }

                // 计算连续签到天数
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();
                if (playerData.signIn.lastSignDate === yesterday) {
                    playerData.signIn.consecutiveDays += 1;
                } else {
                    playerData.signIn.consecutiveDays = 1;
                }

                playerData.signIn.lastSignDate = today;
                playerData.signIn.totalSignDays += 1;

                // 计算签到奖励
                const rewards = this._calculateSignInRewards(playerData.signIn.consecutiveDays);

                // 发放奖励
                playerData.coins += rewards.coins;
                playerData.experience += rewards.experience;
                playerData.statistics.totalMoneyEarned += rewards.coins;

                playerData.lastUpdated = Date.now();

                // 使用序列化器统一处理
                const serializer = this.dataService.getSerializer();
                multi.hSet(playerKey, serializer.serializeForHash(playerData));

                logger.info(`[SignInService] 玩家 ${userId} 签到成功，连续 ${playerData.signIn.consecutiveDays} 天`);

                return {
                    success: true,
                    message: `签到成功！连续签到 ${playerData.signIn.consecutiveDays} 天`,
                    rewards,
                    consecutiveDays: playerData.signIn.consecutiveDays,
                    totalSignDays: playerData.signIn.totalSignDays,
                    playerData
                };
            });
        } catch (error) {
            logger.error(`[SignInService] 签到失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 每日签到（别名方法，保持兼容性）
     * @param {string} userId 用户ID
     * @returns {Object} 签到结果
     */
    async dailySignIn(userId) {
        return await this.signIn(userId);
    }

    /**
     * 计算签到奖励
     * @param {number} consecutiveDays 连续签到天数
     * @returns {Object} 奖励信息
     */
    _calculateSignInRewards(consecutiveDays) {
        const baseCoins = 50;
        const baseExp = 10;

        // 连续签到加成
        let multiplier = 1;
        if (consecutiveDays >= 7) multiplier = 1.5;
        if (consecutiveDays >= 30) multiplier = 2.0;

        // 特殊里程碑奖励
        const milestoneBonus = this._getMilestoneBonus(consecutiveDays);

        return {
            coins: Math.floor(baseCoins * multiplier) + milestoneBonus.coins,
            experience: Math.floor(baseExp * multiplier) + milestoneBonus.experience,
            items: milestoneBonus.items,
            milestone: milestoneBonus.milestone
        };
    }

    /**
     * 获取里程碑奖励
     * @param {number} consecutiveDays 连续签到天数
     * @returns {Object} 里程碑奖励
     */
    _getMilestoneBonus(consecutiveDays) {
        const milestones = {
            7: { coins: 100, experience: 20, items: [], milestone: '连续签到一周' },
            14: { coins: 200, experience: 40, items: [], milestone: '连续签到两周' },
            30: { coins: 500, experience: 100, items: [], milestone: '连续签到一个月' },
            60: { coins: 1000, experience: 200, items: [], milestone: '连续签到两个月' },
            100: { coins: 2000, experience: 500, items: [], milestone: '连续签到100天' }
        };

        return milestones[consecutiveDays] || { coins: 0, experience: 0, items: [], milestone: null };
    }

    /**
     * 获取签到状态
     * @param {string} userId 用户ID
     * @returns {Object} 签到状态
     */
    async getSignInStatus(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const now = new Date();
            const today = now.toDateString();
            const hasSignedToday = playerData.signIn.lastSignDate === today;

            // 计算下次签到奖励
            const nextDayRewards = this._calculateSignInRewards(
                hasSignedToday ? playerData.signIn.consecutiveDays : playerData.signIn.consecutiveDays + 1
            );

            return {
                hasSignedToday,
                consecutiveDays: playerData.signIn.consecutiveDays,
                totalSignDays: playerData.signIn.totalSignDays,
                lastSignDate: playerData.signIn.lastSignDate,
                nextDayRewards,
                canSignIn: !hasSignedToday
            };
        } catch (error) {
            logger.error(`[SignInService] 获取签到状态失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取签到历史统计
     * @param {string} userId 用户ID
     * @returns {Object} 签到统计
     */
    async getSignInStats(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const now = new Date();
            const today = now.toDateString();
            const hasSignedToday = playerData.signIn.lastSignDate === today;

            // 计算签到率（基于创建时间）
            const accountAge = Math.floor((Date.now() - playerData.createdAt) / (1000 * 60 * 60 * 24)) + 1;
            const signInRate = Math.round((playerData.signIn.totalSignDays / accountAge) * 100);

            // 计算最长连续签到记录（这里简化处理，实际可能需要更复杂的逻辑）
            const longestStreak = Math.max(playerData.signIn.consecutiveDays,
                playerData.stats?.longestSignInStreak || 0);

            return {
                totalSignDays: playerData.signIn.totalSignDays,
                consecutiveDays: playerData.signIn.consecutiveDays,
                longestStreak,
                signInRate,
                accountAge,
                hasSignedToday,
                lastSignDate: playerData.signIn.lastSignDate
            };
        } catch (error) {
            logger.error(`[SignInService] 获取签到统计失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取签到奖励预览
     * @param {number} consecutiveDays 连续签到天数
     * @returns {Object} 奖励预览
     */
    getSignInRewardsPreview(consecutiveDays) {
        const rewards = [];

        for (let day = 1; day <= Math.min(consecutiveDays + 7, 30); day++) {
            const dayRewards = this._calculateSignInRewards(day);
            rewards.push({
                day,
                ...dayRewards
            });
        }

        return rewards;
    }

    /**
     * 检查是否可以签到
     * @param {string} userId 用户ID
     * @returns {Object} 检查结果
     */
    async canSignIn(userId) {
        try {
            const status = await this.getSignInStatus(userId);
            return {
                canSignIn: status.canSignIn,
                reason: status.canSignIn ? '可以签到' : '今日已签到'
            };
        } catch (error) {
            logger.error(`[SignInService] 检查签到状态失败 [${userId}]: ${error.message}`);
            return {
                canSignIn: false,
                reason: '检查失败'
            };
        }
    }

    /**
     * 重置连续签到天数（管理员功能）
     * @param {string} userId 用户ID
     * @returns {Object} 重置结果
     */
    async resetConsecutiveDays(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const oldConsecutiveDays = playerData.signIn.consecutiveDays;
            playerData.signIn.consecutiveDays = 0;
            playerData.lastUpdated = Date.now();

            await this.dataService.updateComplexField(userId, 'signIn', playerData.signIn);
            await this.dataService.updateSimpleField(userId, 'lastUpdated', playerData.lastUpdated);

            logger.info(`[SignInService] 重置玩家 ${userId} 连续签到天数: ${oldConsecutiveDays} -> 0`);

            return {
                success: true,
                message: '连续签到天数已重置',
                oldConsecutiveDays,
                newConsecutiveDays: 0
            };
        } catch (error) {
            logger.error(`[SignInService] 重置连续签到失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }
}

export default SignInService; 