/**
 * Redis客户端工具类
 * 提供分布式锁、TTL管理、原子计数器等核心功能
 *
 * Hash操作使用说明：
 * - 仅用于非玩家数据的临时状态管理（如市场统计、全局计数器）
 * - 禁止用于玩家核心数据（资产、状态等），玩家数据请使用YAML存储
 */


class RedisClient {
  constructor() {
    // 直接使用Miao-Yunzai框架提供的Redis连接
    this.client = global.redis;
    this.keyPrefix = 'farm_game';
    this.lockPrefix = 'lock';
    this.defaultLockTTL = 30; // 默认锁30秒过期
  }

  /**
   * 检查Redis连接是否可用
   * @returns {boolean} 连接状态
   */
  isConnected() {
    return this.client && this.client.isReady;
  }

  /**
   * 生成标准化的Redis Key
   * @param {string} type 数据类型 (player, land, inventory等)
   * @param {string} id 唯一标识符
   * @param {string} field 可选字段
   * @returns {string} 格式化的Key
   */
  generateKey(type, id, field = null) {
    const baseKey = `${this.keyPrefix}:${type}:${id}`;
    return field ? `${baseKey}:${field}` : baseKey;
  }

  /**
   * JSON序列化
   * @param {any} data 要序列化的数据
   * @returns {string} JSON字符串
   */
  serialize(data) {
    try {
      return JSON.stringify(data);
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Serialization failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * JSON反序列化
   * @param {string} jsonStr JSON字符串
   * @returns {any} 反序列化的数据
   */
  deserialize(jsonStr) {
    try {
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Deserialization failed: ${error.message}`, { cause: error });
    }
  }


  /**
   * 设置数据（自动JSON序列化）
   * @param {string} key Redis键
   * @param {any} value 要设置的值
   * @param {number} ttl 可选的过期时间（秒）
   */
  async set(key, value, ttl = null) {
    if (!this.isConnected()) {
      throw new Error('Redis client not connected');
    }

    const serializedValue = this.serialize(value);

    if (ttl) {
      await this.client.setEx(key, ttl, serializedValue);
    } else {
      await this.client.set(key, serializedValue);
    }
  }

  /**
   * 获取数据（自动JSON反序列化）
   * @param {string} key Redis键
   * @returns {any} 反序列化的数据
   */
  async get(key) {
    if (!this.isConnected()) {
      throw new Error('Redis client not connected');
    }

    const value = await this.client.get(key);
    return this.deserialize(value);
  }

  /**
   * 删除数据
   * @param {string} key Redis键
   */
  async del(key) {
    if (!this.isConnected()) {
      throw new Error('Redis client not connected');
    }

    return await this.client.del(key);
  }

  /**
   * 检查键是否存在
   * @param {string} key Redis键
   * @returns {boolean} 是否存在
   */
  async exists(key) {
    if (!this.isConnected()) {
      throw new Error('Redis client not connected');
    }

    return (await this.client.exists(key)) === 1;
  }

  /**
   * 生成分布式锁Key
   * @param {string} userId 用户ID
   * @param {string} operation 操作类型（可选）
   * @returns {string} 锁Key
   */
  generateLockKey(userId, operation = 'general') {
    return `${this.keyPrefix}:${this.lockPrefix}:${userId}:${operation}`;
  }

  /**
   * 获取分布式锁
   * @param {string} userId 用户ID
   * @param {string} operation 操作类型
   * @param {number} ttl 锁过期时间（秒）
   * @param {number} maxRetries 最大重试次数
   * @returns {Promise<Object>} 锁获取结果
   */
  async acquireLock(userId, operation = 'general', ttl = this.defaultLockTTL, maxRetries = 3) {
    const lockKey = this.generateLockKey(userId, operation);
    const lockValue = `${Date.now()}_${Math.random()}`;
    const baseRetryInterval = 100; // 基础重试间隔100ms
    const maxRetryInterval = 2000; // 最大重试间隔2秒

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 尝试获取锁（SET NX EX）- Redis v4 语法
        const result = await this.client.set(lockKey, lockValue, { NX: true, EX: ttl });

        if (result === 'OK') {
          return {
            success: true,
            lockKey,
            lockValue,
            ttl
          };
        }

        // 锁被占用，使用指数退避策略等待后重试
        if (attempt < maxRetries - 1) {
          // 指数退避：2^attempt * baseInterval，但不超过maxRetryInterval
          const exponentialDelay = Math.min(
            baseRetryInterval * Math.pow(2, attempt),
            maxRetryInterval
          );
          // 添加随机抖动，避免惊群效应
          const jitter = Math.random() * 0.1 * exponentialDelay;
          const finalDelay = exponentialDelay + jitter;

          await this._sleep(finalDelay);
        }
      } catch (error) {
        if (attempt === maxRetries - 1) {
          // 保留原始错误堆栈跟踪
          throw new Error(`Lock acquisition failed after ${maxRetries} attempts: ${error.message}`, { cause: error });
        }

        // 对于非最后一次尝试，也使用指数退避
        if (attempt < maxRetries - 1) {
          const exponentialDelay = Math.min(
            baseRetryInterval * Math.pow(2, attempt),
            maxRetryInterval
          );
          await this._sleep(exponentialDelay);
        }
      }
    }

    return {
      success: false,
      error: `获取锁失败，最大重试次数已达到: ${maxRetries}`
    };
  }

  /**
   * 释放分布式锁
   * @param {string} lockKey 锁Key
   * @param {string} lockValue 锁值
   * @returns {Promise<boolean>} 释放结果
   */
  async releaseLock(lockKey, lockValue) {
    try {
      // 使用Lua脚本确保原子性释放锁
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.client.eval(luaScript, { keys: [lockKey], arguments: [lockValue] });
      return result === 1;
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Failed to release lock ${lockKey}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 使用分布式锁执行操作
   * @param {string} userId 用户ID
   * @param {Function} operation 要执行的操作函数
   * @param {string} operationType 操作类型
   * @param {number} lockTTL 锁过期时间
   * @returns {Promise<any>} 操作结果
   */
  async withLock(userId, operation, operationType = 'general', lockTTL = this.defaultLockTTL) {
    const lockResult = await this.acquireLock(userId, operationType, lockTTL);

    if (!lockResult.success) {
      throw new Error(`无法获取锁: ${lockResult.error}`);
    }

    try {
      // 执行操作
      const result = await operation();
      return result;
    } finally {
      // 确保锁被释放
      await this.releaseLock(lockResult.lockKey, lockResult.lockValue);
    }
  }




  /**
   * 原子性增加数值
   * @param {string} key Redis Key
   * @param {number} increment 增加量
   * @returns {Promise<number>} 增加后的值
   */
  async incrBy(key, increment = 1) {
    try {
      return await this.client.incrby(key, increment);
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Increment failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 原子性递增（增加1）
   * @param {string} key Redis Key
   * @returns {Promise<number>} 增加后的值
   */
  async incr(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      throw new Error(`Increment failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 设置键值和过期时间（秒）
   * @param {string} key Redis Key
   * @param {number} seconds 过期时间（秒）
   * @param {string} value 值
   * @returns {Promise<string>} 设置结果
   */
  async setex(key, seconds, value) {
    try {
      return await this.client.setEx(key, seconds, value);
    } catch (error) {
      throw new Error(`Setex failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 设置键的过期时间
   * @param {string} key Redis Key
   * @param {number} seconds 过期时间（秒）
   * @returns {Promise<number>} 设置结果（1成功，0失败）
   */
  async expire(key, seconds) {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      throw new Error(`Expire failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  // ==========================================
  // Hash操作方法 - 仅用于非玩家数据的临时状态管理
  // 适用场景：市场统计、全局计数器、临时状态等
  // 禁止用于：玩家核心数据（资产、状态等）
  // ==========================================

  /**
   * 设置Hash字段值
   * @param {string} key Redis Hash Key
   * @param {Object|string} field 字段名或字段对象
   * @param {string} value 字段值（当field为字符串时使用）
   * @returns {Promise<number>} 设置的字段数量
   */
  async hSet(key, field, value = null) {
    try {
      if (typeof field === 'object' && field !== null) {
        // 批量设置：hSet(key, {field1: value1, field2: value2})
        return await this.client.hSet(key, field);
      } else {
        // 单个设置：hSet(key, field, value)
        return await this.client.hSet(key, field, value);
      }
    } catch (error) {
      throw new Error(`Hash set failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 获取Hash字段值
   * @param {string} key Redis Hash Key
   * @param {string} field 字段名
   * @returns {Promise<string|null>} 字段值
   */
  async hGet(key, field) {
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      throw new Error(`Hash get failed for key ${key}, field ${field}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 获取Hash所有字段和值
   * @param {string} key Redis Hash Key
   * @returns {Promise<Object>} 所有字段和值的对象
   */
  async hGetAll(key) {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      throw new Error(`Hash getall failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * Hash字段原子性增加数值
   * @param {string} key Redis Hash Key
   * @param {string} field 字段名
   * @param {number} increment 增加量
   * @returns {Promise<number>} 增加后的值
   */
  async hIncrBy(key, field, increment = 1) {
    try {
      return await this.client.hIncrBy(key, field, increment);
    } catch (error) {
      throw new Error(`Hash increment failed for key ${key}, field ${field}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 获取匹配模式的所有keys
   * @param {string} pattern 匹配模式
   * @returns {Promise<Array<string>>} 匹配的keys列表
   */
  async keys(pattern) {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Keys search failed for pattern ${pattern}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 获取key的TTL
   * @param {string} key Redis Key
   * @returns {Promise<number>} TTL值
   */
  async ttl(key) {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`TTL check failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 创建Pipeline/Multi事务
   * @returns {Object} Pipeline对象
   */
  multi() {
    try {
      return this.client.multi();
    } catch (error) {
      throw new Error(`Multi/Pipeline creation failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * 创建Pipeline（multi的别名）
   * @returns {Object} Pipeline对象
   */
  pipeline() {
    return this.multi();
  }






  /**
   * 私有方法：睡眠等待
   * @param {number} ms 毫秒数
   * @returns {Promise<void>}
   */
  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}

// 导出单例实例
export default new RedisClient();