/**
 * 玩家数据持久化服务
 * 负责Redis Hash操作、数据序列化/反序列化等底层数据操作
 */

import PlayerSerializer from './utils/PlayerSerializer.js';

class PlayerDataService {
  constructor(redisClient, config, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.logger = logger || console;
    this.serializer = new PlayerSerializer(config);
  }

  /**
   * 从Redis Hash读取玩家数据
   * @param {string} userId 用户ID
   * @returns {Player|null} Player实例或null
   */
  async getPlayerFromHash(userId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      // 检查Hash是否存在
      const exists = await this.redis.exists(playerKey);
      if (!exists) {
        return null;
      }

      // 获取所有Hash字段
      const hashData = await this.redis.client.hGetAll(playerKey);

      if (!hashData || Object.keys(hashData).length === 0) {
        return null;
      }

      // 使用序列化器反序列化数据
      return this.serializer.deserializeFromHash(hashData);
    } catch (error) {
      this.logger.error(`[PlayerDataService] 从Hash读取玩家数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 将玩家数据保存到Redis Hash
   * @param {string} userId 用户ID
   * @param {Object|Player} playerData 玩家数据或Player实例
   */
  async savePlayerToHash(userId, playerData) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      // 使用序列化器序列化数据
      const hashData = this.serializer.serializeForHash(playerData);

      // 使用HMSET设置所有字段
      await this.redis.client.hSet(playerKey, hashData);

    } catch (error) {
      this.logger.error(`[PlayerDataService] 保存玩家数据到Hash失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 高效更新单个简单字段
   * @param {string} userId 用户ID
   * @param {string} field 字段名
   * @param {any} value 新值
   */
  async updateSimpleField(userId, field, value) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      await this.redis.client.hSet(playerKey, field, value.toString());
    } catch (error) {
      this.logger.error(`[PlayerDataService] 更新简单字段失败 [${userId}][${field}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 高效更新多个简单字段
   * @param {string} userId 用户ID
   * @param {Object} fieldUpdates 字段更新映射
   */
  async updateSimpleFields(userId, fieldUpdates) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const hashUpdates = {};
      
      for (const [field, value] of Object.entries(fieldUpdates)) {
        if (this.serializer.simpleFields.includes(field)) {
          hashUpdates[field] = value.toString();
        }
      }
      
      if (Object.keys(hashUpdates).length > 0) {
        await this.redis.client.hSet(playerKey, hashUpdates);
      }
    } catch (error) {
      this.logger.error(`[PlayerDataService] 批量更新简单字段失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 更新复杂字段（JSON序列化）
   * @param {string} userId 用户ID
   * @param {string} field 字段名
   * @param {any} value 新值
   */
  async updateComplexField(userId, field, value) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const serializedValue = JSON.stringify(value);
      await this.redis.client.hSet(playerKey, field, serializedValue);
    } catch (error) {
      this.logger.error(`[PlayerDataService] 更新复杂字段失败 [${userId}][${field}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量更新复杂字段
   * @param {string} userId 用户ID
   * @param {Object} fieldUpdates 字段更新映射
   */
  async updateComplexFields(userId, fieldUpdates) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const hashUpdates = {};
      
      for (const [field, value] of Object.entries(fieldUpdates)) {
        if (this.serializer.complexFields.includes(field)) {
          hashUpdates[field] = JSON.stringify(value);
        }
      }
      
      if (Object.keys(hashUpdates).length > 0) {
        await this.redis.client.hSet(playerKey, hashUpdates);
      }
    } catch (error) {
      this.logger.error(`[PlayerDataService] 批量更新复杂字段失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 混合更新（同时更新简单字段和复杂字段）
   * @param {string} userId 用户ID
   * @param {Object} simpleUpdates 简单字段更新
   * @param {Object} complexUpdates 复杂字段更新
   */
  async updateMixedFields(userId, simpleUpdates = {}, complexUpdates = {}) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const hashUpdates = {};
      
      // 处理简单字段
      for (const [field, value] of Object.entries(simpleUpdates)) {
        if (this.serializer.simpleFields.includes(field)) {
          hashUpdates[field] = value.toString();
        }
      }
      
      // 处理复杂字段
      for (const [field, value] of Object.entries(complexUpdates)) {
        if (this.serializer.complexFields.includes(field)) {
          hashUpdates[field] = JSON.stringify(value);
        }
      }
      
      if (Object.keys(hashUpdates).length > 0) {
        await this.redis.client.hSet(playerKey, hashUpdates);
      }
    } catch (error) {
      this.logger.error(`[PlayerDataService] 混合更新字段失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查玩家是否存在
   * @param {string} userId 用户ID
   * @returns {boolean} 是否存在
   */
  async playerExists(userId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      return await this.redis.exists(playerKey);
    } catch (error) {
      this.logger.error(`[PlayerDataService] 检查玩家存在失败 [${userId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * 删除玩家数据
   * @param {string} userId 用户ID
   */
  async deletePlayer(userId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      await this.redis.client.del(playerKey);
      this.logger.info(`[PlayerDataService] 删除玩家数据: ${userId}`);
    } catch (error) {
      this.logger.error(`[PlayerDataService] 删除玩家数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 创建新玩家数据
   * @param {string} name 玩家名称
   * @returns {Player} Player实例
   */
  createNewPlayerData(name = '') {
    return this.serializer.createNewPlayerData(name);
  }

  /**
   * 验证玩家数据
   * @param {Object} playerData 玩家数据
   * @returns {Object} 验证结果
   */
  validatePlayerData(playerData) {
    return this.serializer.validatePlayerData(playerData);
  }

  /**
   * 使用事务执行操作
   * @param {string} userId 用户ID
   * @param {Function} operation 操作函数
   * @returns {any} 操作结果
   */
  async executeWithTransaction(userId, operation) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        return await operation(multi, playerKey);
      });
    } catch (error) {
      this.logger.error(`[PlayerDataService] 事务执行失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取序列化器实例（供其他服务使用）
   * @returns {PlayerSerializer} 序列化器实例
   */
  getSerializer() {
    return this.serializer;
  }
}

export default PlayerDataService;
