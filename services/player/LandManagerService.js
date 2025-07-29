/**
 * 土地管理服务
 * 处理玩家土地管理相关功能
 */

import PlayerDataService from './PlayerDataService.js';

class LandManagerService {
    constructor(redisClient, config) {
        this.redis = redisClient;
        this.config = config;
        // 初始化数据服务
        this.dataService = new PlayerDataService(redisClient, config, logger);
    }

    /**
     * 扩张土地
     * @param {string} userId 用户ID
     * @returns {Object} 扩张结果
     */
    async expandLand(userId) {
        try {
            // 执行扩张 - 所有检查和操作都在事务内进行，确保原子性
            return await this.dataService.executeWithTransaction(userId, async (multi, playerKey) => {
                // 在事务内获取最新的玩家数据
                const playerData = await this.dataService.getPlayer(userId);

                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                // 在事务内检查是否已达到上限
                if (playerData.landCount >= playerData.maxLandCount) {
                    throw new Error('土地数量已达到上限！');
                }

                // 获取扩张配置
                const nextLandNumber = playerData.landCount + 1;
                const landConfig = this.config.land?.expansion?.[nextLandNumber];

                if (!landConfig) {
                    throw new Error('无法获取土地扩张配置！');
                }

                // 在事务内检查等级要求
                if (playerData.level < landConfig.levelRequired) {
                    throw new Error(`需要等级 ${landConfig.levelRequired} 才能扩张第 ${nextLandNumber} 块土地！当前等级: ${playerData.level}`);
                }

                // 在事务内检查金币是否足够
                if (playerData.coins < landConfig.goldCost) {
                    throw new Error(`金币不足！需要 ${landConfig.goldCost} 金币，当前拥有: ${playerData.coins}`);
                }

                // 扣除金币（使用内部方法确保逻辑一致性）
                this._updateCoinsInTransaction(playerData, -landConfig.goldCost);

                // 增加土地数量
                playerData.landCount += 1;

                // 创建新土地
                const newLand = {
                    id: nextLandNumber,
                    crop: null,
                    quality: 'normal',
                    plantTime: null,
                    harvestTime: null,
                    status: 'empty'
                };

                // 确保lands数组存在并添加新土地
                if (!Array.isArray(playerData.lands)) {
                    playerData.lands = [];
                }
                playerData.lands.push(newLand);

                playerData.lastUpdated = Date.now();

                // 使用序列化器统一处理
                const serializer = this.dataService.getSerializer();
                multi.hSet(playerKey, serializer.serializeForHash(playerData));

                logger.info(`[LandManagerService] 玩家 ${userId} 扩张土地成功，第 ${nextLandNumber} 块土地，花费 ${landConfig.goldCost} 金币`);

                return {
                    success: true,
                    message: `成功扩张第 ${nextLandNumber} 块土地！`,
                    landNumber: nextLandNumber,
                    costGold: landConfig.goldCost,
                    currentLandCount: playerData.landCount,
                    remainingCoins: playerData.coins,
                    newLand
                };
            });
        } catch (error) {
            logger.error(`[LandManagerService] 扩张土地失败 [${userId}]: ${error.message}`);

            // 将内部错误转换为用户友好的返回格式
            if (error.message === '土地数量已达到上限！') {
                return {
                    success: false,
                    message: error.message,
                    currentLandCount: null, // 无法获取，因为事务已回滚
                    maxLandCount: null
                };
            }

            if (error.message === '无法获取土地扩张配置！') {
                return {
                    success: false,
                    message: error.message
                };
            }

            if (error.message.includes('需要等级') || error.message.includes('金币不足')) {
                return {
                    success: false,
                    message: error.message
                };
            }

            // 对于其他错误，重新抛出
            throw error;
        }
    }

    /**
     * 智能土地访问方法 - 通过索引获取土地
     * @param {string} userId 用户ID
     * @param {number} index 土地索引（0-based）
     * @returns {Object|null} 土地数据或null
     */
    async getLandByIndex(userId, index) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                logger.warn(`[LandManagerService] 玩家 ${userId} 不存在`);
                return null;
            }

            // 边界检查
            if (!Array.isArray(playerData.lands)) {
                logger.warn(`[LandManagerService] 玩家 ${userId} 土地数据结构异常`);
                return null;
            }

            if (index < 0 || index >= playerData.lands.length) {
                logger.warn(`[LandManagerService] 土地索引越界 [${userId}]: index=${index}, length=${playerData.lands.length}`);
                return null;
            }

            return playerData.lands[index];
        } catch (error) {
            logger.error(`[LandManagerService] 获取土地失败 [${userId}, index=${index}]: ${error.message}`);
            return null;
        }
    }

    /**
     * 智能土地访问方法 - 通过土地ID获取土地
     * @param {string} userId 用户ID
     * @param {number} landId 土地ID（1-based）
     * @returns {Object|null} 土地数据或null
     */
    async getLandById(userId, landId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                logger.warn(`[LandManagerService] 玩家 ${userId} 不存在`);
                return null;
            }

            // 边界检查
            if (!Array.isArray(playerData.lands)) {
                logger.warn(`[LandManagerService] 玩家 ${userId} 土地数据结构异常`);
                return null;
            }

            if (landId < 1 || landId > playerData.lands.length) {
                logger.warn(`[LandManagerService] 土地ID越界 [${userId}]: landId=${landId}, length=${playerData.lands.length}`);
                return null;
            }

            return playerData.lands[landId - 1];
        } catch (error) {
            logger.error(`[LandManagerService] 获取土地失败 [${userId}, landId=${landId}]: ${error.message}`);
            return null;
        }
    }

    /**
     * 智能土地更新方法 - 更新指定土地的属性
     * @param {string} userId 用户ID
     * @param {number} landId 土地ID（1-based）
     * @param {Object} updates 要更新的属性
     * @returns {Object} 更新结果
     */
    async updateLand(userId, landId, updates) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (_multi, _playerKey) => {
                const playerData = await this.dataService.getPlayer(userId);

                if (!playerData) {
                    return {
                        success: false,
                        message: '玩家不存在'
                    };
                }

                // 边界检查
                if (!Array.isArray(playerData.lands)) {
                    return {
                        success: false,
                        message: '玩家土地数据结构异常'
                    };
                }

                if (landId < 1 || landId > playerData.lands.length) {
                    return {
                        success: false,
                        message: `无效的土地ID ${landId}，有效范围: 1-${playerData.lands.length}`
                    };
                }

                const landIndex = landId - 1;
                const land = playerData.lands[landIndex];

                if (!land) {
                    return {
                        success: false,
                        message: `土地 ${landId} 数据不存在`
                    };
                }

                // 应用更新
                const updatedLand = { ...land, ...updates };
                playerData.lands[landIndex] = updatedLand;
                playerData.lastUpdated = Date.now();

                // 保存到Redis
                await this.dataService.updateMixedFields(
                    userId,
                    { lastUpdated: playerData.lastUpdated },
                    { lands: playerData.lands }
                );

                logger.info(`[LandManagerService] 玩家 ${userId} 土地 ${landId} 更新成功`);

                return {
                    success: true,
                    message: `土地 ${landId} 更新成功`,
                    landId,
                    updatedLand,
                    updates
                };
            });
        } catch (error) {
            logger.error(`[LandManagerService] 更新土地失败 [${userId}, landId=${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取所有土地信息
     * @param {string} userId 用户ID
     * @returns {Array} 土地数组
     */
    async getAllLands(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                logger.warn(`[LandManagerService] 玩家 ${userId} 不存在`);
                return [];
            }

            if (!Array.isArray(playerData.lands)) {
                logger.warn(`[LandManagerService] 玩家 ${userId} 土地数据结构异常`);
                return [];
            }

            return playerData.lands;
        } catch (error) {
            logger.error(`[LandManagerService] 获取所有土地失败 [${userId}]: ${error.message}`);
            return [];
        }
    }

    /**
     * 验证土地ID是否有效
     * @param {string} userId 用户ID
     * @param {number} landId 土地ID（1-based）
     * @returns {Object} 验证结果
     */
    async validateLandId(userId, landId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                return {
                    valid: false,
                    message: '玩家不存在'
                };
            }

            if (!Array.isArray(playerData.lands)) {
                return {
                    valid: false,
                    message: '玩家土地数据结构异常'
                };
            }

            if (landId < 1 || landId > playerData.lands.length) {
                return {
                    valid: false,
                    message: `无效的土地ID ${landId}，有效范围: 1-${playerData.lands.length}`
                };
            }

            return {
                valid: true,
                landId,
                landIndex: landId - 1,
                totalLands: playerData.lands.length
            };
        } catch (error) {
            logger.error(`[LandManagerService] 验证土地ID失败 [${userId}, landId=${landId}]: ${error.message}`);
            return {
                valid: false,
                message: '验证失败'
            };
        }
    }

    /**
     * 获取土地扩张信息
     * @param {string} userId 用户ID
     * @returns {Object} 扩张信息
     */
    async getLandExpansionInfo(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                throw new Error('玩家不存在');
            }

            // 检查是否已达到上限
            if (playerData.landCount >= playerData.maxLandCount) {
                return {
                    canExpand: false,
                    reason: '已达到土地上限',
                    currentLandCount: playerData.landCount,
                    maxLandCount: playerData.maxLandCount
                };
            }

            // 获取下一块土地的配置
            const nextLandNumber = playerData.landCount + 1;
            const landConfig = this.config.land?.expansion?.[nextLandNumber];

            if (!landConfig) {
                return {
                    canExpand: false,
                    reason: '无扩张配置',
                    currentLandCount: playerData.landCount,
                    maxLandCount: playerData.maxLandCount
                };
            }

            // 检查是否满足扩张条件
            const meetsLevelRequirement = playerData.level >= landConfig.levelRequired;
            const meetsGoldRequirement = playerData.coins >= landConfig.goldCost;
            const meetsRequirements = meetsLevelRequirement && meetsGoldRequirement;

            return {
                canExpand: true,
                nextLandNumber,
                nextCost: landConfig.goldCost,
                nextLevelRequired: landConfig.levelRequired,
                meetsRequirements,
                meetsLevelRequirement,
                meetsGoldRequirement,
                currentLandCount: playerData.landCount,
                maxLandCount: playerData.maxLandCount,
                currentLevel: playerData.level,
                currentCoins: playerData.coins
            };
        } catch (error) {
            logger.error(`[LandManagerService] 获取土地扩张信息失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取土地系统配置
     * @returns {Object} 土地系统配置
     */
    getLandSystemConfig() {
        try {
            return {
                startingLands: this.config.land.default.startingLands,
                maxLands: this.config.land.default.maxLands,
                expansionConfig: this.config.land.expansion,
                qualityConfig: this.config.land.quality
            };
        } catch (error) {
            logger.error(`[LandManagerService] 获取土地系统配置失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 在事务上下文中更新金币和统计数据（内部方法）
     * 该方法用于在已有事务中直接操作玩家数据，避免事务嵌套
     * @param {Object} playerData 玩家数据对象
     * @param {number} amount 金币变化量（可为负数）
     * @returns {number} 实际变化量
     * @private
     */
    _updateCoinsInTransaction(playerData, amount) {
        if (!playerData) {
            throw new Error('玩家数据不能为空');
        }

        // 计算新的金币数量（确保不为负数）
        const newCoins = Math.max(0, playerData.coins + amount);
        const actualChange = newCoins - playerData.coins;

        // 更新统计数据
        if (actualChange > 0) {
            playerData.statistics.totalMoneyEarned += actualChange;
        } else if (actualChange < 0) {
            playerData.statistics.totalMoneySpent += Math.abs(actualChange);
        }

        // 更新金币数量
        playerData.coins = newCoins;
        playerData.lastUpdated = Date.now();

        return actualChange;
    }
}

export default LandManagerService; 