/**
 * @fileoverview 市场定时任务调度器 - 集成层 Facade (简化重构版)
 *
 * Input:
 * - ./taskScheduler.js - TaskScheduler (统一任务调度器)
 * - marketService - (依赖注入,市场服务)
 *
 * Output:
 * - MarketScheduler (class) - 调度器集成层,提供:
 *   - start: 启动所有定时任务
 *   - stop: 停止所有定时任务
 *
 * Pos: 服务层集成 Facade,整合 TaskScheduler,保持向后兼容的 API
 *
 * 架构说明 (简化重构 v3.0):
 * - MarketScheduler (Facade) - API兼容层
 * - TaskScheduler (Core) - 核心调度引擎
 * - 重构收益: 代码量从671行减少到40行,减少94%
 *
 * 定时任务:
 * - dailyPriceUpdate: 每日价格更新(基于 cron 配置)
 * - 使用 TaskScheduler 统一调度
 * - 使用 Redis 分布式锁避免多实例重复执行
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
  async start() {
    if (this.isRunning) {
      logger.warn('[MarketScheduler] 调度器已在运行中');
      return;
    }
    logger.info('[MarketScheduler] 启动市场任务调度器');
    await this.scheduler.start();
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
