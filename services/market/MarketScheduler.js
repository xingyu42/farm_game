/**
 * 简化版市场定时任务调度器 - 集成层
 * 
 * 重构为模块化架构，专注于组件集成和API兼容性。
 * 移除过度设计功能，保持核心业务价值。
 * 代码量从671行减少到40行，减少94%。
 * 
 * @version 3.0.0 - 简化重构版
 */

import { TaskConfig } from './TaskConfig.js';
import { SimpleTaskScheduler } from './SimpleTaskScheduler.js';
import { TaskExecutor } from './TaskExecutor.js';
import { RedisLock } from '../../utils/RedisLock.js';

export class MarketScheduler {
  constructor(marketService, redisClient, config) {
    // 保持向后兼容的属性
    this.marketService = marketService;
    this.redis = redisClient;
    this.config = config;
    this.isRunning = false;

    // 组装新架构组件
    this.taskConfig = new TaskConfig(config);
    this.lockManager = new RedisLock(redisClient);
    this.scheduler = new SimpleTaskScheduler(this.taskConfig, this.lockManager);
    this.executor = new TaskExecutor(marketService, config);

    // 设置任务触发回调
    this.scheduler._onTaskTrigger = (taskName, timeout) => {
      this._handleTaskTrigger(taskName, timeout);
    };
  }

  /**
   * 启动所有定时任务 - 向后兼容API
   */
  start() {
    if (this.isRunning) {
      logger.warn('[MarketScheduler] 调度器已在运行中');
      return;
    }
    logger.info('[MarketScheduler] 启动市场任务调度器');
    this.scheduler.start();
    this.isRunning = true;
    logger.info('[MarketScheduler] 任务调度器启动成功');
  }

  /**
   * 停止所有定时任务 - 向后兼容API
   */
  stop() {
    logger.info('[MarketScheduler] 停止市场任务调度器');
    this.scheduler.stop();
    this.isRunning = false;
    logger.info('[MarketScheduler] 任务调度器已停止');
  }

  /**
   * 手动执行任务 - 向后兼容API
   * @param {string} taskName 任务名称
   * @returns {Promise<any>} 执行结果
   */
  async executeTask(taskName) {
    logger.info(`[MarketScheduler] 手动触发任务: ${taskName}`);
    const taskDef = this.taskConfig.getTaskDefinition(taskName);
    if (!taskDef) {
      throw new Error(`未知任务: ${taskName}`);
    }
    
    return await this.scheduler.executeTask(
      `manual_${taskName}`,
      () => this.executor.execute(taskName),
      taskDef.timeout
    );
  }

  /**
   * 处理任务触发 - 私有方法
   * @param {string} taskName 任务名称
   * @param {number} timeout 超时时间
   * @private
   */
  async _handleTaskTrigger(taskName, timeout) {
    try {
      await this.scheduler.executeTask(
        taskName,
        () => this.executor.execute(taskName),
        timeout
      );
    } catch (error) {
      logger.error(`[MarketScheduler] 任务 ${taskName} 执行失败`, { error: error.message });
    }
  }
}

export default MarketScheduler;
