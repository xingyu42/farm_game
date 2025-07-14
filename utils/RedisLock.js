/**
 * Redis分布式锁工具 - 提供可复用的锁机制
 * 用于处理并发请求，确保数据一致性
 */
export class RedisLock {
  constructor(redisClient, logger = console) {
    this.redis = redisClient;
    this.logger = logger;
    this.defaultTimeout = 30 * 1000; // 30秒默认超时
    this.lockPrefix = 'lock:';
  }

  /**
   * 获取分布式锁
   * @param {string} key 锁的键名
   * @param {number} timeout 锁超时时间(毫秒)，默认30秒
   * @param {number} retryDelay 重试延迟(毫秒)，默认100ms
   * @param {number} maxRetries 最大重试次数，默认10次
   * @returns {Promise<Object|null>} 锁对象或null
   */
  async acquire(key, timeout = this.defaultTimeout, retryDelay = 100, maxRetries = 10) {
    const lockKey = this.lockPrefix + key;
    const lockValue = this._generateLockValue();
    const expireTime = Math.ceil(timeout / 1000); // Redis EXPIRE使用秒
    
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        // 使用 SET key value NX EX expire 原子操作
        const result = await this.redis.client.set(lockKey, lockValue, 'NX', 'EX', expireTime);
        
        if (result === 'OK') {
          const lock = {
            key: lockKey,
            value: lockValue,
            acquiredAt: Date.now(),
            timeout
          };
          
          this.logger.debug(`[RedisLock] 成功获取锁: ${key}`);
          return lock;
        }
        
        // 获取锁失败，等待后重试
        if (retries < maxRetries - 1) {
          await this._sleep(retryDelay);
        }
        retries++;
        
      } catch (error) {
        this.logger.error(`[RedisLock] 获取锁失败 [${key}]: ${error.message}`);
        throw error;
      }
    }
    
    this.logger.warn(`[RedisLock] 获取锁超时 [${key}]，已重试 ${maxRetries} 次`);
    return null;
  }

  /**
   * 释放分布式锁
   * @param {Object} lock 锁对象
   * @returns {Promise<boolean>} 是否成功释放
   */
  async release(lock) {
    if (!lock || !lock.key || !lock.value) {
      this.logger.warn('[RedisLock] 无效的锁对象');
      return false;
    }

    try {
      // 使用Lua脚本确保原子性：只有锁的持有者才能释放锁
      const luaScript = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await this.redis.client.eval(luaScript, 1, lock.key, lock.value);
      
      if (result === 1) {
        this.logger.debug(`[RedisLock] 成功释放锁: ${lock.key}`);
        return true;
      } else {
        this.logger.warn(`[RedisLock] 锁已过期或被其他进程释放: ${lock.key}`);
        return false;
      }
      
    } catch (error) {
      this.logger.error(`[RedisLock] 释放锁失败 [${lock.key}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查锁是否存在
   * @param {string} key 锁的键名
   * @returns {Promise<boolean>} 锁是否存在
   */
  async exists(key) {
    try {
      const lockKey = this.lockPrefix + key;
      const result = await this.redis.client.exists(lockKey);
      return result === 1;
    } catch (error) {
      this.logger.error(`[RedisLock] 检查锁存在性失败 [${key}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取锁的剩余时间（秒）
   * @param {string} key 锁的键名
   * @returns {Promise<number>} 剩余时间，-1表示锁不存在，-2表示无过期时间
   */
  async getTTL(key) {
    try {
      const lockKey = this.lockPrefix + key;
      return await this.redis.client.ttl(lockKey);
    } catch (error) {
      this.logger.error(`[RedisLock] 获取锁TTL失败 [${key}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 强制释放锁（仅用于清理，谨慎使用）
   * @param {string} key 锁的键名
   * @returns {Promise<boolean>} 是否成功删除
   */
  async forceRelease(key) {
    try {
      const lockKey = this.lockPrefix + key;
      const result = await this.redis.client.del(lockKey);
      
      if (result === 1) {
        this.logger.warn(`[RedisLock] 强制释放锁: ${key}`);
        return true;
      }
      return false;
      
    } catch (error) {
      this.logger.error(`[RedisLock] 强制释放锁失败 [${key}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 生成唯一的锁值
   * @returns {string} 锁值
   * @private
   */
  _generateLockValue() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 睡眠函数
   * @param {number} ms 毫秒数
   * @returns {Promise} Promise对象
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 执行带锁的操作
   * @param {string} key 锁的键名
   * @param {Function} operation 要执行的操作
   * @param {number} timeout 锁超时时间
   * @returns {Promise<any>} 操作结果
   */
  async withLock(key, operation, timeout = this.defaultTimeout) {
    const lock = await this.acquire(key, timeout);
    
    if (!lock) {
      throw new Error(`获取锁失败: ${key}`);
    }

    try {
      return await operation();
    } finally {
      await this.release(lock);
    }
  }
}

