/**
 * 作物监控服务
 * 统一管理作物状态监控和收获调度功能
 * 合并了 CropStatusService 和 CropScheduleService 的功能
 */

import { PlantingUtils } from './PlantingUtils.js';

class CropMonitorService {
    constructor(plantingDataService, landService, redis, config) {
        this.plantingDataService = plantingDataService;
        this.landService = landService;
        this.redis = redis;
        this.config = config;
        // 初始化验证器
        this.validator = new PlantingUtils(config, logger);

        // Redis ZSet 键名（调度功能）
        this.scheduleKey = this.redis.generateKey('schedule', 'harvest');
    }

    // ==================== 状态监控功能（来自 CropStatusService）====================

    /**
     * 更新所有玩家的作物状态（定时任务调用）
     * @returns {Object} 更新结果
     */
    async updateAllCropsStatus() {
        try {
            const now = Date.now();
            let updatedPlayersCount = 0;
            let updatedLandsCount = 0;

            // 1. 高效获取所有到期的作物成员
            const dueSchedules = await this.getDueHarvestSchedules(now);

            if (!dueSchedules || dueSchedules.length === 0) {
                logger.info('[CropMonitorService] 没有需要更新的作物状态');
                return { success: true, updatedPlayers: 0, updatedLands: 0 };
            }

            // 2. 按玩家ID对需要更新的土地进行分组
            const updatesByUser = await this.getDueSchedulesByUser(now);

            // 3. 批量处理每个玩家的更新
            for (const userId in updatesByUser) {
                try {
                    // 使用分布式锁确保数据一致性
                    await this.redis.withLock(userId, async () => {
                        const updateResult = await this._updatePlayerCropsStatus(userId, updatesByUser[userId], now);
                        if (updateResult.hasUpdates) {
                            updatedPlayersCount++;
                            updatedLandsCount += updateResult.updatedLandsCount;
                        }
                    }, 'updateCrops');

                } catch (error) {
                    logger.error(`[CropMonitorService] 更新玩家${userId}作物状态失败: ${error.message}`);
                    // 继续处理其他玩家，不因单个玩家失败而中断整个批量更新
                }
            }

            // 4. 从计划中移除已处理的成员
            if (dueSchedules.length > 0) {
                const dueMembers = dueSchedules.map(schedule => schedule.member);
                await this.batchRemoveHarvestSchedules(dueMembers);
            }

            logger.info(`[CropMonitorService] 更新了${updatedPlayersCount}个玩家的${updatedLandsCount}块土地状态`);

            return {
                success: true,
                updatedPlayers: updatedPlayersCount,
                updatedLands: updatedLandsCount,
                processedSchedules: dueSchedules.length
            };

        } catch (error) {
            logger.error(`[CropMonitorService] 更新作物状态失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 更新单个玩家的作物状态
     * @param {string} userId 用户ID
     * @param {Array} landSchedules 土地计划列表
     * @param {number} now 当前时间
     * @returns {Object} 更新结果
     * @private
     */
    async _updatePlayerCropsStatus(userId, landSchedules, now) {
        try {
            let updatedLandsCount = 0;
            const landUpdates = {};

            // 获取所有需要更新的土地数据
            for (const schedule of landSchedules) {
                const landId = schedule.landId;

                try {
                    const landData = await this.landService.getLandById(userId, landId);
                    if (!landData || !landData.crop || landData.status === 'empty') {
                        continue;
                    }

                    // 检查是否真的到期了
                    if (!landData.harvestTime || now < landData.harvestTime) {
                        continue;
                    }

                    // 更新状态为成熟
                    const landUpdate = {
                        status: 'mature',
                        stealable: true // 成熟后可以被偷
                    };

                    // 检查是否需要生成护理需求
                    this._generateCareNeeds(landUpdate, landData, now);

                    landUpdates[landId] = landUpdate;
                    updatedLandsCount++;

                } catch (error) {
                    logger.error(`[CropMonitorService] 更新土地${landId}状态失败: ${error.message}`);
                }
            }

            // 批量更新土地状态
            if (Object.keys(landUpdates).length > 0) {
                await this.plantingDataService.updateMultipleLands(userId, landUpdates);
            }

            return {
                hasUpdates: updatedLandsCount > 0,
                updatedLandsCount: updatedLandsCount
            };

        } catch (error) {
            logger.error(`[CropMonitorService] 更新玩家${userId}作物状态失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 更新单个土地的作物状态
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @returns {Object} 更新结果
     */
    async updateSingleCropStatus(userId, landId) {
        try {
            const now = Date.now();
            const landData = await this.landService.getLandById(userId, landId);

            if (!landData) {
                return { success: false, message: `土地 ${landId} 不存在` };
            }

            if (!landData.crop || landData.status === 'empty') {
                return { success: false, message: `第${landId}块土地没有种植作物` };
            }

            let hasUpdates = false;
            const landUpdates = {};

            // 检查是否成熟
            if (landData.harvestTime && now >= landData.harvestTime && landData.status !== 'mature') {
                landUpdates.status = 'mature';
                landUpdates.stealable = true;
                hasUpdates = true;
            }

            // 检查是否需要护理
            this._updateCareNeeds(landUpdates, landData, now);
            if (Object.keys(landUpdates).length > 0) {
                hasUpdates = true;
            }

            // 检查是否枯萎
            const witherResult = this._checkWithering(landData, now);
            if (witherResult.shouldWither) {
                landUpdates.status = 'withered';
                landUpdates.stealable = false;
                hasUpdates = true;
            }

            if (hasUpdates) {
                await this.plantingDataService.updateLandCropData(userId, landId, landUpdates);

                // 如果成熟了，从计划中移除
                if (landUpdates.status === 'mature') {
                    await this.removeHarvestSchedule(userId, landId);
                }
            }

            return {
                success: true,
                hasUpdates: hasUpdates,
                updates: landUpdates,
                currentStatus: landData.status
            };

        } catch (error) {
            logger.error(`[CropMonitorService] 更新单个作物状态失败 [${userId}][${landId}]: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 获取玩家所有作物的状态信息
     * @param {string} userId 用户ID
     * @returns {Object} 作物状态信息
     */
    async getPlayerCropsStatus(userId) {
        try {
            const allLands = await this.landService.getAllLands(userId);
            if (!allLands || !allLands.success || !allLands.lands) {
                return { success: false, message: '获取土地数据失败' };
            }

            const now = Date.now();
            const cropsConfig = this.config.crops;
            const statusInfo = {
                total: allLands.lands.length,
                empty: 0,
                growing: 0,
                mature: 0,
                withered: 0,
                needsCare: 0,
                crops: []
            };

            for (const land of allLands.lands) {
                if (!land.crop || land.status === 'empty') {
                    statusInfo.empty++;
                    continue;
                }

                const cropConfig = cropsConfig[land.crop];
                const cropInfo = {
                    landId: land.id,
                    cropType: land.crop,
                    cropName: cropConfig?.name || land.crop,
                    status: land.status,
                    health: land.health || 100,
                    needsWater: land.needsWater || false,
                    hasPests: land.hasPests || false,
                    plantTime: land.plantTime,
                    harvestTime: land.harvestTime,
                    stealable: land.stealable || false
                };

                // 计算剩余时间
                if (land.harvestTime) {
                    const remainingTime = land.harvestTime - now;
                    cropInfo.remainingTime = Math.max(0, remainingTime);
                    cropInfo.isReady = remainingTime <= 0;
                }

                // 统计状态
                statusInfo[land.status]++;

                if (land.needsWater || land.hasPests) {
                    statusInfo.needsCare++;
                }

                statusInfo.crops.push(cropInfo);
            }

            return {
                success: true,
                data: statusInfo
            };

        } catch (error) {
            logger.error(`[CropMonitorService] 获取玩家作物状态失败 [${userId}]: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 清理枯萎的作物
     * @param {string} userId 用户ID
     * @returns {Object} 清理结果
     */
    async cleanWitheredCrops(userId) {
        try {
            const allLands = await this.landService.getAllLands(userId);
            if (!allLands || !allLands.success || !allLands.lands) {
                return { success: false, message: '获取土地数据失败' };
            }

            const landUpdates = {};
            let cleanedCount = 0;

            for (const land of allLands.lands) {
                if (land.status === 'withered') {
                    landUpdates[land.id] = {
                        crop: null,
                        plantTime: null,
                        harvestTime: null,
                        status: 'empty',
                        health: 100,
                        needsWater: false,
                        hasPests: false,
                        stealable: false
                    };
                    cleanedCount++;
                }
            }

            if (cleanedCount > 0) {
                await this.plantingDataService.updateMultipleLands(userId, landUpdates);
            }

            return {
                success: true,
                cleanedCount: cleanedCount,
                message: cleanedCount > 0 ? `清理了${cleanedCount}块枯萎的土地` : '没有需要清理的枯萎作物'
            };

        } catch (error) {
            logger.error(`[CropMonitorService] 清理枯萎作物失败 [${userId}]: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    // ==================== 调度管理功能（来自 CropScheduleService）====================

    /**
     * 添加收获计划
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @param {number} harvestTime 收获时间戳
     * @returns {Promise<boolean>} 是否添加成功
     */
    async addHarvestSchedule(userId, landId, harvestTime) {
        try {
            const scheduleMember = `${userId}:${landId}`;
            const result = await this.redis.client.zAdd(this.scheduleKey, {
                score: harvestTime,
                value: scheduleMember
            });

            logger.debug(`[CropMonitorService] 添加收获计划: ${scheduleMember} at ${harvestTime}`);
            return result > 0;

        } catch (error) {
            logger.error(`[CropMonitorService] 添加收获计划失败 [${userId}:${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 移除收获计划
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @returns {Promise<boolean>} 是否移除成功
     */
    async removeHarvestSchedule(userId, landId) {
        try {
            const scheduleMember = `${userId}:${landId}`;
            const result = await this.redis.client.zRem(this.scheduleKey, scheduleMember);

            logger.debug(`[CropMonitorService] 移除收获计划: ${scheduleMember}`);
            return result > 0;

        } catch (error) {
            logger.error(`[CropMonitorService] 移除收获计划失败 [${userId}:${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 更新收获计划时间
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @param {number} newHarvestTime 新的收获时间戳
     * @returns {Promise<boolean>} 是否更新成功
     */
    async updateHarvestSchedule(userId, landId, newHarvestTime) {
        try {
            const scheduleMember = `${userId}:${landId}`;

            // The zAdd command will automatically update the score if the member already exists.
            const result = await this.redis.client.zAdd(this.scheduleKey, {
                score: newHarvestTime,
                value: scheduleMember
            });

            logger.debug(`[CropMonitorService] 更新收获计划: ${scheduleMember} to ${newHarvestTime}`);
            return result > 0;

        } catch (error) {
            logger.error(`[CropMonitorService] 更新收获计划失败 [${userId}:${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取到期的收获计划
     * @param {number} currentTime 当前时间戳（可选，默认为当前时间）
     * @returns {Promise<Array>} 到期的收获计划列表
     */
    async getDueHarvestSchedules(currentTime = Date.now()) {
        try {
            const dueMembers = await this.redis.client.zRange(this.scheduleKey, 0, currentTime, {
                BY: 'SCORE'
            });

            if (!dueMembers || dueMembers.length === 0) {
                return [];
            }

            // 解析成员信息
            const schedules = dueMembers.map(member => {
                const [userId, landId] = member.split(':');
                return {
                    userId,
                    landId: parseInt(landId, 10),
                    member: member
                };
            });

            logger.debug(`[CropMonitorService] 获取到期收获计划: ${schedules.length} 个`);
            return schedules;

        } catch (error) {
            logger.error(`[CropMonitorService] 获取到期收获计划失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 批量移除收获计划
     * @param {Array} members 要移除的成员列表
     * @returns {Promise<number>} 移除的数量
     */
    async batchRemoveHarvestSchedules(members) {
        try {
            if (!members || members.length === 0) {
                return 0;
            }

            const result = await this.redis.client.zRem(this.scheduleKey, members);

            logger.debug(`[CropMonitorService] 批量移除收获计划: ${members.length} 个，实际移除: ${result} 个`);
            return result;

        } catch (error) {
            logger.error(`[CropMonitorService] 批量移除收获计划失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取指定用户的所有收获计划
     * @param {string} userId 用户ID
     * @returns {Promise<Array>} 用户的收获计划列表
     */
    async getUserHarvestSchedules(userId) {
        try {
            // 获取所有成员及其分数
            const allMembers = await this.redis.client.zRange(this.scheduleKey, 0, -1, {
                WITHSCORES: true
            });

            const userSchedules = [];

            // 过滤出指定用户的计划
            for (let i = 0; i < allMembers.length; i += 2) {
                const member = allMembers[i];
                const score = allMembers[i + 1];

                if (member.startsWith(`${userId}:`)) {
                    const [, landId] = member.split(':');
                    userSchedules.push({
                        userId,
                        landId: parseInt(landId, 10),
                        harvestTime: parseInt(score, 10),
                        member: member
                    });
                }
            }

            logger.debug(`[CropMonitorService] 获取用户收获计划 [${userId}]: ${userSchedules.length} 个`);
            return userSchedules;

        } catch (error) {
            logger.error(`[CropMonitorService] 获取用户收获计划失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取收获计划统计信息
     * @returns {Promise<Object>} 统计信息
     */
    async getScheduleStatistics() {
        try {
            const totalCount = await this.redis.client.zCard(this.scheduleKey);
            const now = Date.now();

            // 获取已到期的数量
            const dueCount = await this.redis.client.zCount(this.scheduleKey, 0, now);

            // 获取未来1小时内到期的数量
            const oneHourLater = now + (60 * 60 * 1000);
            const soonDueCount = await this.redis.client.zCount(this.scheduleKey, now + 1, oneHourLater);

            const statistics = {
                totalSchedules: totalCount,
                dueSchedules: dueCount,
                soonDueSchedules: soonDueCount,
                pendingSchedules: totalCount - dueCount
            };

            logger.debug(`[CropMonitorService] 收获计划统计: ${JSON.stringify(statistics)}`);
            return statistics;

        } catch (error) {
            logger.error(`[CropMonitorService] 获取收获计划统计失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 清理过期的收获计划（维护任务）
     * @param {number} expireTime 过期时间戳（默认为7天前）
     * @returns {Promise<number>} 清理的数量
     */
    async cleanupExpiredSchedules(expireTime = Date.now() - (7 * 24 * 60 * 60 * 1000)) {
        try {
            const result = await this.redis.client.zRemRangeByScore(this.scheduleKey, 0, expireTime);

            logger.info(`[CropMonitorService] 清理过期收获计划: ${result} 个`);
            return result;

        } catch (error) {
            logger.error(`[CropMonitorService] 清理过期收获计划失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 检查收获计划是否存在
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @returns {Promise<boolean>} 是否存在
     */
    async hasHarvestSchedule(userId, landId) {
        try {
            const scheduleMember = `${userId}:${landId}`;
            const score = await this.redis.client.zScore(this.scheduleKey, scheduleMember);

            return score !== null;

        } catch (error) {
            logger.error(`[CropMonitorService] 检查收获计划失败 [${userId}:${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取收获计划的时间
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @returns {Promise<number|null>} 收获时间戳，不存在时返回null
     */
    async getHarvestTime(userId, landId) {
        try {
            const scheduleMember = `${userId}:${landId}`;
            const score = await this.redis.client.zScore(this.scheduleKey, scheduleMember);

            return score ? parseInt(score, 10) : null;

        } catch (error) {
            logger.error(`[CropMonitorService] 获取收获时间失败 [${userId}:${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 按用户分组获取到期的收获计划
     * @param {number} currentTime 当前时间戳
     * @returns {Promise<Object>} 按用户ID分组的到期计划
     */
    async getDueSchedulesByUser(currentTime = Date.now()) {
        try {
            const dueSchedules = await this.getDueHarvestSchedules(currentTime);

            const schedulesByUser = {};
            for (const schedule of dueSchedules) {
                if (!schedulesByUser[schedule.userId]) {
                    schedulesByUser[schedule.userId] = [];
                }
                schedulesByUser[schedule.userId].push(schedule);
            }

            return schedulesByUser;

        } catch (error) {
            logger.error(`[CropMonitorService] 按用户分组获取到期计划失败: ${error.message}`);
            throw error;
        }
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 生成护理需求（在作物成熟时调用）
     * @param {Object} landUpdate 土地更新对象
     * @param {Object} landData 土地数据
     * @param {number} now 当前时间
     * @private
     */
    _generateCareNeeds(landUpdate, landData, _now) {
        // 基于作物类型和生长时间生成护理需求
        const cropConfig = this.config.crops[landData.crop];
        if (!cropConfig) return;

        const growTime = landData.harvestTime - landData.plantTime;
        const growTimeHours = growTime / (1000 * 60 * 60);

        // 生长时间越长，需要护理的概率越高
        const waterProbability = Math.min(0.2 + (growTimeHours * 0.05), 0.6);
        const pestProbability = Math.min(0.1 + (growTimeHours * 0.03), 0.4);

        if (Math.random() < waterProbability) {
            landUpdate.needsWater = true;
        }

        if (Math.random() < pestProbability) {
            landUpdate.hasPests = true;
        }
    }

    /**
     * 更新护理需求
     * @param {Object} landUpdate 土地更新对象
     * @param {Object} landData 土地数据
     * @param {number} now 当前时间
     * @private
     */
    _updateCareNeeds(landUpdate, landData, now) {
        // 检查是否需要生成新的护理需求
        if (landData.status === 'growing') {
            const timeSincePlant = now - landData.plantTime;
            const totalGrowTime = landData.harvestTime - landData.plantTime;
            const growthProgress = timeSincePlant / totalGrowTime;

            // 在生长过程中随机生成护理需求
            if (growthProgress > 0.3 && !landData.needsWater && Math.random() < 0.12) {
                landUpdate.needsWater = true;
            }

            if (growthProgress > 0.5 && !landData.hasPests && Math.random() < 0.10) {
                landUpdate.hasPests = true;
            }
        }
    }

    /**
     * 检查是否应该枯萎
     * @param {Object} landData 土地数据
     * @param {number} now 当前时间
     * @returns {Object} 枯萎检查结果
     * @private
     */
    _checkWithering(landData, now) {
        // 成熟后超过一定时间未收获会枯萎
        const witherTime = 24 * 60 * 60 * 1000; // 24小时

        if (landData.status === 'mature' && landData.harvestTime) {
            const timeSinceMature = now - landData.harvestTime;
            if (timeSinceMature > witherTime) {
                return { shouldWither: true, reason: 'timeout' };
            }
        }

        // 健康度过低会枯萎
        if ((landData.health || 100) <= 10) {
            return { shouldWither: true, reason: 'low_health' };
        }

        return { shouldWither: false };
    }
}

export default CropMonitorService; 