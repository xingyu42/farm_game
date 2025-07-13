/**
 * 作物调度管理专门服务
 * 专门处理作物收获计划的管理，包括添加、移除、查询收获计划等
 */

class CropScheduleService {
  constructor(redis, logger = null) {
    this.redis = redis;
    this.logger = logger || console;
    
    // Redis ZSet 键名
    this.scheduleKey = this.redis.generateKey('schedule', 'harvest');
  }

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
      
      this.logger.debug(`[CropScheduleService] 添加收获计划: ${scheduleMember} at ${harvestTime}`);
      return result > 0;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 添加收获计划失败 [${userId}:${landId}]: ${error.message}`);
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
      
      this.logger.debug(`[CropScheduleService] 移除收获计划: ${scheduleMember}`);
      return result > 0;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 移除收获计划失败 [${userId}:${landId}]: ${error.message}`);
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
      
      this.logger.debug(`[CropScheduleService] 更新收获计划: ${scheduleMember} to ${newHarvestTime}`);
      return result > 0;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 更新收获计划失败 [${userId}:${landId}]: ${error.message}`);
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

      this.logger.debug(`[CropScheduleService] 获取到期收获计划: ${schedules.length} 个`);
      return schedules;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 获取到期收获计划失败: ${error.message}`);
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
      
      this.logger.debug(`[CropScheduleService] 批量移除收获计划: ${members.length} 个，实际移除: ${result} 个`);
      return result;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 批量移除收获计划失败: ${error.message}`);
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

      this.logger.debug(`[CropScheduleService] 获取用户收获计划 [${userId}]: ${userSchedules.length} 个`);
      return userSchedules;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 获取用户收获计划失败 [${userId}]: ${error.message}`);
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

      this.logger.debug(`[CropScheduleService] 收获计划统计: ${JSON.stringify(statistics)}`);
      return statistics;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 获取收获计划统计失败: ${error.message}`);
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
      
      this.logger.info(`[CropScheduleService] 清理过期收获计划: ${result} 个`);
      return result;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 清理过期收获计划失败: ${error.message}`);
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
      this.logger.error(`[CropScheduleService] 检查收获计划失败 [${userId}:${landId}]: ${error.message}`);
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
      this.logger.error(`[CropScheduleService] 获取收获时间失败 [${userId}:${landId}]: ${error.message}`);
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
        schedulesByUser[schedule.userId].push(schedule.landId);
      }

      return schedulesByUser;
      
    } catch (error) {
      this.logger.error(`[CropScheduleService] 按用户分组获取到期计划失败: ${error.message}`);
      throw error;
    }
  }
}

export { CropScheduleService };
