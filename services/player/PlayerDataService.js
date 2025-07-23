/**
 * 玩家数据持久化服务
 * 负责Redis Hash操作、数据序列化/反序列化等底层数据操作
 * 支持分级存储：频繁字段存储在Redis，长周期字段存储在YAML文件
 */

import PlayerSerializer from './utils/PlayerSerializer.js';
import { PlayerYamlStorage } from '../../utils/playerYamlStorage.js';

class PlayerDataService {
  constructor(redisClient, config, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.logger = logger || console;
    this.serializer = new PlayerSerializer(config);
    this.yamlStorage = new PlayerYamlStorage();

    // 定义长周期字段（存储在YAML文件中）
    this.infrequentFields = [
      'createdAt',           // 创建时间
      'name',               // 玩家名称
      'maxLandCount',       // 最大土地数量
      'maxInventoryCapacity', // 最大仓库容量
      'experience',         // 经验值
      'level',              // 等级
      'landCount',          // 当前土地数量（相对稳定）
      'inventoryCapacity',  // 当前仓库容量（相对稳定）
      'inventory_capacity', // 仓库容量别名
      'inventory',          // 仓库物品（相对稳定）
      'stats',              // 统计信息（相对稳定）
      'signIn',             // 签到信息（相对稳定）
      'statistics'          // 详细统计（相对稳定）
    ];

    // 定义频繁字段（存储在Redis中）
    this.frequentFields = [
      'coins',              // 金币（经常变动）
      'lastUpdated',        // 最后更新时间
      'lastActiveTime',     // 最后活跃时间
      'lands',              // 土地信息（种植状态等）
      'protection',         // 保护状态
      'stealing'            // 偷菜信息
    ];
  }

  /**
   * 获取完整玩家数据（合并Redis和YAML数据）
   * @param {string} userId 用户ID
   * @returns {Player|null} Player实例或null
   */
  async getPlayer(userId) {
    try {
      // 并行读取Redis和YAML数据
      const [redisData, yamlData] = await Promise.all([
        this._getRedisData(userId),
        this._getYamlData(userId)
      ]);

      // 如果两者都不存在，返回null
      if (!redisData && !yamlData) {
        return null;
      }

      // 合并数据，Redis数据优先级更高（处理字段冲突）
      const mergedData = {
        ...yamlData,
        ...redisData
      };

      // 使用序列化器创建Player实例
      return this.serializer.deserializeFromHash(mergedData);
    } catch (error) {
      this.logger.error(`[PlayerDataService] 获取玩家数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 保存完整玩家数据（分别存储到Redis和YAML）
   * @param {string} userId 用户ID
   * @param {Object|Player} playerData 玩家数据或Player实例
   */
  async savePlayer(userId, playerData) {
    try {
      // 序列化数据
      const hashData = this.serializer.serializeForHash(playerData);

      // 分离频繁字段和非频繁字段
      const redisData = {};
      const yamlData = {};

      for (const [field, value] of Object.entries(hashData)) {
        if (this.infrequentFields.includes(field)) {
          // 长周期字段存储到YAML，需要解析JSON字符串
          yamlData[field] = this._parseFieldValue(field, value);
        } else if (this.frequentFields.includes(field)) {
          // 频繁字段存储到Redis
          redisData[field] = value;
        } else {
          // 未分类字段默认存储到Redis
          redisData[field] = value;
        }
      }

      // 并行保存到Redis和YAML
      const promises = [];

      if (Object.keys(redisData).length > 0) {
        promises.push(this._saveRedisData(userId, redisData));
      }

      if (Object.keys(yamlData).length > 0) {
        promises.push(this._saveYamlData(userId, yamlData));
      }

      await Promise.all(promises);

    } catch (error) {
      this.logger.error(`[PlayerDataService] 保存玩家数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 更新特定字段（自动判断存储位置）
   * @param {string} userId 用户ID
   * @param {Object} fieldUpdates 字段更新映射
   */
  async updateFields(userId, fieldUpdates) {
    try {
      const redisUpdates = {};
      const yamlUpdates = {};

      // 分类字段更新
      for (const [field, value] of Object.entries(fieldUpdates)) {
        if (this.infrequentFields.includes(field)) {
          yamlUpdates[field] = value;
        } else {
          redisUpdates[field] = value;
        }
      }

      // 并行更新
      const promises = [];

      if (Object.keys(redisUpdates).length > 0) {
        promises.push(this._updateRedisFields(userId, redisUpdates));
      }

      if (Object.keys(yamlUpdates).length > 0) {
        promises.push(this._updateYamlFields(userId, yamlUpdates));
      }

      await Promise.all(promises);

    } catch (error) {
      this.logger.error(`[PlayerDataService] 更新字段失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 从Redis Hash读取玩家数据（兼容性方法）
   * @param {string} userId 用户ID
   * @returns {Player|null} Player实例或null
   */
  async getPlayerFromHash(userId) {
    return await this.getPlayer(userId);
  }

  /**
   * 将玩家数据保存到Redis Hash（兼容性方法）
   * @param {string} userId 用户ID
   * @param {Object|Player} playerData 玩家数据或Player实例
   */
  async savePlayerToHash(userId, playerData) {
    return await this.savePlayer(userId, playerData);
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

  /**
   * 私有方法：从Redis读取数据
   * @param {string} userId 用户ID
   * @returns {Object|null} Redis数据
   * @private
   */
  async _getRedisData(userId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const exists = await this.redis.exists(playerKey);

      if (!exists) {
        return null;
      }

      const hashData = await this.redis.client.hGetAll(playerKey);
      return Object.keys(hashData).length > 0 ? hashData : null;
    } catch (error) {
      this.logger.error(`[PlayerDataService] 从Redis读取数据失败 [${userId}]: ${error.message}`);
      return null;
    }
  }

  /**
   * 私有方法：从YAML读取数据
   * @param {string} userId 用户ID
   * @returns {Object|null} YAML数据
   * @private
   */
  async _getYamlData(userId) {
    try {
      const yamlData = await this.yamlStorage.readPlayer(userId);
      if (!yamlData) {
        return null;
      }

      // 将YAML数据转换为Hash格式（字符串化）
      const hashData = {};
      for (const [field, value] of Object.entries(yamlData)) {
        hashData[field] = this._stringifyFieldValue(field, value);
      }

      return hashData;
    } catch (error) {
      this.logger.error(`[PlayerDataService] 从YAML读取数据失败 [${userId}]: ${error.message}`);
      return null;
    }
  }

  /**
   * 私有方法：保存数据到Redis
   * @param {string} userId 用户ID
   * @param {Object} redisData Redis数据
   * @private
   */
  async _saveRedisData(userId, redisData) {
    const playerKey = this.redis.generateKey('player', userId);
    await this.redis.client.hSet(playerKey, redisData);
  }

  /**
   * 私有方法：保存数据到YAML
   * @param {string} userId 用户ID
   * @param {Object} yamlData YAML数据
   * @private
   */
  async _saveYamlData(userId, yamlData) {
    await this.yamlStorage.writePlayer(userId, yamlData);
  }

  /**
   * 私有方法：更新Redis字段
   * @param {string} userId 用户ID
   * @param {Object} updates 更新数据
   * @private
   */
  async _updateRedisFields(userId, updates) {
    // 序列化更新数据
    const hashUpdates = {};
    for (const [field, value] of Object.entries(updates)) {
      if (this.serializer.simpleFields.includes(field)) {
        hashUpdates[field] = value.toString();
      } else if (this.serializer.complexFields.includes(field)) {
        hashUpdates[field] = JSON.stringify(value);
      } else {
        hashUpdates[field] = value.toString();
      }
    }

    const playerKey = this.redis.generateKey('player', userId);
    await this.redis.client.hSet(playerKey, hashUpdates);
  }

  /**
   * 私有方法：更新YAML字段
   * @param {string} userId 用户ID
   * @param {Object} updates 更新数据
   * @private
   */
  async _updateYamlFields(userId, updates) {
    // 读取现有YAML数据
    const existingData = await this.yamlStorage.readPlayer(userId, {});

    // 合并更新
    const updatedData = {
      ...existingData,
      ...updates
    };

    // 保存更新后的数据
    await this.yamlStorage.writePlayer(userId, updatedData);
  }

  /**
   * 私有方法：解析字段值（从字符串转换为适当类型）
   * @param {string} field 字段名
   * @param {string} value 字符串值
   * @returns {any} 解析后的值
   * @private
   */
  _parseFieldValue(field, value) {
    // 数值字段
    if (['level', 'experience', 'maxLandCount', 'maxInventoryCapacity', 'createdAt'].includes(field)) {
      return parseInt(value);
    }
    // 字符串字段
    return value;
  }

  /**
   * 私有方法：字符串化字段值（为Hash存储准备）
   * @param {string} field 字段名
   * @param {any} value 原始值
   * @returns {string} 字符串值
   * @private
   */
  _stringifyFieldValue(field, value) {
    if (value === null || value === undefined) {
      return '';
    }
    return value.toString();
  }
}

export default PlayerDataService;
