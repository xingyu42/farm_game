/**
 * 简化任务调度器核心类 - 专注纯调度职责，80行以内
 */
export class SimpleTaskScheduler {
  constructor(taskConfig, lockManager) {
    this.taskConfig = taskConfig;
    this.lockManager = lockManager;
    this.jobs = new Map();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('[SimpleTaskScheduler] 调度器已在运行中');
      return;
    }
    const tasks = this.taskConfig.getTaskDefinitions();
    logger.info(`[SimpleTaskScheduler] 启动调度器，任务数量: ${tasks.length}`);
    tasks.forEach(task => this._scheduleTask(task));
    this.isRunning = true;
    logger.info(`[SimpleTaskScheduler] 调度器启动成功，活跃任务: ${Array.from(this.jobs.keys()).join(', ')}`);
  }

  stop() {
    logger.info('[SimpleTaskScheduler] 停止调度器');
    for (const [taskName, interval] of this.jobs) {
      clearInterval(interval);
      logger.debug(`[SimpleTaskScheduler] 停止任务: ${taskName}`);
    }
    this.jobs.clear();
    this.isRunning = false;
    logger.info('[SimpleTaskScheduler] 调度器已停止');
  }

  async executeTask(taskName, taskFunction, timeout) {
    const lockKey = `scheduler:${taskName}`;
    return await this.lockManager.withLock(lockKey, async () => {
      logger.info(`[SimpleTaskScheduler] 开始执行任务: ${taskName}`);
      const startTime = Date.now();
      try {
        const result = await this._executeWithTimeout(taskFunction, timeout);
        const duration = Date.now() - startTime;
        logger.info(`[SimpleTaskScheduler] 任务完成: ${taskName}, 耗时: ${duration}ms`);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`[SimpleTaskScheduler] 任务失败: ${taskName}, 耗时: ${duration}ms`, { error: error.message });
        throw error;
      }
    }, timeout + 5000);
  }

  _scheduleTask(taskDef) {
    const job = setInterval(async () => {
      if (taskDef.name === 'statsReset') {
        const now = new Date();
        if (now.getHours() !== 0 || now.getMinutes() !== 0) return;
      }
      this._onTaskTrigger?.(taskDef.name, taskDef.timeout);
    }, taskDef.interval);
    this.jobs.set(taskDef.name, job);
  }

  async _executeWithTimeout(taskFunction, timeout) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Task timeout after ${timeout}ms`)), timeout);
    });
    return Promise.race([taskFunction(), timeoutPromise]);
  }
}
