// services/StatisticsService.js

const CACHE_KEY = 'farm:stats:cache';
const CACHE_TTL = 3600; // 1 hour in seconds

class GlobalStatsService {
  constructor(redisClient, logger = null) {
    this.redis = redisClient;
    this.logger = logger || console;
  }

  /**
   * 获取经济分析数据，优先从缓存读取
   * @returns {Object} 经济分析数据
   */
  async getEconomyStatus() {
    try {
      const cachedData = await this.redis.get(CACHE_KEY);
      if (cachedData) {
        this.logger.info('[StatisticsService] 从缓存中获取经济数据。');
        return { ...JSON.parse(cachedData), fromCache: true };
      }
      
      this.logger.info('[StatisticsService] 缓存未命中，正在重新计算经济数据。');
      return this.rebuildAndCacheStats();
    } catch (error) {
      this.logger.error(`[StatisticsService] 获取经济数据失败: ${error.message}`);
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
      await this.redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(stats));
      this.logger.info('[StatisticsService] 经济数据已成功计算并缓存。');
      return { ...stats, fromCache: false };
    } catch (error) {
      this.logger.error(`[StatisticsService] 重建统计缓存失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 使用 SCAN 命令计算经济统计数据
   * @returns {Object} 统计数据
   * @private
   */
  async _calculateEconomyStats() {
    let cursor = '0';
    const playerKeys = [];
    const pattern = 'farm:player:*';

    do {
      const reply = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = reply[0];
      playerKeys.push(...reply[1]);
    } while (cursor !== '0');

    if (playerKeys.length === 0) {
      return this._getEmptyStats();
    }

    const playersData = await Promise.all(playerKeys.map(key => this.redis.hgetall(key)));

    const totalPlayers = playersData.length;
    let totalCoins = 0;
    let totalLandCount = 0;
    const levelDistribution = {};

    for (const player of playersData) {
      if (player.coins) {
        totalCoins += parseInt(player.coins, 10) || 0;
      }
      if (player.landCount) {
        totalLandCount += parseInt(player.landCount, 10) || 0;
      }
      if (player.level) {
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
