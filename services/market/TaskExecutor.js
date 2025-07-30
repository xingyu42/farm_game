/**
 * 任务执行器 - 专注任务执行职责，60行以内
 */
export class TaskExecutor {
  constructor(marketService, config) {
    this.marketService = marketService;
    this.config = config;
    this.taskMapping = {
      'priceUpdate': () => this.marketService.updateDynamicPrices(),
      'statsReset': () => this.marketService.resetDailyStats(),
      'monitoring': () => this.marketService.monitorMarket()
    };
  }

  async execute(taskName) {
    const taskFn = this.taskMapping[taskName];
    if (!taskFn) {
      throw new Error(`Unknown task: ${taskName}`);
    }
    return await this._executeWithRetry(taskFn, taskName);
  }

  async _executeWithRetry(taskFn, taskName) {
    const maxAttempts = this.config.market?.scheduler?.retry_attempts || 2;
    const retryDelay = 1000; // 1秒线性退避

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug(`[TaskExecutor] 执行任务 ${taskName}, 尝试 ${attempt}/${maxAttempts}`);
        const result = await taskFn();
        if (attempt > 1) {
          logger.info(`[TaskExecutor] 任务 ${taskName} 重试成功，尝试次数: ${attempt}`);
        }
        return result;
      } catch (error) {
        const isLastAttempt = attempt === maxAttempts;

        if (isLastAttempt) {
          logger.error(`[TaskExecutor] 任务 ${taskName} 最终失败，已尝试 ${attempt} 次`, { error: error.message });
          throw error;
        }

        if (this._shouldRetry(error, attempt)) {
          logger.warn(`[TaskExecutor] 任务 ${taskName} 第 ${attempt} 次尝试失败，${retryDelay}ms后重试`, { error: error.message });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          logger.error(`[TaskExecutor] 任务 ${taskName} 遇到不可重试错误`, { error: error.message });
          throw error;
        }
      }
    }
  }

  _shouldRetry(error, attempt) {
    // 简单的重试条件：网络错误、超时错误、临时性错误
    const retryableErrors = ['timeout', 'network', 'ECONNRESET', 'ETIMEDOUT'];
    const errorMessage = error.message.toLowerCase();
    return retryableErrors.some(keyword => errorMessage.includes(keyword));
  }
}
