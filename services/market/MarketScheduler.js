/**
 * 增强版市场定时任务调度器
 *
 * 负责价格更新、统计重置、监控告警等定时任务。
 * 新增功能：
 * 1. Redis分布式锁保护机制，防止任务重叠执行
 * 2. 任务超时控制和强制终止
 * 3. 任务执行状态监控和性能指标
 * 4. 增强的错误处理和重试机制
 * 5. 标准化日志系统集成
 *
 * @version 2.0.0 - 增强版，解决任务重叠和质量问题
 */

export class MarketScheduler {
  constructor(marketService, redisClient, config = null, logger = null) {
    this.marketService = marketService;
    this.redis = redisClient;
    this.config = config;
    this.jobs = new Map();
    this.taskStates = new Map();
    this.isRunning = false;

    // 创建标准化日志器
    this.logger = logger;

    // 获取调度器配置
    const schedulerConfig = this.config.market.scheduler;
    this.maxConcurrentTasks = schedulerConfig.max_concurrent_tasks;
    this.defaultTimeout = schedulerConfig.task_timeout;
    this.retryAttempts = schedulerConfig.retry_attempts;
    this.lockTTL = schedulerConfig.lock_ttl;

    // 运行时统计
    this.stats = {
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0
    };
  }

  /**
   * 启动所有定时任务（增强版本）
   */
  start() {
    if (this.isRunning) {
      this.logger.warn('调度器已在运行中，忽略启动请求');
      return;
    }

    try {
      this.logger.info('正在启动市场任务调度器...');

      // 获取更新间隔配置
      const updateInterval = this.config.market.update.interval * 1000;
      const monitoringInterval = 15 * 60 * 1000; // 15分钟
      const statsResetCheckInterval = 60 * 1000; // 每分钟检查统计重置

      // 价格更新任务（每小时执行，带保护机制）
      const priceUpdateJob = setInterval(async () => {
        await this.executeWithProtection('priceUpdate', async () => {
          return await this.marketService.updateDynamicPrices();
        }, this.defaultTimeout);
      }, updateInterval);

      // 统计重置任务（每天午夜执行，带保护机制）
      const statsResetJob = setInterval(async () => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
          await this.executeWithProtection('statsReset', async () => {
            return await this.marketService.resetDailyStats();
          }, this.defaultTimeout);
        }
      }, statsResetCheckInterval);

      // 市场监控任务（每15分钟执行，带保护机制）
      const monitoringJob = setInterval(async () => {
        await this.executeWithProtection('monitoring', async () => {
          return await this.marketService.monitorMarket();
        }, this.defaultTimeout);
      }, monitoringInterval);

      // 清理任务（每小时清理过期的任务状态）
      const cleanupJob = setInterval(async () => {
        await this.executeWithProtection('cleanup', async () => {
          return await this._cleanupExpiredTaskStates();
        }, 60000); // 1分钟超时
      }, 60 * 60 * 1000);

      // 保存任务引用
      this.jobs.set('priceUpdate', priceUpdateJob);
      this.jobs.set('statsReset', statsResetJob);
      this.jobs.set('monitoring', monitoringJob);
      this.jobs.set('cleanup', cleanupJob);

      this.isRunning = true;
      this.logger.info(`任务调度器启动成功，活跃任务: ${Array.from(this.jobs.keys()).join(', ')}`);

      // 记录配置信息
      this.logger.info('调度器配置', {
        updateInterval: updateInterval / 1000,
        defaultTimeout: this.defaultTimeout / 1000,
        maxConcurrentTasks: this.maxConcurrentTasks,
        retryAttempts: this.retryAttempts
      });

      // 延迟执行首次价格更新（避免启动时的资源竞争）
      setTimeout(() => {
        this.executeWithProtection('initialPriceUpdate', async () => {
          return await this.marketService.updateDynamicPrices();
        }, this.defaultTimeout).catch(error => {
          this.logger.warn('初始价格更新失败', { error: error.message });
        });
      }, 5000);

    } catch (error) {
      this.logger.error('启动定时任务失败', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * 停止所有定时任务（增强版本）
   */
  stop() {
    try {
      this.logger.info('正在停止市场任务调度器...');

      // 清除所有定时器
      for (const [taskName, interval] of this.jobs) {
        clearInterval(interval);
        this.logger.debug(`停止定时任务: ${taskName}`);
      }

      this.jobs.clear();
      this.taskStates.clear();
      this.isRunning = false;

      this.logger.info('任务调度器已停止');

      // 记录统计信息
      this.logger.info('调度器运行统计', {
        tasksExecuted: this.stats.tasksExecuted,
        tasksSucceeded: this.stats.tasksSucceeded,
        tasksFailed: this.stats.tasksFailed,
        successRate: this.stats.tasksExecuted > 0 ?
          ((this.stats.tasksSucceeded / this.stats.tasksExecuted) * 100).toFixed(2) + '%' : 'N/A',
        averageExecutionTime: this.stats.averageExecutionTime.toFixed(2) + 'ms'
      });

    } catch (error) {
      this.logger.error('停止定时任务失败', { error: error.message, stack: error.stack });
    }
  }

  /**
   * 带保护机制的任务执行
   * 
   * 核心功能：实现分布式锁、超时控制、状态监控的任务执行框架
   * 
   * @param {string} taskName - 任务名称
   * @param {Function} taskFunction - 任务执行函数
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<any>} 任务执行结果
   */
  async executeWithProtection(taskName, taskFunction, timeout = this.defaultTimeout) {
    const lockKey = `scheduler:lock:${taskName}`;
    const stateKey = `scheduler:state:${taskName}`;
    const startTime = Date.now();

    let lockAcquired = false;

    try {
      // 检查并发任务限制
      const runningTasks = Array.from(this.taskStates.values())
        .filter(state => state.status === 'running').length;

      if (runningTasks >= this.maxConcurrentTasks) {
        this.logger.warn(`任务 ${taskName} 跳过：已达到最大并发数 ${this.maxConcurrentTasks}`);
        return { success: false, reason: 'max_concurrent_reached' };
      }

      // 尝试获取分布式锁
      lockAcquired = await this.acquireTaskLock(lockKey, timeout);
      if (!lockAcquired) {
        this.logger.warn(`任务 ${taskName} 跳过：获取锁失败，可能正在执行中`);
        return { success: false, reason: 'lock_acquisition_failed' };
      }

      // 设置任务开始状态
      await this.setTaskState(stateKey, {
        status: 'running',
        startTime: Date.now(),
        pid: process.pid,
        timeout: timeout
      });

      this.taskStates.set(taskName, { status: 'running', startTime: Date.now() });

      this.logger.info(`任务开始执行: ${taskName}`);

      // 创建超时Promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Task timeout after ${timeout}ms`)), timeout);
      });

      // 执行任务（带超时控制）
      const result = await Promise.race([
        this._executeTaskWithRetry(taskFunction, taskName),
        timeoutPromise
      ]);

      const duration = Date.now() - startTime;
      this.logger.info(`任务 ${taskName} 执行完成，耗时: ${duration}ms`);

      // 更新成功状态
      await this.setTaskState(stateKey, {
        status: 'completed',
        lastSuccess: Date.now(),
        duration,
        result: JSON.stringify(result),
        pid: process.pid
      });

      this.taskStates.set(taskName, { status: 'completed', duration });

      // 更新统计信息
      this._updateStats(true, duration);

      this.logger.info(`任务完成: ${taskName}`, {
        duration: `${duration}ms`,
        result: result
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(`任务执行失败: ${taskName}`, {
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });

      // 更新失败状态
      await this.setTaskState(stateKey, {
        status: 'failed',
        lastError: error.message,
        lastFailure: Date.now(),
        duration,
        pid: process.pid
      });

      this.taskStates.set(taskName, { status: 'failed', error: error.message });

      // 更新统计信息
      this._updateStats(false, duration);

      // 根据错误类型决定是否需要告警
      await this.handleTaskFailure(taskName, error);

      throw error;

    } finally {
      // 确保释放锁
      if (lockAcquired) {
        await this.releaseTaskLock(lockKey);
      }
    }
  }

  /**
   * 获取分布式任务锁
   * 
   * 使用Redis实现分布式锁，防止任务重叠执行
   * 
   * @param {string} lockKey - 锁键名
   * @param {number} timeout - 锁超时时间
   * @returns {Promise<boolean>} 是否获取成功
   */
  async acquireTaskLock(lockKey, timeout) {
    try {
      const lockValue = `${process.pid}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const lockTTL = Math.max(timeout + 5000, this.lockTTL); // 锁超时比任务超时稍长

      const result = await this.redis.set(
        lockKey,
        lockValue,
        'PX',
        lockTTL,
        'NX'
      );

      const acquired = result === 'OK';

      if (acquired) {
        this.logger.debug(`获取任务锁成功: ${lockKey}`, { lockValue, lockTTL });
      } else {
        // 检查现有锁的信息
        const existingLock = await this.redis.get(lockKey);
        this.logger.debug(`获取任务锁失败: ${lockKey}`, { existingLock });
      }

      return acquired;
    } catch (error) {
      this.logger.error('获取任务锁异常', { lockKey, error: error.message });
      return false;
    }
  }

  /**
   * 释放任务锁
   * 
   * @param {string} lockKey - 锁键名
   */
  async releaseTaskLock(lockKey) {
    try {
      await this.redis.del(lockKey);
      this.logger.debug(`释放任务锁: ${lockKey}`);
    } catch (error) {
      this.logger.error('释放任务锁失败', { lockKey, error: error.message });
    }
  }

  /**
   * 设置任务状态
   * 
   * @param {string} stateKey - 状态键名
   * @param {Object} state - 状态信息
   */
  async setTaskState(stateKey, state) {
    try {
      // 添加时间戳
      const stateWithTimestamp = {
        ...state,
        updatedAt: Date.now()
      };

      await this.redis.hSet(stateKey, stateWithTimestamp);
      await this.redis.expire(stateKey, 24 * 60 * 60); // 24小时过期

    } catch (error) {
      this.logger.error('设置任务状态失败', { stateKey, error: error.message });
    }
  }

  /**
   * 获取任务状态
   * 
   * @param {string} taskName - 任务名称
   * @returns {Promise<Object>} 任务状态
   */
  async getTaskState(taskName) {
    try {
      const stateKey = `scheduler:state:${taskName}`;
      const state = await this.redis.hGetAll(stateKey);
      return Object.keys(state).length > 0 ? state : null;
    } catch (error) {
      this.logger.error('获取任务状态失败', { taskName, error: error.message });
      return null;
    }
  }

  /**
   * 任务重试执行
   * 
   * @param {Function} taskFunction - 任务函数
   * @param {string} taskName - 任务名称
   * @returns {Promise<any>} 执行结果
   * @private
   */
  async _executeTaskWithRetry(taskFunction, taskName) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.retryAttempts + 1; attempt++) {
      try {
        const result = await taskFunction();

        if (attempt > 1) {
          this.logger.info(`任务 ${taskName} 重试第 ${attempt - 1} 次成功`);
        }

        return result;

      } catch (error) {
        lastError = error;

        if (attempt <= this.retryAttempts) {
          const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 指数退避，最大30秒
          this.logger.warn(`任务 ${taskName} 第 ${attempt} 次尝试失败，${retryDelay}ms后重试`, {
            error: error.message,
            attempt,
            maxAttempts: this.retryAttempts + 1
          });

          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw lastError;
  }

  /**
   * 任务失败处理
   * 
   * @param {string} taskName - 任务名称
   * @param {Error} error - 错误对象
   */
  async handleTaskFailure(taskName, error) {
    const errorType = this._categorizeError(error);

    // 记录详细的错误信息
    this.logger.logError(error, {
      taskName,
      errorType,
      timestamp: Date.now()
    });

    // 根据错误类型和任务重要性决定处理策略
    if (errorType === 'timeout') {
      this.logger.warn(`任务 ${taskName} 超时，建议检查系统性能或调整超时配置`);
    } else if (errorType === 'network') {
      this.logger.warn(`任务 ${taskName} 网络连接失败，系统将在下次调度时重试`);
    } else if (errorType === 'critical') {
      this.logger.error(`任务 ${taskName} 发生严重错误，需要人工介入`, {
        error: error.message,
        stack: error.stack
      });
    }

    // 更新失败统计
    await this._recordTaskFailure(taskName, error, errorType);
  }

  /**
   * 清理过期的任务状态
   * 
   * @returns {Promise<Object>} 清理结果
   * @private
   */
  async _cleanupExpiredTaskStates() {
    try {
      const pattern = 'scheduler:state:*';
      const keys = await this.redis.keys(pattern);
      let cleanedCount = 0;

      for (const key of keys) {
        const state = await this.redis.hGetAll(key);
        const updatedAt = parseInt(state.updatedAt);
        const expireTime = 24 * 60 * 60 * 1000; // 24小时

        if (Date.now() - updatedAt > expireTime) {
          await this.redis.del(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.info(`清理了 ${cleanedCount} 个过期任务状态`);
      }

      return { success: true, cleanedCount };
    } catch (error) {
      this.logger.error('清理过期任务状态失败', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新统计信息
   * 
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时间
   * @private
   */
  _updateStats(success, duration) {
    this.stats.tasksExecuted++;
    this.stats.totalExecutionTime += duration;

    if (success) {
      this.stats.tasksSucceeded++;
    } else {
      this.stats.tasksFailed++;
    }

    this.stats.averageExecutionTime = this.stats.totalExecutionTime / this.stats.tasksExecuted;
  }

  /**
   * 错误分类
   * 
   * @param {Error} error - 错误对象
   * @returns {string} 错误类型
   * @private
   */
  _categorizeError(error) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return 'timeout';
    } else if (message.includes('redis') || message.includes('connection')) {
      return 'network';
    } else if (message.includes('permission') || message.includes('auth')) {
      return 'permission';
    } else if (message.includes('out of memory') || message.includes('disk')) {
      return 'resource';
    } else {
      return 'critical';
    }
  }

  /**
   * 记录任务失败
   * 
   * @param {string} taskName - 任务名称
   * @param {Error} error - 错误对象
   * @param {string} errorType - 错误类型
   * @private
   */
  async _recordTaskFailure(taskName, error, errorType) {
    try {
      const failureKey = `scheduler:failures:${taskName}`;
      const failureRecord = {
        timestamp: Date.now(),
        error: error.message,
        errorType,
        stack: error.stack
      };

      await this.redis.lPush(failureKey, JSON.stringify(failureRecord));
      await this.redis.lTrim(failureKey, 0, 9); // 只保留最近10次失败记录
      await this.redis.expire(failureKey, 7 * 24 * 60 * 60); // 7天过期
    } catch (err) {
      this.logger.error('记录任务失败信息异常', { error: err.message });
    }
  }

  /**
   * 重启定时任务（增强版本）
   */
  restart() {
    this.logger.info('正在重启任务调度器...');
    this.stop();

    // 等待清理完成后重新启动
    setTimeout(() => {
      this.start();
    }, 2000);
  }

  /**
   * 手动执行任务
   * 
   * @param {string} taskName - 任务名称
   * @returns {Promise<any>} 执行结果
   */
  async executeTask(taskName) {
    this.logger.info(`手动触发任务: ${taskName}`);

    const taskMapping = {
      'priceUpdate': () => this.marketService.updateDynamicPrices(),
      'statsReset': () => this.marketService.resetDailyStats(),
      'monitoring': () => this.marketService.monitorMarket()
    };

    const taskFunction = taskMapping[taskName];
    if (!taskFunction) {
      throw new Error(`未知任务: ${taskName}`);
    }

    return await this.executeWithProtection(`manual_${taskName}`, taskFunction, this.defaultTimeout);
  }

  /**
   * 获取调度器详细状态（增强版本）
   * 
   * @returns {Promise<Object>} 调度器状态
   */
  async getSchedulerStatus() {
    const status = {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      stats: { ...this.stats },
      taskStates: {},
      config: {
        maxConcurrentTasks: this.maxConcurrentTasks,
        defaultTimeout: this.defaultTimeout,
        retryAttempts: this.retryAttempts,
        lockTTL: this.lockTTL
      }
    };

    // 获取所有任务的详细状态
    for (const taskName of ['priceUpdate', 'statsReset', 'monitoring', 'cleanup']) {
      try {
        status.taskStates[taskName] = await this.getTaskState(taskName);
      } catch (error) {
        this.logger.error(`获取任务 ${taskName} 状态失败`, { error: error.message });
      }
    }

    return status;
  }

  /**
   * 获取任务失败历史
   * 
   * @param {string} taskName - 任务名称
   * @returns {Promise<Array>} 失败历史记录
   */
  async getTaskFailureHistory(taskName) {
    try {
      const failureKey = `scheduler:failures:${taskName}`;
      const failures = await this.redis.lRange(failureKey, 0, -1);

      return failures.map(failure => {
        try {
          return JSON.parse(failure);
        } catch {
          return { error: 'Invalid failure record', raw: failure };
        }
      });
    } catch (error) {
      this.logger.error(`获取任务 ${taskName} 失败历史异常`, { error: error.message });
      return [];
    }
  }

  /**
   * 健康检查
   * 
   * @returns {Promise<Object>} 健康状态
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      checks: {},
      timestamp: Date.now()
    };

    try {
      // 检查Redis连接
      await this.redis.ping();
      health.checks.redis = { status: 'ok', message: 'Redis connection healthy' };
    } catch (error) {
      health.status = 'unhealthy';
      health.checks.redis = { status: 'error', message: error.message };
    }

    // 检查调度器状态
    health.checks.scheduler = {
      status: this.isRunning ? 'ok' : 'stopped',
      activeJobs: this.jobs.size,
      message: this.isRunning ? 'Scheduler running' : 'Scheduler stopped'
    };

    // 检查任务执行情况
    const successRate = this.stats.tasksExecuted > 0 ?
      (this.stats.tasksSucceeded / this.stats.tasksExecuted) : 1;

    health.checks.taskExecution = {
      status: successRate >= 0.8 ? 'ok' : 'warning',
      successRate: (successRate * 100).toFixed(2) + '%',
      totalExecuted: this.stats.tasksExecuted,
      message: successRate >= 0.8 ? 'Task execution healthy' : 'Low task success rate'
    };

    return health;
  }
}

export default MarketScheduler;