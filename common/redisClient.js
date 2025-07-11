/**
 * Redis客户端工具类
 * 提供Key生成、JSON处理、事务封装、分布式锁等核心功能
 * 
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
   * 执行Redis事务
   * @param {Function} transactionFn 事务函数，接收multi实例
   * @returns {Promise<any>} 事务执行结果
   */
  async transaction(transactionFn) {
    if (!this.isConnected()) {
      throw new Error('Redis client not connected');
    }

    const multi = this.client.multi();

    try {
      // 执行事务函数，传入multi实例
      await transactionFn(multi);

      // 执行事务并检查结果
      const results = await multi.exec();

      // 检查事务执行结果
      if (!results) {
        throw new Error('Transaction was discarded (WATCH key was modified)');
      }

      // 检查每个命令的执行结果
      for (let i = 0; i < results.length; i++) {
        const [err, result] = results[i];
        if (err) {
          throw new Error(`Transaction command ${i} failed: ${err.message}`, { cause: err });
        }
      }

      return results;
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Transaction failed: ${error.message}`, { cause: error });
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
        // 尝试获取锁（SET NX EX）
        const result = await this.client.set(lockKey, lockValue, 'EX', ttl, 'NX');

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
      
      const result = await this.client.eval(luaScript, 1, lockKey, lockValue);
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
   * 执行增强的Redis事务（支持条件检查）
   * @param {Function} transactionFn 事务函数
   * @param {Array} watchKeys 监控的Key列表
   * @returns {Promise<any>} 事务执行结果
   */
  async enhancedTransaction(transactionFn, watchKeys = []) {
    try {
      // 监控指定的键
      if (watchKeys.length > 0) {
        await this.client.watch(...watchKeys);
      }

      const multi = this.client.multi();
      
      // 执行事务函数
      const preparedData = await transactionFn(multi);
      
      // 执行事务
      const results = await multi.exec();
      
      if (results === null) {
        // 事务被取消（WATCH的键被修改）
        throw new Error('事务被取消：监控的键已被修改');
      }

      return {
        success: true,
        results,
        preparedData
      };
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Batch operation failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * 批量获取数据
   * @param {Array<string>} keys Key列表
   * @returns {Promise<Array>} 数据列表
   */
  async mget(keys) {
    try {
      const values = await this.client.mget(...keys);
      return values.map(value => value ? this.deserialize(value) : null);
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Batch get failed for keys [${keys.join(', ')}]: ${error.message}`, { cause: error });
    }
  }

  /**
   * 批量设置数据
   * @param {Object} keyValuePairs Key-Value对象
   * @param {number} ttl 可选的过期时间
   * @returns {Promise<boolean>} 设置结果
   */
  async mset(keyValuePairs, ttl = null) {
    try {
      const multi = this.client.multi();
      
      for (const [key, value] of Object.entries(keyValuePairs)) {
        const serializedValue = this.serialize(value);
        
        if (ttl) {
          multi.setex(key, ttl, serializedValue);
        } else {
          multi.set(key, serializedValue);
        }
      }
      
      await multi.exec();
      return true;
    } catch (error) {
      // 保留原始错误堆栈跟踪
      throw new Error(`Batch set failed: ${error.message}`, { cause: error });
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