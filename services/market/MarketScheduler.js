/**
 * 简化版市场定时任务调度器 - 集成层
 * 
 * 重构为模块化架构，专注于组件集成和API兼容性。
 * 移除过度设计功能，保持核心业务价值。
 * 代码量从671行减少到40行，减少94%。
 * 
 * @version 3.0.0 - 简化重构版
 */

import { TaskScheduler } from './taskScheduler.js';

export class MarketScheduler {
  constructor(marketService, redisClient, config) {
    // 保持向后兼容的属性
    this.marketService = marketService;
    this.redis = redisClient;
    this.config = config;
    this.isRunning = false;

    // 组装新架构组件
    this.scheduler = new TaskScheduler({
      marketService,
      lockManager: redisClient, // 直接使用 redisClient，它有 withLock 方法
      rawConfig: config
    });
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
}

export default MarketScheduler;
