/**
 * Redis客户端工具类
 * 提供Key生成、JSON处理、事务封装、分布式锁等核心功能
 * 
 * {{CHENGQI:
 * Action: Enhanced; Timestamp: 2025-06-30T14:41:00+08:00; Reason: Shrimp Task ID: #5492e748, enhancing existing Redis client with distributed locking for T8;
 * }}
 */

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #787dc7f8, converting CommonJS require to ES Modules import; Principle_Applied: ModuleSystem-Standardization;}}
import redis from 'redis';

class RedisClient {
  constructor() {
    // 在实际使用时，可以通过配置注入Redis连接
    this.client = null;
    this.keyPrefix = 'farm_game';
    this.lockPrefix = 'lock';
    this.defaultLockTTL = 30; // 默认锁30秒过期
  }

  /**
   * 初始化Redis连接
   * @param {Object} config Redis配置
   */
  async init(config = {}) {
    if (!this.client) {
      this.client = redis.createClient(config);
      await this.client.connect();
    }
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
      throw new Error(`Serialization failed: ${error.message}`);
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
      throw new Error(`Deserialization failed: ${error.message}`);
    }
  }

  /**
   * 执行Redis事务
   * @param {Function} transactionFn 事务函数，接收multi实例
   * @returns {Promise<any>} 事务执行结果
   */
  async transaction(transactionFn) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    const multi = this.client.multi();
    
    try {
      // 执行事务函数，传入multi实例
      await transactionFn(multi);
      
      // 执行事务
      const results = await multi.exec();
      return results;
    } catch (error) {
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  /**
   * 设置数据（自动JSON序列化）
   * @param {string} key Redis键
   * @param {any} value 要设置的值
   * @param {number} ttl 可选的过期时间（秒）
   */
  async set(key, value, ttl = null) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
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
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    const value = await this.client.get(key);
    return this.deserialize(value);
  }

  /**
   * 删除数据
   * @param {string} key Redis键
   */
  async del(key) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    return await this.client.del(key);
  }

  /**
   * 检查键是否存在
   * @param {string} key Redis键
   * @returns {boolean} 是否存在
   */
  async exists(key) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
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
    const retryInterval = 100; // 重试间隔100ms

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

        // 锁被占用，等待后重试
        if (attempt < maxRetries - 1) {
          await this._sleep(retryInterval * (attempt + 1));
        }
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw error;
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
      throw error;
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
      throw error;
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
      throw error;
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
      throw error;
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
      throw error;
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

  /**
   * 关闭连接
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

// 导出单例实例
// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #787dc7f8, converting CommonJS module.exports to ES Modules export default; Principle_Applied: ModuleSystem-Standardization;}}
export default new RedisClient();