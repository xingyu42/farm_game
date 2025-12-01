/**
 * Redis客户端工具类
 * 提供分布式锁、TTL管理、原子计数器等核心功能
 *
 * Hash操作使用说明：
 * - 仅用于非玩家数据的临时状态管理（如市场统计、全局计数器）
 * - 禁止用于玩家核心数据（资产、状态等），玩家数据请使用YAML存储
 *
 * 锁系统功能：
 * - 可重入锁：同一调用链内对同一用户的重复加锁会被检测并跳过
 * - 批量锁：支持对多个用户按固定顺序批量获取锁，避免死锁
 * - 锁续租：长耗时操作自动续租，避免锁过期
 */

import { AsyncLocalStorage } from 'node:async_hooks';
// 为了通过 ESLint 且兼容 Node 全局：从 globalThis 读取 AbortController 引用
const AbortController = globalThis.AbortController;

class RedisClient {
  constructor() {
    // 直接使用Miao-Yunzai框架提供的Redis连接
    this.client = global.redis;
    this.defaultLockTTL = 60; // 默认锁60秒过期（增加以支持长链路）

    // 可重入锁上下文存储
    this.lockContext = new AsyncLocalStorage();

    // 续租任务管理
    this.renewalTasks = new Map(); // lockKey -> { timer, abortController }

    // 锁统计指标（可扩展为完整监控）
    this.lockStats = {
      acquired: 0,
      released: 0,
      renewed: 0,
      failed: 0,
      reentrant: 0
    };
  }

  /**
   * 检查Redis连接是否可用
   * @returns {boolean} 连接状态
   */
  isConnected() {
    return this.client && this.client.isReady;
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
      if (typeof ttl === 'number') {
        await this.client.setEx(key, ttl, serializedValue);
      } else if (typeof ttl === 'object' && ttl !== null && typeof ttl.EX === 'number') {
        await this.client.setEx(key, ttl.EX, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }
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
   * @param {string} operation 操作类型（用于统计，但不影响互斥域）
   * @returns {string} 锁Key
   */
  generateLockKey(userId, _operation = 'general') {
    // 统一使用用户ID作为互斥域，避免多把锁冲突
    return `farm_game:lock:user:${userId}`;
  }

  /**
   * 获取当前锁上下文
   * @returns {Object|null} 锁上下文
   */
  _getLockContext() {
    return this.lockContext.getStore();
  }

  /**
   * 检查是否已持有指定用户的锁（可重入检查）
   * @param {string} userId 用户ID
   * @returns {boolean} 是否已持锁
   */
  _isLockHeld(userId) {
    const context = this._getLockContext();
    return context && context.heldLocks && context.heldLocks.has(userId);
  }

  /**
   * 在上下文中标记锁已持有
   * @param {string} userId 用户ID
   */
  _markLockHeld(userId) {
    const context = this._getLockContext();
    if (context && context.heldLocks) {
      context.heldLocks.add(userId);
    }
  }

  /**
   * 在上下文中标记锁已释放
   * @param {string} userId 用户ID
   */
  _markLockReleased(userId) {
    const context = this._getLockContext();
    if (context && context.heldLocks) {
      context.heldLocks.delete(userId);
    }
  }

  /**
   * 确保锁上下文存在，如不存在则创建
   */
  _ensureLockContext() {
    let context = this._getLockContext();
    if (!context) {
      // 创建新的上下文并运行
      context = {
        sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        heldLocks: new Set(),
        startTime: Date.now()
      };
      logger.debug('[RedisClient] 检测到缺失锁上下文，已自动创建');
      return this.lockContext.run(context, () => context);
    }
    return context;
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
   * 续租分布式锁
   * @param {string} lockKey 锁Key
   * @param {string} lockValue 锁值
   * @param {number} extendSeconds 延长时间（秒）
   * @returns {Promise<boolean>} 续租结果
   */
  async extendLock(lockKey, lockValue, extendSeconds) {
    try {
      // 使用Lua脚本确保原子性续租
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.client.eval(luaScript, { keys: [lockKey], arguments: [lockValue, extendSeconds] });
      const success = result === 1;

      if (success) {
        this.lockStats.renewed++;
      }

      return success;
    } catch (error) {
      logger.warn(`[RedisClient] 续租锁失败 ${lockKey}: ${error.message}`);
      return false;
    }
  }

  /**
   * 启动锁续租看门狗
   * @param {string} lockKey 锁Key
   * @param {string} lockValue 锁值
   * @param {number} ttl 锁TTL（秒）
   * @private
   */
  _startLockRenewal(lockKey, lockValue, ttl) {
    // 在TTL的50%时开始续租，添加抖动避免惊群
    const renewalInterval = (ttl * 0.5 + Math.random() * ttl * 0.1) * 1000;
    const abortController = new AbortController();

    const timer = setTimeout(async () => {
      if (abortController.signal.aborted) return;

      try {
        const success = await this.extendLock(lockKey, lockValue, ttl);
        if (success && !abortController.signal.aborted) {
          // 续租成功，继续下一轮
          this._startLockRenewal(lockKey, lockValue, ttl);
        } else if (!success) {
          logger.warn(`[RedisClient] 锁续租失败，可能已被释放: ${lockKey}`);
        }
      } catch (error) {
        logger.error(`[RedisClient] 锁续租异常: ${error.message}`);
      }
    }, renewalInterval);

    this.renewalTasks.set(lockKey, { timer, abortController });
  }

  /**
   * 停止锁续租看门狗
   * @param {string} lockKey 锁Key
   * @private
   */
  _stopLockRenewal(lockKey) {
    const task = this.renewalTasks.get(lockKey);
    if (task) {
      task.abortController.abort();
      clearTimeout(task.timer);
      this.renewalTasks.delete(lockKey);
    }
  }

  /**
   * 释放分布式锁
   * @param {string} lockKey 锁Key
   * @param {string} lockValue 锁值
   * @returns {Promise<boolean>} 释放结果
   */
  async releaseLock(lockKey, lockValue) {
    try {
      // 停止续租
      this._stopLockRenewal(lockKey);

      // 使用Lua脚本确保原子性释放锁
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.client.eval(luaScript, { keys: [lockKey], arguments: [lockValue] });
      const success = result === 1;

      if (success) {
        this.lockStats.released++;
      }

      return success;
    } catch (error) {
      // 改进：释放失败仅记录告警，不抛出异常覆盖业务错误
      logger.error(`[RedisClient] 释放锁失败 ${lockKey}: ${error.message}`);
      return false;
    }
  }

  /**
   * 使用分布式锁执行操作（支持可重入）
   * @param {string} userId 用户ID
   * @param {Function} operation 要执行的操作函数
   * @param {string} operationType 操作类型
   * @param {number} lockTTL 锁过期时间
   * @returns {Promise<any>} 操作结果
   */
  async withLock(userId, operation, operationType = 'general', lockTTL = this.defaultLockTTL) {
    // 当外层未建立锁上下文时，这里自动创建并在该上下文中重新进入 withLock
    const existingContext = this._getLockContext();
    if (!existingContext) {
      const context = {
        sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        heldLocks: new Set(),
        startTime: Date.now()
      };
      return this.lockContext.run(context, async () => {
        return await this.withLock(userId, operation, operationType, lockTTL);
      });
    }

    const startTime = Date.now();
    let success = false;

    try {
      // 确保上下文存在
      this._ensureLockContext();

      // 检查可重入：如果已持有该用户的锁，直接执行操作
      if (this._isLockHeld(userId)) {
        this.lockStats.reentrant++;
        logger.debug(`[RedisClient] 可重入锁检测: ${userId}, 操作: ${operationType}`);
        const result = await operation();
        success = true;
        return result;
      }

      const lockResult = await this.acquireLock(userId, operationType, lockTTL);

      if (!lockResult.success) {
        this.lockStats.failed++;
        throw new Error(`无法获取锁: ${lockResult.error}`);
      }

      // 标记锁已持有
      this._markLockHeld(userId);
      this.lockStats.acquired++;

      // 启动续租看门狗（TTL >= 30s 时启用）
      if (lockTTL >= 30) {
        this._startLockRenewal(lockResult.lockKey, lockResult.lockValue, lockTTL);
      }

      try {
        // 执行操作
        const result = await operation();
        success = true;
        return result;
      } finally {
        // 标记锁已释放
        this._markLockReleased(userId);

        // 释放锁（内部已处理续租停止）
        const released = await this.releaseLock(lockResult.lockKey, lockResult.lockValue);
        if (!released) {
          logger.warn(`[RedisClient] 锁释放失败但不影响业务: ${lockResult.lockKey}`);
        }
      }
    } finally {
      // 记录性能指标
      const duration = Date.now() - startTime;
      this._recordMetrics(`withLock_${operationType}`, duration, success);
    }
  }

  /**
   * 批量获取多个用户的锁（按固定顺序，避免死锁）
   * @param {Array<string>} userIds 用户ID数组
   * @param {Function} operation 要执行的操作函数
   * @param {string} operationType 操作类型
   * @param {number} lockTTL 锁过期时间
   * @returns {Promise<any>} 操作结果
   */
  async withUserLocks(userIds, operation, operationType = 'batch_operation', lockTTL = this.defaultLockTTL) {
    // 当外层未建立锁上下文时，这里自动创建并在该上下文中重新进入 withUserLocks
    const existingContext = this._getLockContext();
    if (!existingContext) {
      const context = {
        sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        heldLocks: new Set(),
        startTime: Date.now()
      };
      return this.lockContext.run(context, async () => {
        return await this.withUserLocks(userIds, operation, operationType, lockTTL);
      });
    }

    const startTime = Date.now();
    let success = false;

    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw new Error('用户ID数组不能为空');
      }

      // 确保上下文存在
      this._ensureLockContext();

      // 去重并排序，确保锁获取顺序一致
      const uniqueUserIds = [...new Set(userIds)].sort();
      const acquiredLocks = [];
      const alreadyHeld = [];

      try {
        // 按顺序获取锁
        for (const userId of uniqueUserIds) {
          if (this._isLockHeld(userId)) {
            // 已持有的锁，记录但不重复获取
            alreadyHeld.push(userId);
            this.lockStats.reentrant++;
            continue;
          }

          const lockResult = await this.acquireLock(userId, operationType, lockTTL);
          if (!lockResult.success) {
            this.lockStats.failed++;
            throw new Error(`无法获取用户 ${userId} 的锁: ${lockResult.error}`);
          }

          // 标记锁已持有并记录
          this._markLockHeld(userId);
          acquiredLocks.push({
            userId,
            lockKey: lockResult.lockKey,
            lockValue: lockResult.lockValue,
            ttl: lockTTL
          });
          this.lockStats.acquired++;

          // 启动续租（TTL >= 30s 时）
          if (lockTTL >= 30) {
            this._startLockRenewal(lockResult.lockKey, lockResult.lockValue, lockTTL);
          }
        }

        logger.debug(`[RedisClient] 批量锁获取完成: 新获取${acquiredLocks.length}个, 重入${alreadyHeld.length}个`);

        // 执行操作
        const result = await operation();
        success = true;
        return result;

      } catch (error) {
        // 获取锁失败时，释放已获取的锁
        logger.error(`[RedisClient] 批量锁获取失败: ${error.message}`);
        throw error;
      } finally {
        // 释放所有新获取的锁（逆序释放）
        for (let i = acquiredLocks.length - 1; i >= 0; i--) {
          const lock = acquiredLocks[i];
          this._markLockReleased(lock.userId);

          const released = await this.releaseLock(lock.lockKey, lock.lockValue);
          if (!released) {
            logger.warn(`[RedisClient] 批量释放锁失败但不影响业务: ${lock.lockKey}`);
          }
        }
      }
    } finally {
      // 记录性能指标
      const duration = Date.now() - startTime;
      this._recordMetrics(`withUserLocks_${operationType}`, duration, success);
    }
  }

  /**
   * 在锁上下文中运行操作（业务入口使用）
   * @param {Function} operation 要执行的操作函数
   * @param {Object} options 选项
   * @returns {Promise<any>} 操作结果
   */
  async runWithLockContext(operation, options = {}) {
    const context = {
      sessionId: options.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      heldLocks: new Set(),
      startTime: Date.now()
    };

    return this.lockContext.run(context, operation);
  }

  /**
   * 记录锁性能指标（可扩展对接监控系统）
   * @param {string} operation 操作类型
   * @param {number} duration 耗时(ms)
   * @param {boolean} success 是否成功
   * @private
   */
  _recordMetrics(operation, duration, success) {
    // 基础日志记录
    if (duration > 1000) { // 超过1秒的操作记录告警
      logger.warn(`[RedisClient] 锁操作耗时过长: ${operation}, 耗时: ${duration}ms, 成功: ${success}`);
    }

    // 这里可以扩展对接Prometheus、StatsD等监控系统
    // 例如:
    // prometheus.histogram('lock_operation_duration', { operation, success }).observe(duration);
    // statsd.timing('lock.operation.duration', duration, { operation, success });
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

  // ==========================================
  // List操作方法 - 用于有序数据存储（如历史记录）
  // ==========================================

  /**
   * 将元素推入列表头部
   * @param {string} key Redis List Key
   * @param {...string} values 要推入的值
   * @returns {Promise<number>} 推入后列表长度
   */
  async lPush(key, ...values) {
    try {
      return await this.client.lPush(key, ...values);
    } catch (error) {
      throw new Error(`List push failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 裁剪列表，只保留指定范围内的元素
   * @param {string} key Redis List Key
   * @param {number} start 起始索引
   * @param {number} stop 结束索引
   * @returns {Promise<string>} 操作结果
   */
  async lTrim(key, start, stop) {
    try {
      return await this.client.lTrim(key, start, stop);
    } catch (error) {
      throw new Error(`List trim failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 获取列表长度
   * @param {string} key Redis List Key
   * @returns {Promise<number>} 列表长度
   */
  async lLen(key) {
    try {
      return await this.client.lLen(key);
    } catch (error) {
      throw new Error(`List length failed for key ${key}: ${error.message}`, { cause: error });
    }
  }

  /**
   * 获取列表指定范围内的元素
   * @param {string} key Redis List Key
   * @param {number} start 起始索引
   * @param {number} stop 结束索引（-1 表示到末尾）
   * @returns {Promise<Array<string>>} 元素数组
   */
  async lRange(key, start, stop) {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      throw new Error(`List range failed for key ${key}: ${error.message}`, { cause: error });
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