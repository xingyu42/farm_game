/**
 * 玩家数据持久化服务
 * 负责YAML文件存储、数据序列化/反序列化等底层数据操作
 * 使用统一的YAML文件存储，通过分布式锁保障数据一致性
 */

import PlayerSerializer from './PlayerSerializer.js';
import { PlayerYamlStorage } from '../../utils/playerYamlStorage.js';

class PlayerDataService {
  constructor(redisClient, config) {
    this.redis = redisClient;
    this.config = config;
    this.serializer = new PlayerSerializer(config);
    this.yamlStorage = new PlayerYamlStorage();
  }

  /**
   * 使用分布式锁执行玩家数据操作
   * @param {string} userId 用户ID
   * @param {Function} operation 数据操作函数
   * @param {string} operationType 操作类型标识
   * @param {number} timeout 锁超时时间（秒），默认30秒
   * @returns {Promise<any>} 操作结果
   */
  async withPlayerLock(userId, operation, operationType = 'data_operation', timeout = 30) {
    try {
      return await this.redis.withLock(userId, operation, operationType, timeout);
    } catch (error) {
      // 增强错误处理
      if (error.message.includes('获取锁失败') || error.message.includes('lock timeout')) {
        logger.warn(`[PlayerDataService] 获取锁失败 [${userId}] ${operationType}: ${error.message}`);
        throw new Error(`操作繁忙，请稍后重试 (${operationType})`);
      }

      if (error.message.includes('锁已过期') || error.message.includes('lock expired')) {
        logger.warn(`[PlayerDataService] 锁过期 [${userId}] ${operationType}: ${error.message}`);
        throw new Error(`操作超时，请重新尝试 (${operationType})`);
      }

      // 其他锁相关错误
      logger.error(`[PlayerDataService] 锁操作失败 [${userId}] ${operationType}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取完整玩家数据（仅从YAML文件读取）
   * @param {string} userId 用户ID
   * @returns {Player|null} Player实例或null
   */
  async getPlayer(userId) {
    return await this.withPlayerLock(userId, async () => {
      try {
        // 从YAML文件读取数据
        const yamlData = await this.yamlStorage.readPlayer(userId);

        if (!yamlData) {
          return null;
        }

        // 使用序列化器创建Player实例
        return this.serializer.deserialize(yamlData);
      } catch (error) {
        logger.error(`[PlayerDataService] 获取玩家数据失败 [${userId}]: ${error.message}`);
        throw error;
      }
    }, 'get_player');
  }

  /**
   * 保存完整玩家数据（仅写入YAML文件，使用分布式锁）
   * @param {string} userId 用户ID
   * @param {Object|Player} playerData 玩家数据或Player实例
   */
  async savePlayer(userId, playerData) {
    return await this.withPlayerLock(userId, async () => {
      try {
        // 数据验证
        if (!playerData) {
          throw new Error('玩家数据不能为空');
        }

        // 序列化数据
        const yamlData = this.serializer.serialize(playerData);

        // 使用原子性写入
        await this.yamlStorage.writePlayerAtomic(userId, yamlData);

      } catch (error) {
        // 增强文件操作错误处理
        if (error.code === 'ENOSPC') {
          logger.error(`[PlayerDataService] 磁盘空间不足 [${userId}]: ${error.message}`);
          throw new Error('系统存储空间不足，请联系管理员');
        }

        if (error.code === 'EACCES' || error.code === 'EPERM') {
          logger.error(`[PlayerDataService] 文件权限错误 [${userId}]: ${error.message}`);
          throw new Error('系统文件权限错误，请联系管理员');
        }

        if (error.code === 'EMFILE' || error.code === 'ENFILE') {
          logger.error(`[PlayerDataService] 文件句柄不足 [${userId}]: ${error.message}`);
          throw new Error('系统资源不足，请稍后重试');
        }

        logger.error(`[PlayerDataService] 保存玩家数据失败 [${userId}]: ${error.message}`);
        throw new Error(`数据保存失败: ${error.message}`);
      }
    }, 'save_player');
  }

  /**
   * 原子性更新字段（使用分布式锁）
   * @param {string} userId 用户ID
   * @param {Object} fieldUpdates 字段更新映射
   */
  async updateFields(userId, fieldUpdates) {
    return await this.withPlayerLock(userId, async () => {
      try {
        // 数据验证
        if (!fieldUpdates || typeof fieldUpdates !== 'object') {
          throw new Error('字段更新数据无效');
        }

        // 读取现有数据
        const existingData = await this.yamlStorage.readPlayer(userId, {});

        // 合并更新
        const updatedData = {
          ...existingData,
          ...fieldUpdates
        };

        // 使用原子性写入
        await this.yamlStorage.writePlayerAtomic(userId, updatedData);

      } catch (error) {
        // 增强错误处理
        if (error.code === 'ENOENT') {
          logger.warn(`[PlayerDataService] 玩家数据文件不存在 [${userId}]，将创建新文件`);
          // 对于不存在的文件，仍然尝试写入
          try {
            await this.yamlStorage.writePlayerAtomic(userId, fieldUpdates);
          } catch (createError) {
            logger.error(`[PlayerDataService] 创建新玩家数据失败 [${userId}]: ${createError.message}`);
            throw createError;
          }
        } else {
          logger.error(`[PlayerDataService] 更新字段失败 [${userId}]: ${error.message}`);
          throw error;
        }
      }
    }, 'update_fields');
  }

  /**
   * 高效更新单个简单字段（兼容性方法）
   * @param {string} userId 用户ID
   * @param {string} field 字段名
   * @param {any} value 新值
   */
  async updateSimpleField(userId, field, value) {
    // 内部调用统一的updateFields方法
    return await this.updateFields(userId, { [field]: value });
  }

  /**
   * 高效更新多个简单字段（兼容性方法）
   * @param {string} userId 用户ID
   * @param {Object} fieldUpdates 字段更新映射
   */
  async updateSimpleFields(userId, fieldUpdates) {
    // 内部调用统一的updateFields方法
    return await this.updateFields(userId, fieldUpdates);
  }

  /**
   * 更新复杂字段（兼容性方法）
   * @param {string} userId 用户ID
   * @param {string} field 字段名
   * @param {any} value 新值
   */
  async updateComplexField(userId, field, value) {
    // 内部调用统一的updateFields方法
    return await this.updateFields(userId, { [field]: value });
  }

  /**
   * 批量更新复杂字段（兼容性方法）
   * @param {string} userId 用户ID
   * @param {Object} fieldUpdates 字段更新映射
   */
  async updateComplexFields(userId, fieldUpdates) {
    // 内部调用统一的updateFields方法
    return await this.updateFields(userId, fieldUpdates);
  }

  /**
   * 混合更新（同时更新简单字段和复杂字段）（兼容性方法）
   * @param {string} userId 用户ID
   * @param {Object} simpleUpdates 简单字段更新
   * @param {Object} complexUpdates 复杂字段更新
   */
  async updateMixedFields(userId, simpleUpdates = {}, complexUpdates = {}) {
    // 合并所有更新并调用统一的updateFields方法
    const allUpdates = { ...simpleUpdates, ...complexUpdates };
    return await this.updateFields(userId, allUpdates);
  }

  /**
   * 检查玩家是否存在（检查YAML文件）
   * @param {string} userId 用户ID
   * @returns {boolean} 是否存在
   */
  async playerExists(userId) {
    try {
      return await this.yamlStorage.playerExists(userId);
    } catch (error) {
      logger.error(`[PlayerDataService] 检查玩家存在失败 [${userId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * 删除玩家数据（删除YAML文件）
   * @param {string} userId 用户ID
   */
  async deletePlayer(userId) {
    return await this.withPlayerLock(userId, async () => {
      try {
        await this.yamlStorage.deletePlayer(userId);
        logger.info(`[PlayerDataService] 删除玩家数据: ${userId}`);
      } catch (error) {
        logger.error(`[PlayerDataService] 删除玩家数据失败 [${userId}]: ${error.message}`);
        throw error;
      }
    }, 'delete_player');
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
   * 使用分布式锁执行操作（兼容性方法）
   * @param {string} userId 用户ID
   * @param {Function} operation 操作函数，接收(playerDataService, userId)参数
   * @returns {any} 操作结果
   */
  async executeWithTransaction(userId, operation) {
    // 为了向后兼容，将事务操作转换为锁保护的操作
    return await this.withPlayerLock(userId, async () => {
      try {
        // 传递playerDataService实例和userId，让操作函数直接使用新API
        return await operation(this, userId);
      } catch (error) {
        logger.error(`[PlayerDataService] 锁保护操作执行失败 [${userId}]: ${error.message}`);
        throw error;
      }
    }, 'legacy_transaction');
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