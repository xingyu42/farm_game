// services/AdminService.js

class AdminService {
  constructor(redisClient, config, playerService) {
    this.redis = redisClient;
    this.config = config;
    this.playerService = playerService;
  }

  /**
   * 重置玩家数据
   * @param {string} targetId 目标玩家ID
   * @returns {Object} 操作结果
   */
  async resetPlayer(targetId) {
    try {
      const success = await this.playerService.deletePlayer(targetId);
      if (success) {
        logger.info(`[AdminService] 成功重置玩家 [${targetId}]`);
        return { success: true, message: `玩家 ${targetId} 的数据已重置。` };
      } else {
        return { success: false, message: '重置失败，可能玩家数据已不存在。' };
      }
    } catch (error) {
      logger.error(`[AdminService] 重置玩家失败 [${targetId}]: ${error.message}`);
      return { success: false, message: `重置玩家失败: ${error.message}` };
    }
  }

  /**
   * 为玩家添加金币
   * @param {string} targetId 目标玩家ID
   * @param {number} amount 金币数量
   * @returns {Object} 操作结果
   */
  async addCoins(targetId, amount) {
    if (isNaN(amount) || amount <= 0) {
      return { success: false, message: '请输入一个有效的正数数量。' };
    }

    try {
      // 检查玩家是否存在（不自动创建）
      const player = await this.playerService.getDataService().getPlayerFromHash(targetId);
      if (!player) {
        return { success: false, message: '未找到该玩家。' };
      }

      // 使用PlayerManagerService的安全接口（内置事务保护）
      const updatedPlayer = await this.playerService.addCoins(targetId, amount);

      logger.info(`[AdminService] 为玩家 [${targetId}] 添加了 ${amount} 金币`);
      return {
        success: true,
        message: `成功为玩家 ${targetId} 添加了 ${amount} 金币，当前总计: ${updatedPlayer.coins}`
      };
    } catch (error) {
      logger.error(`[AdminService] 添加金币失败 [${targetId}]: ${error.message}`);
      return { success: false, message: `添加金币失败: ${error.message}` };
    }
  }

  /**
   * 为玩家添加经验
   * @param {string} targetId 目标玩家ID
   * @param {number} amount 经验数量
   * @returns {Object} 操作结果
   */
  async addExperience(targetId, amount) {
    if (isNaN(amount) || amount <= 0) {
      return { success: false, message: '请输入一个有效的正数数量。' };
    }

    try {
      // 检查玩家是否存在（不自动创建）
      const player = await this.playerService.getDataService().getPlayerFromHash(targetId);
      if (!player) {
        return { success: false, message: '未找到该玩家。' };
      }

      // 使用PlayerManagerService的安全接口（内置事务保护）
      const result = await this.playerService.addExp(targetId, amount);
      const updatedPlayer = result.player;
      const levelUpInfo = result.levelUp;

      logger.info(`[AdminService] 为玩家 [${targetId}] 添加了 ${amount} 经验`);

      let message = `成功为玩家 ${targetId} 添加了 ${amount} 经验，当前总计: ${updatedPlayer.experience}。`;
      if (levelUpInfo && levelUpInfo.didLevelUp) {
        message += `\n恭喜玩家升级到 Lv.${levelUpInfo.newLevel}!`;
      }

      return { success: true, message };
    } catch (error) {
      logger.error(`[AdminService] 添加经验失败 [${targetId}]: ${error.message}`);
      return { success: false, message: `添加经验失败: ${error.message}` };
    }
  }

  /**
   * 设置土地品质
   * @param {string} targetId 目标玩家ID
   * @param {number} landId 土地ID
   * @param {string} quality 品质
   * @returns {Object} 操作结果
   */
  async setLandQuality(targetId, landId, quality) {
    const validQualities = Object.keys(this.config.land.quality);
    if (!validQualities.includes(quality)) {
      return { success: false, message: `无效的品质。有效品质为: ${validQualities.join(', ')}` };
    }
    try {
      const validation = await this.playerService.validateLandId(targetId, landId);
      if (!validation.valid) {
        return { success: false, message: validation.message };
      }

      const player = await this.playerService.getDataService().getPlayerFromHash(targetId);
      if (!player) {
        return { success: false, message: '未找到该玩家。' };
      }

      player.lands[landId - 1].quality = quality;
      await this.playerService.getDataService().savePlayerToHash(targetId, player);

      logger.info(`[AdminService] 将玩家 [${targetId}] 的土地 ${landId} 品质设置为 ${quality}`);
      return { success: true, message: `已将玩家 ${targetId} 的土地 ${landId} 品质设置为 ${quality}。` };
    } catch (error) {
      logger.error(`[AdminService] 设置土地品质失败 [${targetId}, ${landId}]: ${error.message}`);
      return { success: false, message: `设置土地品质失败: ${error.message}` };
    }
  }

  /**
   * 重载配置文件
   * @returns {Object} 操作结果
   */
  async reloadConfigs() {
    // This typically needs to be handled at a higher level, 
    // where the config object is initially loaded and passed to services.
    // For now, we simulate this by logging.
    logger.info('[AdminService] 请求重载配置文件。实际操作需在主插件逻辑中实现。');
    return { success: true, message: '已发送重载配置请求。' };
  }
}

export default AdminService;