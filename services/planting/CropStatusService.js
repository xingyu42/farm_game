/**
 * 作物状态更新专门服务
 * 专门处理作物状态的批量更新，包括成熟度检查、护理需求更新等定时任务逻辑
 */

import { PlantingValidator } from './validators/PlantingValidator.js';

class CropStatusService {
  constructor(playerDataService, cropScheduleService, redis, config, logger = null) {
    this.playerDataService = playerDataService;
    this.cropScheduleService = cropScheduleService;
    this.redis = redis;
    this.config = config;
    this.logger = logger || console;
    
    // 初始化依赖组件
    this.validator = new PlantingValidator(config, logger);
  }

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
      const dueSchedules = await this.cropScheduleService.getDueHarvestSchedules(now);

      if (!dueSchedules || dueSchedules.length === 0) {
        this.logger.info('[CropStatusService] 没有需要更新的作物状态');
        return { success: true, updatedPlayers: 0, updatedLands: 0 };
      }

      // 2. 按玩家ID对需要更新的土地进行分组
      const updatesByUser = await this.cropScheduleService.getDueSchedulesByUser(now);

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
          this.logger.error(`[CropStatusService] 更新玩家${userId}作物状态失败: ${error.message}`);
          // 继续处理其他玩家，不因单个玩家失败而中断整个批量更新
        }
      }

      // 4. 从计划中移除已处理的成员
      if (dueSchedules.length > 0) {
        const dueMembers = dueSchedules.map(schedule => schedule.member);
        await this.cropScheduleService.batchRemoveHarvestSchedules(dueMembers);
      }

      this.logger.info(`[CropStatusService] 更新了${updatedPlayersCount}个玩家的${updatedLandsCount}块土地状态`);
      
      return {
        success: true,
        updatedPlayers: updatedPlayersCount,
        updatedLands: updatedLandsCount,
        processedSchedules: dueSchedules.length
      };

    } catch (error) {
      this.logger.error(`[CropStatusService] 更新作物状态失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 更新指定玩家的作物状态
   * @param {string} userId 用户ID
   * @param {Array} landIds 土地编号数组（可选，为空时更新所有土地）
   * @returns {Object} 更新结果
   */
  async updatePlayerCropsStatus(userId, landIds = null) {
    try {
      return await this.redis.withLock(userId, async () => {
        const now = Date.now();
        return await this._updatePlayerCropsStatus(userId, landIds, now);
      }, 'updateCrops');

    } catch (error) {
      this.logger.error(`[CropStatusService] 更新玩家${userId}作物状态失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 内部方法：更新玩家作物状态（在锁保护下执行）
   * @param {string} userId 用户ID
   * @param {Array} landIds 土地编号数组
   * @param {number} currentTime 当前时间戳
   * @returns {Object} 更新结果
   * @private
   */
  async _updatePlayerCropsStatus(userId, landIds, currentTime) {
    const playerData = await this.playerDataService.getPlayerFromHash(userId);
    
    if (!playerData || !playerData.lands) {
      return { hasUpdates: false, updatedLandsCount: 0 };
    }

    let hasUpdates = false;
    let updatedLandsCount = 0;
    const landIdsToUpdate = landIds || this._getAllLandIds(playerData.lands);

    for (const landId of landIdsToUpdate) {
      const landIndex = landId - 1;
      if (landIndex < 0 || landIndex >= playerData.lands.length) {
        continue;
      }
      
      const land = playerData.lands[landIndex];
      if (land.crop && land.status === 'growing') {
        const updateResult = this._updateSingleLandStatus(land, currentTime);
        if (updateResult.updated) {
          hasUpdates = true;
          updatedLandsCount++;
        }
      }
    }

    // 保存更新后的玩家数据
    if (hasUpdates) {
      await this.playerDataService.savePlayerToHash(userId, playerData);
    }

    return { hasUpdates, updatedLandsCount };
  }

  /**
   * 更新单块土地的状态
   * @param {Object} land 土地对象
   * @param {number} currentTime 当前时间戳
   * @returns {Object} 更新结果
   * @private
   */
  _updateSingleLandStatus(land, currentTime) {
    let landUpdated = false;

    // 检查是否成熟
    if (currentTime >= land.harvestTime) {
      land.status = 'mature';
      land.stealable = true;
      landUpdated = true;
    }

    // 检查护理需求
    if (land.waterNeededTime && currentTime >= land.waterNeededTime && !land.needsWater) {
      land.needsWater = true;
      land.health = Math.max(50, land.health - 20); // 缺水降低健康度
      landUpdated = true;
    }

    if (land.pestAppearTime && currentTime >= land.pestAppearTime && !land.hasPests) {
      land.hasPests = true;
      land.health = Math.max(30, land.health - 25); // 虫害降低健康度
      landUpdated = true;
    }

    return { updated: landUpdated };
  }

  /**
   * 获取所有土地编号
   * @param {Array} lands 土地数组
   * @returns {Array} 土地编号数组
   * @private
   */
  _getAllLandIds(lands) {
    return lands.map((_, index) => index + 1);
  }

  /**
   * 检查指定玩家是否有需要更新的作物
   * @param {string} userId 用户ID
   * @returns {Object} 检查结果
   */
  async checkPlayerCropsNeedUpdate(userId) {
    try {
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      
      if (!playerData || !playerData.lands) {
        return { needsUpdate: false, details: [] };
      }

      const now = Date.now();
      const updateDetails = [];

      for (let landIndex = 0; landIndex < playerData.lands.length; landIndex++) {
        const land = playerData.lands[landIndex];
        const landId = landIndex + 1;
        
        if (land.crop && land.status === 'growing') {
          const details = this._checkSingleLandUpdateNeeds(land, now, landId);
          if (details.needsUpdate) {
            updateDetails.push(details);
          }
        }
      }

      return {
        needsUpdate: updateDetails.length > 0,
        details: updateDetails,
        totalLands: updateDetails.length
      };

    } catch (error) {
      this.logger.error(`[CropStatusService] 检查玩家${userId}作物更新需求失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查单块土地的更新需求
   * @param {Object} land 土地对象
   * @param {number} currentTime 当前时间戳
   * @param {number} landId 土地编号
   * @returns {Object} 检查结果
   * @private
   */
  _checkSingleLandUpdateNeeds(land, currentTime, landId) {
    const updateReasons = [];

    // 检查是否成熟
    if (currentTime >= land.harvestTime) {
      updateReasons.push('作物已成熟');
    }

    // 检查护理需求
    if (land.waterNeededTime && currentTime >= land.waterNeededTime && !land.needsWater) {
      updateReasons.push('需要浇水');
    }

    if (land.pestAppearTime && currentTime >= land.pestAppearTime && !land.hasPests) {
      updateReasons.push('出现虫害');
    }

    return {
      landId: landId,
      needsUpdate: updateReasons.length > 0,
      reasons: updateReasons,
      cropType: land.crop,
      currentStatus: land.status
    };
  }

  /**
   * 获取作物状态更新统计信息
   * @returns {Object} 统计信息
   */
  async getUpdateStatistics() {
    try {
      // 获取调度统计信息
      const scheduleStats = await this.cropScheduleService.getScheduleStatistics();
      
      const now = Date.now();
      const statistics = {
        totalScheduledCrops: scheduleStats.totalSchedules,
        dueForUpdate: scheduleStats.dueSchedules,
        soonDueForUpdate: scheduleStats.soonDueSchedules,
        pendingSchedules: scheduleStats.pendingSchedules,
        lastUpdateTime: now,
        systemStatus: 'active'
      };

      this.logger.debug(`[CropStatusService] 状态更新统计: ${JSON.stringify(statistics)}`);
      return statistics;

    } catch (error) {
      this.logger.error(`[CropStatusService] 获取更新统计失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 强制更新指定土地的状态（用于调试和维护）
   * @param {string} userId 用户ID
   * @param {number} landId 土地编号
   * @returns {Object} 更新结果
   */
  async forceUpdateLandStatus(userId, landId) {
    try {
      return await this.redis.withLock(userId, async () => {
        const playerData = await this.playerDataService.getPlayerFromHash(userId);
        
        if (!playerData || !playerData.lands) {
          throw new Error('玩家数据不存在');
        }

        const landIndex = landId - 1;
        if (landIndex < 0 || landIndex >= playerData.lands.length) {
          throw new Error(`土地编号${landId}不存在`);
        }

        const land = playerData.lands[landIndex];
        if (!land.crop || land.status === 'empty') {
          throw new Error(`第${landId}块土地没有种植作物`);
        }

        const now = Date.now();
        const updateResult = this._updateSingleLandStatus(land, now);
        
        if (updateResult.updated) {
          await this.playerDataService.savePlayerToHash(userId, playerData);
          this.logger.info(`[CropStatusService] 强制更新了用户${userId}第${landId}块土地的状态`);
        }

        return {
          success: true,
          updated: updateResult.updated,
          landId: landId,
          newStatus: land.status,
          health: land.health,
          needsWater: land.needsWater,
          hasPests: land.hasPests
        };
      }, 'forceUpdate');

    } catch (error) {
      this.logger.error(`[CropStatusService] 强制更新土地状态失败 [${userId}:${landId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 清理过期的状态更新记录（维护任务）
   * @returns {Object} 清理结果
   */
  async cleanupExpiredStatusRecords() {
    try {
      // 清理过期的收获计划
      const cleanupResult = await this.cropScheduleService.cleanupExpiredSchedules();
      
      this.logger.info(`[CropStatusService] 清理了${cleanupResult}个过期的状态记录`);
      
      return {
        success: true,
        cleanedRecords: cleanupResult
      };

    } catch (error) {
      this.logger.error(`[CropStatusService] 清理过期状态记录失败: ${error.message}`);
      throw error;
    }
  }
}

export { CropStatusService };
