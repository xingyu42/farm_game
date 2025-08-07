/**
 * 任务调度器 - 统一调度、配置、执行职责
 * 
 * 整合了 SimpleTaskScheduler、TaskConfig、TaskExecutor 的功能
 * 专注于：配置解析、任务调度、分布式锁、重试机制
 * 
 * @version 1.0.0
 */

export class TaskScheduler {
    constructor({ marketService, lockManager, rawConfig }) {
        this.marketService = marketService;
        this.lockManager = lockManager;

        // 解析配置
        this._parseConfig(rawConfig);

        // 调度器状态
        this.jobs = new Map();
        this.isRunning = false;
        // 新增：用于跟踪每日任务的最后执行日期
        this.lastResetDate = null;

        // 任务映射表 - 原 TaskExecutor 逻辑
        this.taskMapping = {
            priceUpdate: () => this.marketService.updateDynamicPrices(),
            statsReset: () => this.marketService.resetDailyStats(),
            monitoring: () => this.marketService.monitorMarket()
        };
    }

    /**
     * 解析并验证配置 - 原 TaskConfig 逻辑
     * @param {Object} rawConfig 原始配置对象
     * @private
     */
    _parseConfig(rawConfig) {
        const errors = [];
        const schedulerConfig = rawConfig.market?.scheduler;

        // 验证调度器配置
        if (!schedulerConfig) {
            errors.push('缺少调度器配置');
        } else {
            if (typeof schedulerConfig.task_timeout !== 'number' || schedulerConfig.task_timeout <= 0) {
                errors.push('task_timeout必须是正数');
            }
            if (typeof schedulerConfig.retry_attempts !== 'number' || schedulerConfig.retry_attempts < 0) {
                errors.push('retry_attempts必须是非负数');
            }
            if (typeof schedulerConfig.max_concurrent_tasks !== 'number' || schedulerConfig.max_concurrent_tasks <= 0) {
                errors.push('max_concurrent_tasks必须是正数');
            }
        }

        // 验证任务定义
        const tasks = schedulerConfig?.tasks || [];
        tasks.forEach((task, index) => {
            if (!task.name || typeof task.name !== 'string') {
                errors.push(`任务${index}: name必须是非空字符串`);
            }
            if (typeof task.interval !== 'number' || task.interval <= 0) {
                errors.push(`任务${task.name || index}: interval必须是正数`);
            }
            if (typeof task.timeout !== 'number' || task.timeout <= 0) {
                errors.push(`任务${task.name || index}: timeout必须是正数`);
            }
            if (typeof task.retry_attempts !== 'number' || task.retry_attempts < 0) {
                errors.push(`任务${task.name || index}: retry_attempts必须是非负数`);
            }
            if (typeof task.enabled !== 'boolean') {
                errors.push(`任务${task.name || index}: enabled必须是布尔值`);
            }
        });

        if (errors.length > 0) {
            logger.warn('[TaskScheduler] 配置验证失败', { errors });
        }

        // 保存配置
        this.schedulerConfig = schedulerConfig || {};
        this.taskDefinitions = tasks.filter(task => task.enabled);
    }

    /**
     * 启动调度器 - 原 SimpleTaskScheduler.start 逻辑
     */
    start() {
        if (this.isRunning) {
            logger.warn('[TaskScheduler] 调度器已在运行中');
            return;
        }

        logger.info(`[TaskScheduler] 启动调度器，任务数量: ${this.taskDefinitions.length}`);
        this.taskDefinitions.forEach(task => this._scheduleTask(task));
        this.isRunning = true;
        logger.info(`[TaskScheduler] 调度器启动成功，活跃任务: ${Array.from(this.jobs.keys()).join(', ')}`);
    }

    /**
     * 停止调度器 - 原 SimpleTaskScheduler.stop 逻辑
     */
    stop() {
        logger.info('[TaskScheduler] 停止调度器');
        for (const [taskName, interval] of this.jobs) {
            clearInterval(interval);
            logger.debug(`[TaskScheduler] 停止任务: ${taskName}`);
        }
        this.jobs.clear();
        this.isRunning = false;
        logger.info('[TaskScheduler] 调度器已停止');
    }

    /**
     * 调度单个任务 - 原 SimpleTaskScheduler._scheduleTask 逻辑
     * @param {Object} taskDef 任务定义
     * @private
     */
    _scheduleTask(taskDef) {
        const job = setInterval(async () => {
            // statsReset 任务特殊处理：确保每天只执行一次
            if (taskDef.name === 'statsReset') {
                const now = new Date();
                const today = now.toDateString(); // 获取今天的日期字符串

                // 如果今天已经执行过，则跳过
                if (this.lastResetDate === today) {
                    return;
                }

                // 标记为今天已执行（在执行前设置，防止重复执行）
                this.lastResetDate = today;
            }

            await this._execute(taskDef.name, taskDef.timeout);
        }, taskDef.interval * 1000);

        this.jobs.set(taskDef.name, job);
    }

    /**
     * 执行任务（加锁+超时保护） - 原 SimpleTaskScheduler.executeTask 逻辑
     * @param {string} taskName 任务名称
     * @param {number} timeout 超时时间
     * @returns {Promise<any>} 执行结果
     * @private
     */
    async _execute(taskName, timeout) {
        const lockKey = this.lockManager.generateKey('scheduler', taskName);
        return await this.lockManager.withLock(lockKey, async () => {
            logger.info(`[TaskScheduler] 开始执行任务: ${taskName}`);
            const startTime = this._getCurrentTime();

            try {
                const result = await this._executeWithRetry(taskName, timeout);
                const duration = this._getCurrentTime() - startTime;
                logger.info(`[TaskScheduler] 任务完成: ${taskName}, 耗时: ${duration}ms`);
                return result;
            } catch (error) {
                const duration = this._getCurrentTime() - startTime;
                logger.error(`[TaskScheduler] 任务失败: ${taskName}, 耗时: ${duration}ms`, { error: error.message });
                throw error;
            }
        }, 'scheduler_task', timeout + 5);
    }

    /**
     * 带重试机制的任务执行 - 原 TaskExecutor._executeWithRetry 逻辑
     * @param {string} taskName 任务名称
     * @param {number} timeout 超时时间
     * @returns {Promise<any>} 执行结果
     * @private
     */
    async _executeWithRetry(taskName, timeout) {
        const taskFn = this.taskMapping[taskName];
        if (!taskFn) {
            throw new Error(`Unknown task: ${taskName}`);
        }

        const maxAttempts = this.schedulerConfig.retry_attempts || 2;
        const retryDelay = 1000; // 1秒线性退避

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                logger.debug(`[TaskScheduler] 执行任务 ${taskName}, 尝试 ${attempt}/${maxAttempts}`);

                // 超时保护
                const result = await this._executeWithTimeout(taskFn, timeout * 1000);

                if (attempt > 1) {
                    logger.info(`[TaskScheduler] 任务 ${taskName} 重试成功，尝试次数: ${attempt}`);
                }
                return result;
            } catch (error) {
                const isLastAttempt = attempt === maxAttempts;

                if (isLastAttempt) {
                    logger.error(`[TaskScheduler] 任务 ${taskName} 最终失败，已尝试 ${attempt} 次`, { error: error.message });
                    throw error;
                }

                if (this._shouldRetry(error, attempt)) {
                    logger.warn(`[TaskScheduler] 任务 ${taskName} 第 ${attempt} 次尝试失败，${retryDelay}ms后重试`, { error: error.message });
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    logger.error(`[TaskScheduler] 任务 ${taskName} 遇到不可重试错误`, { error: error.message });
                    throw error;
                }
            }
        }
    }

    /**
     * 超时执行保护 - 原 SimpleTaskScheduler._executeWithTimeout 逻辑
     * @param {Function} taskFunction 任务函数
     * @param {number} timeout 超时时间
     * @returns {Promise<any>} 执行结果
     * @private
     */
    async _executeWithTimeout(taskFunction, timeout) {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Task timeout after ${timeout}s`)), timeout * 1000);
        });
        return Promise.race([taskFunction(), timeoutPromise]);
    }

    /**
     * 判断是否应该重试 - 原 TaskExecutor._shouldRetry 逻辑
     * @param {Error} error 错误对象
     * @param {number} attempt 当前尝试次数
     * @returns {boolean} 是否应该重试
     * @private
     */
    _shouldRetry(error, attempt) {
        // 简单的重试条件：网络错误、超时错误、临时性错误
        const retryableErrors = ['timeout', 'network', 'econnreset', 'etimedout'];
        const errorMessage = error.message.toLowerCase();
        return retryableErrors.some(keyword => errorMessage.includes(keyword));
    }

    /**
     * 获取任务定义列表 - 保持向后兼容
     * @returns {Array<Object>} 任务定义数组
     */
    getTaskDefinitions() {
        return this.taskDefinitions.filter(task => task.enabled);
    }

    /**
 * 根据任务名称获取任务定义 - 保持向后兼容
 * @param {string} taskName 任务名称
 * @returns {Object|null} 任务定义或null
 */
    getTaskDefinition(taskName) {
        return this.taskDefinitions.find(task => task.name === taskName) || null;
    }

    /**
     * 获取当前时间戳 - 便于测试时mock
     * @returns {number} 当前时间戳
     * @private
     */
    _getCurrentTime() {
        return Date.now();
    }
}

export default TaskScheduler;