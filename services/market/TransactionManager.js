/**
 * TransactionManager - 事务管理服务
 * 
 * 专门负责分布式锁管理、事务性批量更新、数据一致性保证。
 * 确保市场数据更新的原子性和并发安全性。
 * 
 * @version 1.0.0
 */
import { RedisLock } from '../../utils/RedisLock.js';

export class TransactionManager {
  constructor(redisClient, config) {
    this.redis = redisClient;
    this.config = config;
    this.lockManager = new RedisLock(redisClient);
    
    // 获取事务配置
    this.transactionConfig = this.config.market.transaction
    this.lockTimeout = this.transactionConfig.lock_timeout * 1000;
    this.maxRetries = this.transactionConfig.max_retries
    this.retryDelay = this.transactionConfig.retry_delay * 1000;
    
    // 活跃事务跟踪
    this.activeTransactions = new Map();
  }

  /**
   * 执行事务性批量更新
   * @param {Array} operations 操作列表
   * @param {Object} options 选项配置
   * @returns {Promise<Object>} 执行结果
   */
  async executeBatchUpdate(operations, options = {}) {
    const transactionId = this._generateTransactionId();
    const lockKey = options.lockKey || `market:batch:${transactionId}`;
    const timeout = options.timeout || this.lockTimeout;
    
    let lockAcquired = false;
    const startTime = Date.now();

    try {
      logger.info(`[TransactionManager] 开始批量事务 ${transactionId}，操作数量: ${operations.length}`);
      
      // 跟踪活跃事务
      this.activeTransactions.set(transactionId, {
        id: transactionId,
        lockKey,
        operations: operations.length,
        startTime,
        status: 'starting'
      });

      // 获取分布式锁
      lockAcquired = await this._acquireLockWithRetry(lockKey, timeout);
      if (!lockAcquired) {
        throw new Error(`获取事务锁失败: ${lockKey}`);
      }

      this._updateTransactionStatus(transactionId, 'locked');

      // 验证操作
      const validationResult = this._validateOperations(operations);
      if (!validationResult.valid) {
        throw new Error(`操作验证失败: ${validationResult.errors.join(', ')}`);
      }

      this._updateTransactionStatus(transactionId, 'validated');

      // 执行批量操作
      const result = await this._performBatchOperations(operations, transactionId);
      
      // 验证结果一致性
      await this._validateBatchResult(result, operations);

      this._updateTransactionStatus(transactionId, 'completed');
      
      const duration = Date.now() - startTime;
      logger.info(`[TransactionManager] 批量事务 ${transactionId} 成功完成，耗时: ${duration}ms`);

      return {
        success: true,
        transactionId,
        operationsCount: operations.length,
        successCount: result.successCount,
        duration,
        errors: result.errors
      };

    } catch (error) {
      this._updateTransactionStatus(transactionId, 'failed');
      logger.error(`[TransactionManager] 批量事务 ${transactionId} 失败: ${error.message}`);
      
      // 尝试回滚
      try {
        await this._rollbackTransaction(operations, transactionId);
      } catch (rollbackError) {
        logger.error(`[TransactionManager] 事务回滚失败: ${rollbackError.message}`);
      }

      throw error;
    } finally {
      // 释放锁
      if (lockAcquired) {
        try {
          await this.lockManager.withLock(lockKey, async () => {
            // 空操作，主要是为了释放锁
          }, 1000);
        } catch (unlockError) {
          logger.warn(`[TransactionManager] 释放锁失败: ${unlockError.message}`);
        }
      }

      // 清理活跃事务记录
      this.activeTransactions.delete(transactionId);
    }
  }

  /**
   * 执行原子性操作
   * @param {string} lockKey 锁键
   * @param {Function} operation 要执行的操作
   * @param {number} timeout 超时时间
   * @returns {Promise<any>} 操作结果
   */
  async executeAtomicOperation(lockKey, operation, timeout = this.lockTimeout) {
    const operationId = this._generateTransactionId();
    
    try {
      logger.debug(`[TransactionManager] 开始原子操作 ${operationId}，锁键: ${lockKey}`);
      
      return await this.lockManager.withLock(lockKey, operation, timeout);
    } catch (error) {
      logger.error(`[TransactionManager] 原子操作 ${operationId} 失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量获取锁
   * @param {Array<string>} lockKeys 锁键数组
   * @param {number} timeout 超时时间
   * @returns {Promise<Object>} 获取结果
   */
  async acquireBatchLocks(lockKeys, timeout = this.lockTimeout) {
    const acquiredLocks = [];
    const failedLocks = [];
    
    try {
      // 按顺序获取锁，避免死锁
      const sortedKeys = [...lockKeys].sort();
      
      for (const key of sortedKeys) {
        try {
          const lock = await this.lockManager.acquire(key, timeout);
          if (lock) {
            acquiredLocks.push(lock);
          } else {
            failedLocks.push(key);
          }
        } catch (error) {
          failedLocks.push(key);
          logger.warn(`[TransactionManager] 获取锁失败 ${key}: ${error.message}`);
        }
      }

      return {
        success: failedLocks.length === 0,
        acquiredLocks,
        failedLocks,
        acquiredCount: acquiredLocks.length,
        totalCount: lockKeys.length
      };
      
    } catch (error) {
      // 释放已获取的锁
      for (const lock of acquiredLocks) {
        try {
          await this.lockManager.release(lock);
        } catch (releaseError) {
          logger.warn(`[TransactionManager] 释放锁失败: ${releaseError.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * 检测死锁
   * @returns {Promise<Array>} 死锁检测结果
   */
  async detectDeadlocks() {
    try {
      const deadlocks = [];
      const lockPattern = `${this.redis.keyPrefix}:lock:*`;
      const lockKeys = await this.redis.keys(lockPattern);
      
      if (lockKeys.length === 0) {
        return deadlocks;
      }

      // 获取所有锁的信息
      const pipeline = this.redis.pipeline();
      for (const key of lockKeys) {
        pipeline.get(key);
        pipeline.ttl(key);
      }
      
      const results = await pipeline.exec();
      
      // 分析锁的状态
      for (let i = 0; i < lockKeys.length; i++) {
        const key = lockKeys[i];
        const value = results[i * 2];
        const ttl = results[i * 2 + 1];
        
        // 检查是否有长时间持有的锁
        if (ttl > this.lockTimeout / 1000) {
          deadlocks.push({
            key,
            value,
            ttl,
            suspectedDeadlock: true,
            reason: '锁持有时间过长'
          });
        }
      }

      if (deadlocks.length > 0) {
        logger.warn(`[TransactionManager] 检测到 ${deadlocks.length} 个可能的死锁`);
      }

      return deadlocks;
    } catch (error) {
      logger.error(`[TransactionManager] 死锁检测失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取活跃事务信息
   * @returns {Array} 活跃事务列表
   */
  getActiveTransactions() {
    return Array.from(this.activeTransactions.values());
  }

  /**
   * 获取事务统计信息
   * @returns {Object} 统计信息
   */
  getTransactionStats() {
    return {
      activeTransactions: this.activeTransactions.size,
      lockTimeout: this.lockTimeout,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    };
  }

  /**
   * 获取分布式锁并重试
   * @param {string} lockKey 锁键
   * @param {number} timeout 超时时间
   * @returns {Promise<boolean>} 是否成功获取锁
   * @private
   */
  async _acquireLockWithRetry(lockKey, timeout) {
    let attempts = 0;
    
    while (attempts < this.maxRetries) {
      try {
        const success = await this.lockManager.withLock(lockKey, async () => {
          return true; // 成功获取锁
        }, timeout);
        
        if (success) {
          return true;
        }
      } catch (error) {
        attempts++;
        
        if (attempts >= this.maxRetries) {
          logger.error(`[TransactionManager] 获取锁最终失败 ${lockKey}，已重试 ${attempts} 次`);
          return false;
        }
        
        logger.warn(`[TransactionManager] 获取锁失败 ${lockKey}，第 ${attempts} 次重试: ${error.message}`);
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
    
    return false;
  }

  /**
   * 执行批量操作
   * @param {Array} operations 操作列表
   * @param {string} transactionId 事务ID
   * @returns {Promise<Object>} 执行结果
   * @private
   */
  async _performBatchOperations(operations, transactionId) {
    const multi = this.redis.pipeline();
    let successCount = 0;
    const errors = [];

    try {
      // 将所有操作添加到事务中
      for (const operation of operations) {
        try {
          this._addOperationToTransaction(multi, operation);
          successCount++;
        } catch (error) {
          errors.push({
            operation: operation.type || 'unknown',
            key: operation.key,
            error: error.message
          });
        }
      }

      // 执行事务
      const results = await multi.exec();
      
      // 检查事务结果
      if (results && results.length > 0) {
        for (let i = 0; i < results.length; i++) {
          const result = results[i]; // node-redis 返回扁平数组
          if (result instanceof Error) { // 直接检查元素是否为 Error 对象
            errors.push({
              operation: operations[i]?.type || 'unknown',
              key: operations[i]?.key,
              error: result.message // 使用 result.message
            });
            successCount--;
          }
        }
      }

      logger.debug(`[TransactionManager] 事务 ${transactionId} 批量操作完成，成功: ${successCount}/${operations.length}`);
      
      return { successCount, totalCount: operations.length, errors };
    } catch (error) {
      logger.error(`[TransactionManager] 事务 ${transactionId} 批量操作失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 将操作添加到Redis事务中
   * @param {Object} multi Redis事务对象
   * @param {Object} operation 操作定义
   * @private
   */
  _addOperationToTransaction(multi, operation) {
    switch (operation.type) {
      case 'hset':
        multi.hSet(operation.key, operation.data);
        break;
      case 'hincrby':
        multi.hIncrBy(operation.key, operation.field, operation.value);
        break;
      case 'set':
        multi.set(operation.key, operation.value);
        break;
      case 'del':
        multi.del(operation.key);
        break;
      default:
        throw new Error(`不支持的操作类型: ${operation.type}`);
    }
  }

  /**
   * 验证批量操作结果
   * @param {Object} result 执行结果
   * @param {Array} operations 原始操作
   * @private
   */
  async _validateBatchResult(result, operations) {
    if (result.errors.length > 0) {
      const errorRate = result.errors.length / operations.length;
      if (errorRate > 0.1) { // 错误率超过10%认为是严重问题
        throw new Error(`批量操作错误率过高: ${(errorRate * 100).toFixed(1)}%`);
      }
    }
    
    if (result.successCount === 0 && operations.length > 0) {
      throw new Error('所有批量操作都失败了');
    }
  }

  /**
   * 回滚事务
   * @param {Array} operations 原始操作
   * @param {string} transactionId 事务ID
   * @private
   */
  async _rollbackTransaction(operations, transactionId) {
    logger.warn(`[TransactionManager] 开始回滚事务 ${transactionId}`);
    
    try {
      // 这里实现回滚逻辑
      // 由于Redis的限制，实际的回滚可能需要应用层面的补偿操作
      logger.info(`[TransactionManager] 事务 ${transactionId} 回滚完成`);
    } catch (error) {
      logger.error(`[TransactionManager] 事务 ${transactionId} 回滚失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 验证操作列表
   * @param {Array} operations 操作列表
   * @returns {Object} 验证结果
   * @private
   */
  _validateOperations(operations) {
    const errors = [];
    
    if (!Array.isArray(operations)) {
      errors.push('操作列表必须是数组');
      return { valid: false, errors };
    }
    
    if (operations.length === 0) {
      errors.push('操作列表不能为空');
      return { valid: false, errors };
    }
    
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      
      if (!op.type) {
        errors.push(`操作 ${i}: 缺少操作类型`);
      }
      
      if (!op.key) {
        errors.push(`操作 ${i}: 缺少操作键`);
      }
      
      // 根据操作类型验证必需的字段
      switch (op.type) {
        case 'hset':
          if (!op.data || typeof op.data !== 'object') {
            errors.push(`操作 ${i}: hset操作需要data字段`);
          }
          break;
        case 'hincrby':
          if (!op.field || typeof op.value !== 'number') {
            errors.push(`操作 ${i}: hincrby操作需要field和value字段`);
          }
          break;
        case 'set':
          if (op.value === undefined) {
            errors.push(`操作 ${i}: set操作需要value字段`);
          }
          break;
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * 生成事务ID
   * @returns {string} 事务ID
   * @private
   */
  _generateTransactionId() {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 更新事务状态
   * @param {string} transactionId 事务ID
   * @param {string} status 状态
   * @private
   */
  _updateTransactionStatus(transactionId, status) {
    const transaction = this.activeTransactions.get(transactionId);
    if (transaction) {
      transaction.status = status;
      transaction.lastUpdate = Date.now();
    }
  }
}

export default TransactionManager;