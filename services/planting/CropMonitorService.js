/**
 * @fileoverview 作物监控服务 - 作物状态监控 + 收获调度系统
 *
 * Input:
 * - ./PlantingUtils.js - PlantingUtils (验证工具)
 * - plantingDataService - (依赖注入,种植数据持久化)
 * - landService - (依赖注入,土地服务)
 * - redis - (依赖注入,Redis客户端,ZSet调度)
 *
 * Output:
 * - CropMonitorService (default) - 监控服务类,提供:
 *   - 状态监控:
 *     - updateAllCropsStatus: 更新所有玩家的作物状态(定时任务)
 *     - checkCropStatus: 检查单块土地作物状态
 *     - checkAllCropsStatus: 检查玩家所有作物状态
 *   - 收获调度 (Redis ZSet):
 *     - scheduleHarvest: 注册收获调度
 *     - removeHarvestSchedule: 移除收获调度
 *     - getDueHarvestSchedules: 获取到期调度列表
 *   - 护理调度 (多检查点抽奖模式):
 *     - scheduleCare: 注册护理检查点
 *     - _processCareSchedules: 处理护理调度
 *
 * Pos: 服务层子服务,统一管理作物状态监控和收获调度,合并了 CropStatusService 和 CropScheduleService 功能
 *
 * 调度机制:
 * - 收获调度: Redis ZSet (key: farm_game:schedule:harvest, score: harvestAt timestamp)
 * - 护理调度: 多检查点抽奖模式 (key: farm_game:schedule:care)
 * - 定时任务定期扫描到期任务并执行状态更新
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
        this.scheduleKey = `farm_game:schedule:harvest`;
        // 护理调度键（多检查点抽奖模式）
        this.careScheduleKey = `farm_game:schedule:care`;
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

            // 1. 处理护理调度（多检查点抽奖模式）
            const careResult = await this._processCareSchedules(now);

            // 2. 高效获取所有到期的作物成员
            const dueSchedules = await this.getDueHarvestSchedules(now);

            if (dueSchedules && dueSchedules.length > 0) {
                // 3. 按玩家ID对需要更新的土地进行分组
                const updatesByUser = await this.getDueSchedulesByUser(now);

                // 4. 批量处理每个玩家的更新
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
                    }
                }

                // 5. 从计划中移除已处理的成员
                const dueMembers = dueSchedules.map(schedule => schedule.member);
                await this.batchRemoveHarvestSchedules(dueMembers);
            }

            const hasUpdates = updatedLandsCount > 0 || careResult.triggeredCount > 0;
            if (hasUpdates) {
                logger.info(`[CropMonitorService] 更新了${updatedPlayersCount}个玩家的${updatedLandsCount}块土地状态，触发${careResult.triggeredCount}个护理事件`);
            }

            return {
                success: true,
                updatedPlayers: updatedPlayersCount,
                updatedLands: updatedLandsCount,
                processedSchedules: dueSchedules?.length || 0,
                careEvents: careResult
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
                needsCare: 0,
                crops: []
            };

            for (const land of allLands.lands) {
                if (!land.crop || land.status === 'empty') {
                    statusInfo.empty++;
                    // 将空地信息也加入crops数组，确保数据一致性
                    const cropInfo = {
                        landId: land.id,
                        cropType: null,
                        cropName: null,
                        status: 'empty',
                        needsWater: false,
                        hasPests: false,
                        plantTime: null,
                        harvestTime: null,
                        stealable: false,
                        remainingTime: 0,
                        isReady: false
                    };
                    statusInfo.crops.push(cropInfo);
                    continue;
                }

                const cropConfig = cropsConfig[land.crop];
                const cropInfo = {
                    landId: land.id,
                    cropType: land.crop,
                    cropName: cropConfig?.name || land.crop,
                    status: land.status,
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
                if (typeof statusInfo[land.status] === 'number') {
                    statusInfo[land.status]++;
                }

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

            // ZADD 会自动更新已存在成员的分数，返回值为新增成员数（更新时返回0也是成功的）
            await this.redis.client.zAdd(this.scheduleKey, {
                score: newHarvestTime,
                value: scheduleMember
            });

            logger.debug(`[CropMonitorService] 更新收获计划: ${scheduleMember} to ${newHarvestTime}`);
            return true;

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

            // 验证参数类型
            if (!Array.isArray(members)) {
                throw new Error('members must be an array');
            }

            // 确保所有成员都是字符串
            const validMembers = members.map(member =>
                typeof member === 'string' ? member : String(member)
            );

            const result = await this.redis.client.zRem(this.scheduleKey, validMembers);

            logger.debug(`[CropMonitorService] 批量移除收获计划: ${validMembers.length} 个，实际移除: ${result} 个`);
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
     * 处理护理调度（多检查点抽奖模式）
     * @param {number} now 当前时间戳
     * @returns {Object} 处理结果
     * @private
     */
    async _processCareSchedules(now) {
        const result = { processedCount: 0, triggeredCount: 0, penalties: [] };

        try {
            const careConfig = this.config.items?.care || {};

            // 使用原子操作逐个弹出并处理到期的护理检查点，避免并发重复处理
            let processedInBatch = 0;
            const maxBatchSize = 100; // 防止单次处理过多

            while (processedInBatch < maxBatchSize) {
                // 原子弹出一个最早到期的成员
                const popped = await this.redis.client.zPopMin(this.careScheduleKey);
                if (!popped || popped.length === 0) {
                    break; // 没有更多到期成员
                }

                const { value: member, score } = popped[0];

                // 检查是否真的到期
                if (score > now) {
                    // 未到期，放回去
                    await this.redis.client.zAdd(this.careScheduleKey, {
                        score: score,
                        value: member
                    });
                    break;
                }

                // 解析成员信息: userId:landId:careType:checkpointIndex
                const parts = member.split(':');
                if (parts.length !== 4) {
                    logger.warn(`[CropMonitorService] 无效的护理调度成员格式: ${member}`);
                    continue;
                }

                const schedule = {
                    userId: parts[0],
                    landId: parseInt(parts[1], 10),
                    careType: parts[2],
                    checkpointIndex: parseInt(parts[3], 10),
                    member: member
                };

                processedInBatch++;

                // 处理单个护理事件（在锁内执行）
                try {
                    await this.redis.withLock(schedule.userId, async () => {
                        result.processedCount++;
                        const triggerResult = await this._processSingleCareEvent(
                            schedule.userId, schedule, careConfig, now
                        );
                        if (triggerResult.triggered) {
                            result.triggeredCount++;
                            if (triggerResult.penalty) {
                                result.penalties.push(triggerResult.penalty);
                            }
                        }
                    }, 'processCare');
                } catch (error) {
                    logger.error(`[CropMonitorService] 处理护理事件失败 [${schedule.userId}][${schedule.landId}]: ${error.message}`);
                    // 处理失败，将成员重新加入调度（延迟5秒后重试）
                    await this.redis.client.zAdd(this.careScheduleKey, {
                        score: now + 5000,
                        value: member
                    });
                }
            }

            return result;
        } catch (error) {
            logger.error(`[CropMonitorService] 处理护理调度失败: ${error.message}`);
            return result;
        }
    }

    /**
     * 处理单个护理事件
     * @private
     */
    async _processSingleCareEvent(userId, schedule, careConfig, now) {
        const { landId, careType } = schedule;
        const result = { triggered: false, penalty: null };

        try {
            const landData = await this.landService.getLandById(userId, landId);
            if (!landData || landData.status !== 'growing') {
                return result;
            }

            // 获取对应护理类型的配置
            const typeConfig = careConfig[careType];
            if (!typeConfig) {
                return result;
            }

            // 幂等性检查：如果土地已经有该护理需求，跳过（避免惩罚叠加）
            if (careType === 'water' && landData.needsWater) {
                logger.debug(`[CropMonitorService] 土地已缺水，跳过重复触发 [${userId}][${landId}]`);
                return result;
            }
            if (careType === 'pest' && landData.hasPests) {
                logger.debug(`[CropMonitorService] 土地已有虫害，跳过重复触发 [${userId}][${landId}]`);
                return result;
            }

            // 抽奖判定
            const probability = typeConfig.probability || 0.4;
            if (Math.random() >= probability) {
                return result; // 未中奖，检查点消耗但不触发
            }

            // 中奖！触发护理需求
            result.triggered = true;
            const landUpdates = {};

            if (careType === 'water') {
                landUpdates.needsWater = true;
                landUpdates.waterNeededAt = now;

                // 立即应用缺水惩罚：延缓生长时间
                const penalty = typeConfig.penalty;
                if (penalty?.type === 'growthDelay' && !landData.waterDelayApplied) {
                    const remainingTime = landData.harvestTime - now;
                    if (remainingTime > 0) {
                        const delayPercent = penalty.delayPercent || 15;
                        const delayTime = Math.floor(remainingTime * (delayPercent / 100));
                        landUpdates.harvestTime = landData.harvestTime + delayTime;
                        landUpdates.waterDelayApplied = true;
                        landUpdates.waterDelayMs = delayTime;
                        result.penalty = { type: 'growthDelay', delayTime };

                        // 同步更新收获调度
                        await this.updateHarvestSchedule(userId, landId, landUpdates.harvestTime);
                    }
                }
            } else if (careType === 'pest') {
                landUpdates.hasPests = true;
                landUpdates.pestAppearedAt = now;
                // 虫害惩罚在收获时应用（产量减少）
            }

            await this.plantingDataService.updateLandCropData(userId, landId, landUpdates);
            logger.debug(`[CropMonitorService] 触发护理需求 [${userId}][${landId}]: ${careType}${result.penalty ? `, 惩罚: ${JSON.stringify(result.penalty)}` : ''}`);

            return result;
        } catch (error) {
            logger.error(`[CropMonitorService] 处理护理事件失败 [${userId}][${landId}]: ${error.message}`);
            throw error; // 抛出异常，让外层 retry 机制生效
        }
    }

    /**
     * 应用护理惩罚（缺水延缓生长）
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @returns {Object} 惩罚结果
     */
    async applyCareDelayPenalty(userId, landId) {
        try {
            const landData = await this.landService.getLandById(userId, landId);
            if (!landData || landData.status !== 'growing' || !landData.needsWater) {
                return { success: false, message: '不需要应用惩罚' };
            }

            const careConfig = this.config.items?.care?.water?.penalty;
            if (!careConfig || careConfig.type !== 'growthDelay') {
                return { success: false, message: '未配置延缓惩罚' };
            }

            const now = Date.now();
            const remainingTime = landData.harvestTime - now;
            if (remainingTime <= 0) {
                return { success: false, message: '作物已成熟' };
            }

            // 计算延缓时间
            const delayPercent = careConfig.delayPercent || 15;
            const delayTime = Math.floor(remainingTime * (delayPercent / 100));
            const newHarvestTime = landData.harvestTime + delayTime;

            // 更新收获时间
            await this.plantingDataService.updateLandCropData(userId, landId, {
                harvestTime: newHarvestTime,
                waterDelayApplied: true,
                waterDelayMs: delayTime
            });

            // 同步更新收获调度
            await this.updateHarvestSchedule(userId, landId, newHarvestTime);

            logger.debug(`[CropMonitorService] 应用缺水惩罚 [${userId}][${landId}]: 延缓${Math.floor(delayTime / 1000)}秒`);

            return {
                success: true,
                delayTime,
                newHarvestTime
            };
        } catch (error) {
            logger.error(`[CropMonitorService] 应用护理惩罚失败 [${userId}][${landId}]: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    // ==================== 护理调度管理 ====================

    /**
     * 添加护理检查点调度
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @param {string} careType 护理类型 ('water' | 'pest')
     * @param {number} checkpointIndex 检查点索引
     * @param {number} triggerTime 触发时间戳
     */
    async addCareSchedule(userId, landId, careType, checkpointIndex, triggerTime) {
        try {
            // member 格式: userId:landId:careType:checkpointIndex
            const scheduleMember = `${userId}:${landId}:${careType}:${checkpointIndex}`;
            await this.redis.client.zAdd(this.careScheduleKey, {
                score: triggerTime,
                value: scheduleMember
            });

            logger.debug(`[CropMonitorService] 添加护理调度: ${scheduleMember} at ${triggerTime}`);
            return true;
        } catch (error) {
            logger.error(`[CropMonitorService] 添加护理调度失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 批量添加护理检查点（种植时调用）
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @param {number} plantTime 种植时间
     * @param {number} harvestTime 收获时间
     */
    async addCareSchedulesForCrop(userId, landId, plantTime, harvestTime) {
        try {
            const careConfig = this.config.items?.care;
            if (!careConfig) {
                return { success: false, message: '未配置护理系统' };
            }

            const growthDuration = harvestTime - plantTime;
            const schedules = [];

            // 添加浇水检查点
            if (careConfig.water?.checkpoints) {
                for (let i = 0; i < careConfig.water.checkpoints.length; i++) {
                    const progress = careConfig.water.checkpoints[i];
                    const triggerTime = plantTime + Math.floor(growthDuration * progress);
                    await this.addCareSchedule(userId, landId, 'water', i, triggerTime);
                    schedules.push({ type: 'water', index: i, time: triggerTime });
                }
            }

            // 添加虫害检查点
            if (careConfig.pest?.checkpoints) {
                for (let i = 0; i < careConfig.pest.checkpoints.length; i++) {
                    const progress = careConfig.pest.checkpoints[i];
                    const triggerTime = plantTime + Math.floor(growthDuration * progress);
                    await this.addCareSchedule(userId, landId, 'pest', i, triggerTime);
                    schedules.push({ type: 'pest', index: i, time: triggerTime });
                }
            }

            logger.debug(`[CropMonitorService] 为作物添加${schedules.length}个护理检查点 [${userId}][${landId}]`);
            return { success: true, schedules };
        } catch (error) {
            logger.error(`[CropMonitorService] 批量添加护理调度失败: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 获取到期的护理调度数量（用于空闲轮询优化）
     * @param {number} currentTime 当前时间戳
     * @returns {Promise<number>} 到期的护理调度数量
     */
    async getPendingCareScheduleCount(currentTime = Date.now()) {
        try {
            return await this.redis.client.zCount(this.careScheduleKey, 0, currentTime);
        } catch (error) {
            logger.error(`[CropMonitorService] 获取护理调度数量失败: ${error.message}`);
            return 0;
        }
    }

    /**
     * 获取到期的护理调度
     * @param {number} currentTime 当前时间戳
     * @returns {Promise<Array>} 到期的护理调度列表
     */
    async getDueCareSchedules(currentTime = Date.now()) {
        try {
            const dueMembers = await this.redis.client.zRange(this.careScheduleKey, 0, currentTime, {
                BY: 'SCORE'
            });

            if (!dueMembers || dueMembers.length === 0) {
                return [];
            }

            // 解析成员信息: userId:landId:careType:checkpointIndex
            const schedules = dueMembers.map(member => {
                const parts = member.split(':');
                return {
                    userId: parts[0],
                    landId: parseInt(parts[1], 10),
                    careType: parts[2],
                    checkpointIndex: parseInt(parts[3], 10),
                    member: member
                };
            });

            return schedules;
        } catch (error) {
            logger.error(`[CropMonitorService] 获取到期护理调度失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 移除指定土地的所有护理调度（收获/铲除时调用）
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     */
    async removeCareSchedulesForLand(userId, landId) {
        try {
            // 获取所有调度并过滤
            const allMembers = await this.redis.client.zRange(this.careScheduleKey, 0, -1);
            const prefix = `${userId}:${landId}:`;
            const toRemove = allMembers.filter(m => m.startsWith(prefix));

            if (toRemove.length > 0) {
                await this.redis.client.zRem(this.careScheduleKey, toRemove);
                logger.debug(`[CropMonitorService] 移除护理调度 [${userId}][${landId}]: ${toRemove.length}个`);
            }

            return { success: true, removed: toRemove.length };
        } catch (error) {
            logger.error(`[CropMonitorService] 移除护理调度失败: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 更新护理需求（保留兼容性，但不再由定时任务调用）
     * @deprecated 使用多检查点调度模式替代
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

}

export default CropMonitorService; 
