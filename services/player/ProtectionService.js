/**
 * 防御服务
 * 处理玩家防御和保护相关功能
 */

import PlayerDataService from './PlayerDataService.js';

class ProtectionService {
    constructor(redisClient, config, logger = null) {
        this.redis = redisClient;
        this.config = config;
        this.logger = logger || console;

        // 初始化数据服务
        this.dataService = new PlayerDataService(redisClient, config, logger);
    }

    /**
     * 使用狗粮设置防御
     * @param {string} userId 用户ID
     * @param {string} dogFoodType 狗粮类型
     * @returns {Object} 使用结果
     */
    async useDogFood(userId, dogFoodType) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
                const playerData = await this.dataService.getPlayerFromHash(userId);

                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                // 获取狗粮配置
                const dogFoodConfig = this.config.items?.dogFood?.[dogFoodType];
                if (!dogFoodConfig) {
                    throw new Error(`未知的狗粮类型: ${dogFoodType}`);
                }

                const now = Date.now();
                const duration = dogFoodConfig.duration * 60 * 1000; // 转换为毫秒

                // 设置防御效果（新效果覆盖旧效果）
                playerData.protection.dogFood = {
                    type: dogFoodType,
                    effectEndTime: now + duration,
                    defenseBonus: dogFoodConfig.defenseBonus
                };

                playerData.lastUpdated = now;

                // 使用混合更新
                await this.dataService.updateMixedFields(
                    userId,
                    { lastUpdated: now },
                    { protection: playerData.protection }
                );

                this.logger.info(`[ProtectionService] 玩家 ${userId} 使用 ${dogFoodType} 狗粮，防御 ${dogFoodConfig.defenseBonus}%，持续 ${dogFoodConfig.duration} 分钟`);

                return {
                    success: true,
                    dogFoodType,
                    defenseBonus: dogFoodConfig.defenseBonus,
                    durationMinutes: dogFoodConfig.duration,
                    endTime: playerData.protection.dogFood.effectEndTime
                };
            });
        } catch (error) {
            this.logger.error(`[ProtectionService] 使用狗粮失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 检查玩家防御状态
     * @param {string} userId 用户ID
     * @returns {Object} 防御状态
     */
    async getProtectionStatus(userId) {
        try {
            const playerData = await this.dataService.getPlayerFromHash(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const now = Date.now();

            const dogFoodActive = playerData.protection.dogFood.effectEndTime > now;
            const farmProtectionActive = playerData.protection.farmProtection.endTime > now;
            const stealCooldownActive = playerData.stealing.cooldownEndTime > now;

            return {
                dogFood: {
                    active: dogFoodActive,
                    type: dogFoodActive ? playerData.protection.dogFood.type : null,
                    defenseBonus: dogFoodActive ? playerData.protection.dogFood.defenseBonus : 0,
                    endTime: playerData.protection.dogFood.effectEndTime,
                    remainingTime: dogFoodActive ? playerData.protection.dogFood.effectEndTime - now : 0
                },
                farmProtection: {
                    active: farmProtectionActive,
                    endTime: playerData.protection.farmProtection.endTime,
                    remainingTime: farmProtectionActive ? playerData.protection.farmProtection.endTime - now : 0
                },
                stealCooldown: {
                    active: stealCooldownActive,
                    endTime: playerData.stealing.cooldownEndTime,
                    remainingTime: stealCooldownActive ? playerData.stealing.cooldownEndTime - now : 0
                },
                totalDefenseBonus: dogFoodActive ? playerData.protection.dogFood.defenseBonus : 0
            };
        } catch (error) {
            this.logger.error(`[ProtectionService] 获取防御状态失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 设置偷菜冷却
     * @param {string} userId 用户ID
     * @param {number} cooldownMinutes 冷却时间（分钟）
     */
    async setStealCooldown(userId, cooldownMinutes = 5) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
                const playerData = await this.dataService.getPlayerFromHash(userId);

                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                const now = Date.now();
                playerData.stealing.lastStealTime = now;
                playerData.stealing.cooldownEndTime = now + (cooldownMinutes * 60 * 1000);
                playerData.lastUpdated = now;

                // 使用混合更新
                await this.dataService.updateMixedFields(
                    userId,
                    { lastUpdated: now },
                    { stealing: playerData.stealing }
                );

                this.logger.info(`[ProtectionService] 玩家 ${userId} 偷菜冷却 ${cooldownMinutes} 分钟`);
                return playerData;
            });
        } catch (error) {
            this.logger.error(`[ProtectionService] 设置偷菜冷却失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 设置农场保护
     * @param {string} userId 用户ID
     * @param {number} protectionMinutes 保护时间（分钟）
     */
    async setFarmProtection(userId, protectionMinutes = 30) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
                const playerData = await this.dataService.getPlayerFromHash(userId);

                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                const now = Date.now();
                playerData.protection.farmProtection.endTime = now + (protectionMinutes * 60 * 1000);
                playerData.lastUpdated = now;

                // 使用混合更新
                await this.dataService.updateMixedFields(
                    userId,
                    { lastUpdated: now },
                    { protection: playerData.protection }
                );

                this.logger.info(`[ProtectionService] 玩家 ${userId} 农场保护 ${protectionMinutes} 分钟`);
                return playerData;
            });
        } catch (error) {
            this.logger.error(`[ProtectionService] 设置农场保护失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 检查是否可以偷菜
     * @param {string} userId 用户ID
     * @returns {Object} 检查结果
     */
    async canSteal(userId) {
        try {
            const status = await this.getProtectionStatus(userId);

            return {
                canSteal: !status.stealCooldown.active,
                reason: status.stealCooldown.active ? '偷菜冷却中' : '可以偷菜',
                cooldownRemaining: status.stealCooldown.remainingTime
            };
        } catch (error) {
            this.logger.error(`[ProtectionService] 检查偷菜状态失败 [${userId}]: ${error.message}`);
            return {
                canSteal: false,
                reason: '检查失败',
                cooldownRemaining: 0
            };
        }
    }

    /**
     * 检查是否受到保护
     * @param {string} userId 用户ID
     * @returns {Object} 保护状态
     */
    async isProtected(userId) {
        try {
            const status = await this.getProtectionStatus(userId);

            const isProtected = status.farmProtection.active || status.dogFood.active;

            return {
                isProtected,
                protectionTypes: {
                    farmProtection: status.farmProtection.active,
                    dogFood: status.dogFood.active
                },
                defenseBonus: status.totalDefenseBonus,
                protectionRemaining: Math.max(
                    status.farmProtection.remainingTime,
                    status.dogFood.remainingTime
                )
            };
        } catch (error) {
            this.logger.error(`[ProtectionService] 检查保护状态失败 [${userId}]: ${error.message}`);
            return {
                isProtected: false,
                protectionTypes: { farmProtection: false, dogFood: false },
                defenseBonus: 0,
                protectionRemaining: 0
            };
        }
    }

    /**
     * 清除过期的防御效果
     * @param {string} userId 用户ID
     * @returns {Object} 清理结果
     */
    async clearExpiredProtections(userId) {
        try {
            const playerData = await this.dataService.getPlayerFromHash(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            const now = Date.now();
            let hasChanges = false;
            const clearedEffects = [];

            // 清除过期的狗粮效果
            if (playerData.protection.dogFood.effectEndTime > 0 &&
                playerData.protection.dogFood.effectEndTime <= now) {
                playerData.protection.dogFood = {
                    type: null,
                    effectEndTime: 0,
                    defenseBonus: 0
                };
                hasChanges = true;
                clearedEffects.push('狗粮防御');
            }

            // 清除过期的农场保护
            if (playerData.protection.farmProtection.endTime > 0 &&
                playerData.protection.farmProtection.endTime <= now) {
                playerData.protection.farmProtection.endTime = 0;
                hasChanges = true;
                clearedEffects.push('农场保护');
            }

            // 清除过期的偷菜冷却
            if (playerData.stealing.cooldownEndTime > 0 &&
                playerData.stealing.cooldownEndTime <= now) {
                playerData.stealing.cooldownEndTime = 0;
                hasChanges = true;
                clearedEffects.push('偷菜冷却');
            }

            if (hasChanges) {
                playerData.lastUpdated = now;

                await this.dataService.updateMixedFields(
                    userId,
                    { lastUpdated: now },
                    {
                        protection: playerData.protection,
                        stealing: playerData.stealing
                    }
                );

                this.logger.info(`[ProtectionService] 清除玩家 ${userId} 过期防御效果: ${clearedEffects.join(', ')}`);
            }

            return {
                hasChanges,
                clearedEffects
            };
        } catch (error) {
            this.logger.error(`[ProtectionService] 清除过期防御失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取可用的狗粮类型
     * @returns {Array} 狗粮类型列表
     */
    getAvailableDogFoodTypes() {
        const dogFoodConfig = this.config.items?.dogFood || {};

        return Object.keys(dogFoodConfig).map(type => ({
            type,
            ...dogFoodConfig[type]
        }));
    }

    /**
     * 计算防御成功率
     * @param {number} defenseBonus 防御加成
     * @param {number} attackPower 攻击力（可选）
     * @returns {number} 防御成功率（0-100）
     */
    calculateDefenseSuccessRate(defenseBonus, attackPower = 100) {
        // 基础防御成功率为50%
        const baseRate = 50;

        // 防御加成影响
        const bonusRate = defenseBonus;

        // 攻击力影响（简化计算）
        const attackPenalty = Math.max(0, (attackPower - 100) / 10);

        const finalRate = Math.min(95, Math.max(5, baseRate + bonusRate - attackPenalty));

        return Math.round(finalRate);
    }
}

export default ProtectionService; 