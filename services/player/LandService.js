/**
 * 土地管理服务
 * 处理玩家土地管理相关功能
 */

import PlayerDataService from './PlayerDataService.js';
import EconomyService from './EconomyService.js';

class LandService {
    constructor(redisClient, config, playerService = null) {
        this.redis = redisClient;
        this.config = config;
        this.playerService = playerService;
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
            return await this.dataService.executeWithTransaction(userId, async (dataService, userId) => {
                // 在事务内获取最新的玩家数据
                const playerData = await dataService.getPlayer(userId);

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

                // 扣除金币
                EconomyService.updateCoinsInTransaction(playerData, -landConfig.goldCost);

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

                // 保存更新后的数据
                await dataService.savePlayer(userId, playerData);


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
            logger.error(`[LandService] 扩张土地失败 [${userId}]: ${error.message}`);

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
                logger.warn(`[LandService] 玩家 ${userId} 不存在`);
                return null;
            }

            // 边界检查
            if (!Array.isArray(playerData.lands)) {
                logger.warn(`[LandService] 玩家 ${userId} 土地数据结构异常`);
                return null;
            }

            if (index < 0 || index >= playerData.lands.length) {
                logger.warn(`[LandService] 土地索引越界 [${userId}]: index=${index}, length=${playerData.lands.length}`);
                return null;
            }

            return playerData.lands[index];
        } catch (error) {
            logger.error(`[LandService] 获取土地失败 [${userId}, index=${index}]: ${error.message}`);
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
                logger.warn(`[LandService] 玩家 ${userId} 不存在`);
                return null;
            }

            // 边界检查
            if (!Array.isArray(playerData.lands)) {
                logger.warn(`[LandService] 玩家 ${userId} 土地数据结构异常`);
                return null;
            }
            if (landId < 1 || landId > playerData.lands.length) {
                logger.warn(`[LandService] 土地ID越界 [${userId}]: landId=${landId}, length=${playerData.lands.length}`);
                return null;
            }

            return playerData.lands[landId - 1];
        } catch (error) {
            logger.error(`[LandService] 获取土地失败 [${userId}, landId=${landId}]: ${error.message}`);
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
            return await this.dataService.executeWithTransaction(userId, async (dataService, userId) => {
                const playerData = await dataService.getPlayer(userId);

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

                // 保存数据
                await dataService.savePlayer(userId, playerData);


                return {
                    success: true,
                    message: `土地 ${landId} 更新成功`,
                    landId,
                    updatedLand,
                    updates
                };
            });
        } catch (error) {
            logger.error(`[LandService] 更新土地失败 [${userId}, landId=${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取所有土地信息
     * @param {string} userId 用户ID
     * @returns {Array} 土地数组
     */

    /**
     * 单事务原子升级土地品质（由外部传入目标品质）
     * @param {string} userId 用户ID
     * @param {number} landId 土地ID（1-based）
     * @param {string} targetQuality 目标品质 key（如：red/black/gold）
     * @returns {Promise<Object>} 升级结果
     */
    async upgradeLandQuality(userId, landId, targetQuality) {
        try {
            return await this.dataService.executeWithTransaction(userId, async (dataService, uid) => {
                const playerData = await dataService.getPlayer(uid);

                if (!playerData) {
                    throw new Error('玩家不存在');
                }

                if (!Number.isInteger(landId) || landId < 1) {
                    throw new Error(`无效的土地ID ${landId}`);
                }

                if (!Array.isArray(playerData.lands) || landId > playerData.lands.length) {
                    throw new Error(`无效的土地ID ${landId}，有效范围 1-${Array.isArray(playerData.lands) ? playerData.lands.length : 0}`);
                }

                const landIndex = landId - 1;
                const land = playerData.lands[landIndex];
                if (!land) {
                    throw new Error(`土地 ${landId} 数据不存在`);
                }

                const qualityConfig = this.config?.land?.quality;
                if (!qualityConfig) {
                    throw new Error('土地品质配置缺失');
                }

                const currentQuality = land.quality || 'normal';
                // normal 是默认品质，不需要配置
                const currentQualityConfig = qualityConfig?.[currentQuality];
                const currentQualityName = currentQualityConfig?.name || '普通土地';

                if (!targetQuality || typeof targetQuality !== 'string') {
                    throw new Error('目标品质不能为空');
                }

                const targetQualityConfig = qualityConfig?.[targetQuality];
                if (!targetQualityConfig) {
                    throw new Error(`目标品质配置不存在: ${targetQuality}`);
                }

                if (currentQuality === targetQuality) {
                    throw new Error('土地已是目标品质');
                }

                // 读取目标品质的升级条件（按土地编号）
                const levelCfg = targetQualityConfig.levels?.[landId] ?? targetQualityConfig.levels?.[String(landId)];
                if (!levelCfg) {
                    throw new Error(`缺少土地品质升级配置: quality.${targetQuality}.levels.${landId}`);
                }

                const levelRequired = Number(levelCfg.levelRequired);
                const goldCost = Number(levelCfg.goldCost);

                if (!Number.isFinite(levelRequired)) {
                    throw new Error(`升级等级要求配置非法: quality.${targetQuality}.levels.${landId}.levelRequired`);
                }
                if (!Number.isFinite(goldCost) || goldCost < 0) {
                    throw new Error(`升级金币消耗配置非法: quality.${targetQuality}.levels.${landId}.goldCost`);
                }

                // 校验等级/金币
                if (playerData.level < levelRequired) {
                    throw new Error(`等级不足：需要等级${levelRequired}，当前等级${playerData.level}`);
                }

                if (playerData.coins < goldCost) {
                    throw new Error(`金币不足：需要${goldCost}，当前${playerData.coins}`);
                }

                // 扣除金币（事务内）
                if (goldCost > 0) {
                    EconomyService.updateCoinsInTransaction(playerData, -goldCost);
                }

                // 更新土地品质为目标品质
                land.quality = targetQuality;
                land.lastUpgradeTime = Date.now();
                playerData.lands[landIndex] = land;

                await dataService.savePlayer(uid, playerData);

                return {
                    success: true,
                    message: `土地 ${landId} 升级成功：${currentQualityName} → ${targetQualityConfig.name}`,
                    landId,
                    fromQuality: currentQuality,
                    toQuality: targetQuality,
                    fromQualityName: currentQualityName,
                    toQualityName: targetQualityConfig.name,
                    costGold: goldCost,
                    remainingCoins: playerData.coins
                };
            });
        } catch (error) {
            logger.error(`[LandService] 升级土地品质失败 [${userId}, landId=${landId}]: ${error.message}`);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * 获取所有土地（兼容旧 LandService 返回结构）
     * @param {string} userId 用户ID
     * @returns {Promise<{success: boolean, lands: Array, error?: string}>}
     */
    async getAllLands(userId) {
        try {
            const playerData = await this.dataService.getPlayer(userId);

            if (!playerData) {
                logger.warn(`[LandService] 玩家 ${userId} 不存在`);
                return { success: false, lands: [], error: '玩家不存在' };
            }

            if (!Array.isArray(playerData.lands)) {
                logger.warn(`[LandService] 玩家 ${userId} 土地数据结构异常`);
                return { success: false, lands: [], error: '玩家土地数据结构异常' };
            }

            return { success: true, lands: playerData.lands };
        } catch (error) {
            logger.error(`[LandService] 获取所有土地失败 [${userId}]: ${error.message}`);
            return { success: false, lands: [], error: error.message };
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
            logger.error(`[LandService] 验证土地ID失败 [${userId}, landId=${landId}]: ${error.message}`);
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
            logger.error(`[LandService] 获取土地扩张信息失败 [${userId}]: ${error.message}`);
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
            logger.error(`[LandService] 获取土地系统配置失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 通过品质名称升级土地（自动匹配第一块可升级的土地）
     * 封装了品质名称解析和土地查找的业务逻辑
     * @param {string} userId 用户ID
     * @param {string} qualityName 目标品质名称（如："红土地"）
     * @returns {Promise<Object>} 升级结果
     */
    async upgradeLandByQualityName(userId, qualityName) {
        try {
            // 验证输入
            if (!qualityName || typeof qualityName !== 'string') {
                return {
                    success: false,
                    message: '请指定品质名称\n用法：#土地升级<品质名>\n例如：#土地升级红土地'
                };
            }

            // 获取玩家数据
            const playerData = await this.dataService.getPlayer(userId);
            if (!playerData) {
                return {
                    success: false,
                    message: '玩家不存在'
                };
            }

            if (!Array.isArray(playerData.lands) || playerData.lands.length === 0) {
                return {
                    success: false,
                    message: '您还没有土地'
                };
            }

            // 解析品质配置
            const qualityConfig = this.config?.land?.quality || {};
            const validQualityNames = Object.values(qualityConfig).map(v => v?.name).filter(Boolean);

            // 从品质名找到品质 key
            const targetQualityKey = Object.keys(qualityConfig).find(
                key => qualityConfig[key]?.name === qualityName
            );

            if (!targetQualityKey) {
                const tips = validQualityNames.length ? `\n可选：${validQualityNames.join('、')}` : '';
                return {
                    success: false,
                    message: `品质名称错误：${qualityName}${tips}`
                };
            }

            // 确定可升级的源品质（前一级）
            const qualityOrder = ['normal', 'red', 'black', 'gold'];
            const targetIdx = qualityOrder.indexOf(targetQualityKey);
            const sourceQuality = qualityOrder[targetIdx - 1];

            // 找第一块源品质的土地
            const landIndex = playerData.lands.findIndex(l => (l.quality || 'normal') === sourceQuality);

            if (landIndex === -1) {
                const sourceName = sourceQuality === 'normal' ? '普通土地' : (qualityConfig[sourceQuality]?.name || sourceQuality);
                return {
                    success: false,
                    message: `没有可升级为${qualityConfig[targetQualityKey]?.name}的土地（需要${sourceName}）`
                };
            }

            // 计算土地 ID（1-based）
            const landId = landIndex + 1;

            // 调用底层升级方法
            return await this.upgradeLandQuality(userId, landId, targetQualityKey);
        } catch (error) {
            logger.error(`[LandService] 通过品质名称升级土地失败 [${userId}, ${qualityName}]: ${error.message}`);
            return {
                success: false,
                message: `升级失败：${error.message}`
            };
        }
    }
}

export default LandService; 
