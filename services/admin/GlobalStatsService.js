// services/StatisticsService.js

import { PlayerYamlStorage } from '../../utils/playerYamlStorage.js';

const CACHE_KEY = 'farm_game:stats:cache';
const CACHE_TTL = 3600; // 1 hour in seconds

class GlobalStatsService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.playerYamlStorage = new PlayerYamlStorage();
  }

  /**
   * 获取经济分析数据，优先从缓存读取
   * @returns {Object} 经济分析数据
   */
  async getEconomyStatus() {
    try {
      const cachedData = await this.redis.get(CACHE_KEY);
      if (cachedData) {
        logger.info('[StatisticsService] 从缓存中获取经济数据。');
        return { ...cachedData, fromCache: true };
      }

      logger.info('[StatisticsService] 缓存未命中，正在重新计算经济数据。');
      return this.rebuildAndCacheStats();
    } catch (error) {
      logger.error(`[StatisticsService] 获取经济数据失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 强制重建并缓存统计数据
   * @returns {Object} 最新的经济分析数据
   */
  async rebuildAndCacheStats() {
    try {
      const stats = await this._calculateEconomyStats();
      await this.redis.set(CACHE_KEY, stats, CACHE_TTL);
      logger.info('[StatisticsService] 经济数据已成功计算并缓存。');
      return { ...stats, fromCache: false };
    } catch (error) {
      logger.error(`[StatisticsService] 重建统计缓存失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 从YAML文件计算经济统计数据
   * @returns {Object} 统计数据
   * @private
   */
  async _calculateEconomyStats() {
    try {
      // 获取所有玩家ID列表
      const playerIds = await this.playerYamlStorage.listAllPlayers();

      if (playerIds.length === 0) {
        return this._getEmptyStats();
      }

      // 批量读取玩家数据
      const playersData = [];
      for (const playerId of playerIds) {
        try {
          const playerData = await this.playerYamlStorage.readPlayer(playerId);
          if (playerData) {
            playersData.push(playerData);
          }
        } catch (error) {
          logger.warn(`[GlobalStatsService] 读取玩家数据失败 [${playerId}]: ${error.message}`);
          // 继续处理其他玩家，不中断统计
        }
      }

      const totalPlayers = playersData.length;
      let totalCoins = 0;
      let totalLandCount = 0;
      const levelDistribution = {};

      for (const player of playersData) {
        if (player.coins !== undefined) {
          totalCoins += parseInt(player.coins, 10) || 0;
        }
        if (player.landCount !== undefined) {
          totalLandCount += parseInt(player.landCount, 10) || 0;
        }
        if (player.level !== undefined) {
          const level = parseInt(player.level, 10) || 1;
          levelDistribution[level] = (levelDistribution[level] || 0) + 1;
        }
      }

      return {
        totalPlayers,
        totalCoins,
        averageCoins: totalPlayers > 0 ? Math.round(totalCoins / totalPlayers) : 0,
        totalLandCount,
        averageLandCount: totalPlayers > 0 ? (totalLandCount / totalPlayers).toFixed(2) : 0,
        levelDistribution,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`[GlobalStatsService] 计算经济统计失败: ${error.message}`);
      return this._getEmptyStats();
    }
  }

  /**
   * 获取空的统计对象
   * @returns {Object} 空统计对象
   * @private
   */
  _getEmptyStats() {
    return {
      totalPlayers: 0,
      totalCoins: 0,
      averageCoins: 0,
      totalLandCount: 0,
      averageLandCount: 0,
      levelDistribution: {},
      updatedAt: new Date().toISOString()
    };
  }
}

export default GlobalStatsService;
