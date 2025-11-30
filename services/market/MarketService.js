/**
 * MarketService - 市场服务统一入口 (Facade Pattern)
 * 
 * 重构后的MarketService作为Facade模式的统一入口，保持100% API兼容性。
 * 内部委托给专门的服务处理具体业务逻辑，实现职责分离和模块化。
 * 
 * @version 3.0.0 - 重构版，保持完全兼容
 */
import ItemResolver from '../../utils/ItemResolver.js';

export class MarketService {
  constructor(redisClient, config, playerService, priceCalculator, marketDataManager, transactionManager) {
    this.redis = redisClient;
    this.config = config;
    this.playerService = playerService;
    this.itemResolver = new ItemResolver(config);

    // 注入专门服务（依赖注入模式）
    this.priceCalculator = priceCalculator;
    this.dataManager = marketDataManager;
    this.transactionManager = transactionManager;

    // 保持原有性能统计
    this.stats = {
      priceUpdates: 0,
      totalUpdateTime: 0,
      averageUpdateTime: 0,
      lastUpdateTime: null,
      transactionRecords: 0
    };
  }

  /**
   * 初始化市场数据 - 委托给MarketDataManager
   * 为所有浮动价格物品创建初始的Redis数据结构
   */
  async initializeMarketData() {
    try {
      logger.info('[MarketService] 开始初始化市场数据');
      return await this.dataManager.initializeMarketData();
    } catch (error) {
      logger.error(`[MarketService] 市场数据初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查物品是否为浮动价格物品 - 委托给MarketDataManager
   * @param {string} itemId 物品ID
   * @returns {Promise<boolean>} 是否为浮动价格物品
   */
  async isFloatingPriceItem(itemId) {
    try {
      const floatingItems = this._getFloatingPriceItems();
      return floatingItems.includes(itemId);
    } catch (error) {
      logger.warn(`[MarketService] 检查浮动价格物品失败 [${itemId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * 获取物品当前价格 - 委托给PriceCalculator和MarketDataManager
   * @param {string} itemId 物品ID
   * @param {string} priceType 价格类型: 'buy' | 'sell'
   * @returns {Promise<number>} 当前价格
   */
  async getItemPrice(itemId, priceType = 'buy') {
    try {
      // 检查是否为浮动价格物品
      const isFloating = await this.isFloatingPriceItem(itemId);

      if (!isFloating) {
        // 使用静态价格
        return this._getStaticPrice(itemId, priceType);
      }

      // 从MarketDataManager获取统计数据
      const stats = await this.dataManager.getMarketStats(itemId);

      if (stats && !stats.error) {
        const price = priceType === 'buy' ? stats.currentPrice : stats.currentSellPrice;
        if (price !== undefined && !isNaN(price)) {
          return price;
        }
      }

      // 降级到静态价格
      logger.warn(`[MarketService] 获取动态价格失败，使用静态价格 [${itemId}]`);
      return this._getStaticPrice(itemId, priceType);
    } catch (error) {
      logger.error(`[MarketService] 获取物品价格失败 [${itemId}]: ${error.message}`);
      // 降级到静态价格
      return this._getStaticPrice(itemId, priceType);
    }
  }

  /**
   * 获取市场显示数据 - 委托给MarketDataManager
   * @returns {Promise<Array>} 市场价格显示数据
   */
  async getMarketDisplayData() {
    try {
      return await this.dataManager.getMarketDisplayData();
    } catch (error) {
      logger.error(`[MarketService] 获取市场显示数据失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取市场图片渲染数据 - 委托给MarketDataManager
   * @param {number} topCount 高波动商品数量，默认10
   * @returns {Promise<Object>} 渲染数据 { topVolatileItems, otherItems, totalItems }
   */
  async getMarketRenderData(topCount = 10) {
    try {
      return await this.dataManager.getMarketRenderData(topCount);
    } catch (error) {
      logger.error(`[MarketService] 获取市场渲染数据失败: ${error.message}`);
      return { topVolatileItems: [], otherItems: [], totalItems: 0 };
    }
  }

  /**
   * 记录交易统计数据 - 委托给MarketDataManager
   * @param {string} itemId 物品ID
   * @param {number} quantity 交易数量
   * @param {string} transactionType 交易类型: 'buy' | 'sell'
   */
  async recordTransaction(itemId, quantity, transactionType) {
    try {
      const success = await this.dataManager.recordTransaction(itemId, quantity, transactionType);
      if (success) {
        this.stats.transactionRecords++;
      }
      return success;
    } catch (error) {
      logger.error(`[MarketService] 记录交易统计失败 [${itemId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * 更新动态价格 - 集成PriceCalculator、MarketDataManager和TransactionManager
   */
  async updateDynamicPrices() {
    const startTime = Date.now();

    try {
      if (!this._isDynamicPricingEnabled()) {
        logger.info('[MarketService] 动态定价功能已禁用，跳过价格更新');
        return { success: true, reason: 'disabled', updatedCount: 0 };
      }

      const floatingItems = this._getFloatingPriceItems();
      logger.info(`[MarketService] 开始更新 ${floatingItems.length} 个浮动价格物品的价格`);

      let result;

      // 根据物品数量选择处理策略
      if (floatingItems.length > this.batchSize) {
        logger.info(`[MarketService] 物品数量 ${floatingItems.length} 超过批次大小 ${this.batchSize}，使用批量处理`);
        result = await this._batchUpdatePrices(floatingItems);
      } else {
        logger.info(`[MarketService] 物品数量 ${floatingItems.length} 未超过批次大小，使用直接处理`);
        result = await this._directUpdatePrices(floatingItems);
      }

      const duration = Date.now() - startTime;
      logger.info(`[MarketService] 价格更新完成，耗时: ${duration}ms, 总计物品: ${floatingItems.length}, 更新数量: ${result.updatedCount}`);

      // 更新性能统计
      this._updatePerformanceStats(result.updatedCount, duration);

      return {
        success: true,
        updatedCount: result.updatedCount,
        totalItems: floatingItems.length,
        duration,
        strategy: floatingItems.length > this.batchSize ? 'batch' : 'direct',
        priceChanges: result.priceChanges,
        errors: result.errors
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('[MarketService] 价格更新失败', {
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });

      throw error;
    }
  }

  /**
   * 重置每日统计数据 - 委托给MarketDataManager
   */
  async resetDailyStats() {
    try {
      return await this.dataManager.resetDailyStats();
    } catch (error) {
      logger.error(`[MarketService] 重置每日统计失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 市场监控和告警 - 使用集成的监控逻辑
   */
  async monitorMarket() {
    const startTime = Date.now();

    try {
      if (!this._isDynamicPricingEnabled()) {
        return {
          timestamp: Date.now(),
          status: 'disabled',
          summary: {
            totalItems: 0,
            healthyItems: 0,
            warningItems: 0,
            errorItems: 0
          },
          alerts: [],
          performance: {
            avgUpdateTime: 0,
            errorRate: 0,
            lastUpdate: 0
          }
        };
      }

      const floatingItems = this._getFloatingPriceItems();
      const alerts = [];
      const summary = {
        totalItems: floatingItems.length,
        healthyItems: 0,
        warningItems: 0,
        errorItems: 0
      };

      // 批量获取所有物品的统计数据
      const allStats = await this.dataManager.getMarketStats(floatingItems);

      // 分析每个物品的状态
      for (const stats of allStats) {
        if (stats.error) {
          summary.errorItems++;
          alerts.push({
            level: 'ERROR',
            itemId: stats.itemId,
            message: '缺少统计数据',
            value: 0,
            threshold: 0
          });
          continue;
        }

        try {
          let itemStatus = 'healthy';

          // 检查价格异常波动（超过30%）
          if (stats.basePrice > 0) {
            const priceChangePercent = Math.abs((stats.currentPrice - stats.basePrice) / stats.basePrice * 100);
            const priceThreshold = this.config.market.monitoring.price_change_threshold * 100; // 30%

            if (priceChangePercent > priceThreshold) {
              itemStatus = 'warning';
              alerts.push({
                level: 'WARN',
                itemId: stats.itemId,
                message: `价格波动异常: ${priceChangePercent.toFixed(1)}%`,
                value: priceChangePercent,
                threshold: priceThreshold
              });
            }
          }

          // 检查供需比例极端情况
          if (stats.supply24h > 0) {
            const ratio = stats.demand24h / stats.supply24h;
            const extremeThreshold = this.config.market.monitoring.extreme_ratio_threshold; // 2.0

            if (ratio > extremeThreshold * 5 || ratio < 1 / (extremeThreshold * 5)) {
              itemStatus = 'warning';
              alerts.push({
                level: 'WARN',
                itemId: stats.itemId,
                message: `供需比例极端: ${ratio.toFixed(2)}`,
                value: ratio,
                threshold: extremeThreshold
              });
            }
          }

          // 更新统计
          if (itemStatus === 'healthy') {
            summary.healthyItems++;
          } else if (itemStatus === 'warning') {
            summary.warningItems++;
          } else {
            summary.errorItems++;
          }

        } catch (error) {
          summary.errorItems++;
          alerts.push({
            level: 'ERROR',
            itemId: stats.itemId,
            message: `分析失败: ${error.message}`,
            value: 0,
            threshold: 0
          });
        }
      }

      // 获取性能指标
      const performance = {
        avgUpdateTime: this.stats.averageUpdateTime,
        errorRate: summary.totalItems > 0 ? (summary.errorItems / summary.totalItems * 100) : 0,
        lastUpdate: this.stats.lastUpdateTime
      };

      // 确定整体状态
      let overallStatus = 'healthy';
      if (summary.errorItems > 0) {
        overallStatus = 'error';
      } else if (summary.warningItems > 0) {
        overallStatus = 'warning';
      }

      const duration = Date.now() - startTime;
      logger.info(`[MarketService] 市场监控完成，耗时: ${duration}ms, 状态: ${overallStatus}`);

      return {
        timestamp: Date.now(),
        status: overallStatus,
        summary,
        alerts,
        performance
      };

    } catch (error) {
      logger.error('市场监控失败', {
        error: error.message,
        stack: error.stack,
        duration: `${Date.now() - startTime}ms`
      });

      return {
        timestamp: Date.now(),
        status: 'critical',
        summary: {
          totalItems: 0,
          healthyItems: 0,
          warningItems: 0,
          errorItems: 0
        },
        alerts: [{
          level: 'CRITICAL',
          itemId: 'system',
          message: `监控系统故障: ${error.message}`,
          value: 0,
          threshold: 0
        }],
        performance: {
          avgUpdateTime: 0,
          errorRate: 100,
          lastUpdate: 0
        }
      };
    }
  }

  /**
   * 批量更新价格 - 使用TransactionManager确保数据一致性
   * @param {Array} floatingItems 浮动价格物品列表
   * @private
   */
  async _batchUpdatePrices(floatingItems) {
    const errors = [];
    let updatedCount = 0;
    const priceChanges = [];

    try {
      // 获取所有物品的统计数据
      const allStats = await this.dataManager.getMarketStats(floatingItems);

      // 批量计算新价格
      const priceUpdates = [];
      for (const stats of allStats) {
        if (!stats.error) {
          try {
            const priceResult = await this.priceCalculator.calculatePrice(
              stats.itemId,
              stats.basePrice,
              stats.demand24h,
              stats.supply24h
            );

            if (!priceResult.degraded) {
              const trend = this.priceCalculator.analyzePriceTrend(stats.currentPrice, priceResult.buyPrice);
              const history = this.priceCalculator.updatePriceHistory(
                JSON.stringify(stats.priceHistory),
                priceResult.buyPrice
              );

              priceUpdates.push({
                type: 'hset',
                key: `farm_game:market:stats:${stats.itemId}`,
                data: {
                  current_price: priceResult.buyPrice.toString(),
                  current_sell_price: priceResult.sellPrice.toString(),
                  price_trend: trend,
                  price_history: JSON.stringify(history),
                  last_updated: Date.now().toString()
                }
              });

              // 记录价格变化
              if (Math.abs(priceResult.buyPrice - stats.currentPrice) > 0.01) {
                priceChanges.push({
                  itemId: stats.itemId,
                  oldPrice: stats.currentPrice,
                  newPrice: priceResult.buyPrice,
                  change: priceResult.buyPrice - stats.currentPrice,
                  changePercent: ((priceResult.buyPrice - stats.currentPrice) / stats.currentPrice * 100).toFixed(2),
                  demand: stats.demand24h,
                  supply: stats.supply24h,
                  timestamp: Date.now()
                });
              }
            }
          } catch (error) {
            errors.push({ itemId: stats.itemId, error: error.message });
          }
        }
      }

      // 使用TransactionManager执行批量更新
      if (priceUpdates.length > 0) {
        const transactionResult = await this.transactionManager.executeBatchUpdate(priceUpdates);
        updatedCount = transactionResult.successCount;

        if (transactionResult.errors && transactionResult.errors.length > 0) {
          errors.push(...transactionResult.errors);
        }
      }

      return { updatedCount, priceChanges, errors };

    } catch (error) {
      logger.error('批量价格更新失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 直接更新价格 - 使用TransactionManager确保原子性
   * @param {Array} floatingItems 浮动价格物品列表
   * @private
   */
  async _directUpdatePrices(floatingItems) {
    const errors = [];
    let updatedCount = 0;
    const priceChanges = [];

    try {
      const operations = [];

      // 获取所有统计数据并准备更新操作
      const allStats = await this.dataManager.getMarketStats(floatingItems);

      for (const stats of allStats) {
        if (!stats.error) {
          try {
            const priceResult = await this.priceCalculator.calculatePrice(
              stats.itemId,
              stats.basePrice,
              stats.demand24h,
              stats.supply24h
            );

            if (!priceResult.degraded) {
              const trend = this.priceCalculator.analyzePriceTrend(stats.currentPrice, priceResult.buyPrice);
              const history = this.priceCalculator.updatePriceHistory(
                JSON.stringify(stats.priceHistory),
                priceResult.buyPrice
              );

              operations.push({
                type: 'hset',
                key: `farm_game:market:stats:${stats.itemId}`,
                data: {
                  current_price: priceResult.buyPrice.toString(),
                  current_sell_price: priceResult.sellPrice.toString(),
                  price_trend: trend,
                  price_history: JSON.stringify(history),
                  last_updated: Date.now().toString()
                }
              });

              // 记录价格变化
              if (Math.abs(priceResult.buyPrice - stats.currentPrice) > 0.01) {
                priceChanges.push({
                  itemId: stats.itemId,
                  oldPrice: stats.currentPrice,
                  newPrice: priceResult.buyPrice,
                  change: priceResult.buyPrice - stats.currentPrice,
                  changePercent: ((priceResult.buyPrice - stats.currentPrice) / stats.currentPrice * 100).toFixed(2),
                  demand: stats.demand24h,
                  supply: stats.supply24h,
                  timestamp: Date.now()
                });
              }
            }
          } catch (error) {
            errors.push({ itemId: stats.itemId, error: error.message });
          }
        }
      }

      // 使用TransactionManager执行更新
      if (operations.length > 0) {
        const result = await this.transactionManager.executeBatchUpdate(operations);
        updatedCount = result.successCount;

        if (result.errors && result.errors.length > 0) {
          errors.push(...result.errors);
        }
      }

      return { updatedCount, priceChanges, errors };

    } catch (error) {
      logger.error('直接价格更新失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取浮动价格物品列表 - 保持原有逻辑
   * @private
   */
  _getFloatingPriceItems() {
    try {
      const floatingItems = new Set();

      // 从配置获取所有物品
      const itemsConfig = this.config.items

      // 方法1: 扫描所有物品的is_dynamic_price标识（不包含crops类别）
      for (const [category, items] of Object.entries(itemsConfig)) {
        if (category === 'crops') continue;
        if (typeof items === 'object' && items !== null) {
          for (const [itemId, itemInfo] of Object.entries(items)) {
            if (itemInfo && itemInfo.is_dynamic_price === true) {
              floatingItems.add(itemId);
            }
          }
        }
      }

      // 从 crops.yaml 扫描动态定价标记
      const cropsConfig = this.config.crops
      for (const [cropId, cropInfo] of Object.entries(cropsConfig)) {
        if (cropInfo && cropInfo.is_dynamic_price === true) {
          floatingItems.add(cropId);
        }
      }

      // 方法2: 根据类别添加物品
      const marketConfig = this.config.market;
      const floatingCategories = marketConfig.floating_items.categories;

      for (const category of floatingCategories) {
        if (category === 'crops') {
          for (const itemId of Object.keys(cropsConfig)) {
            floatingItems.add(itemId);
          }
        } else if (itemsConfig[category]) {
          for (const itemId of Object.keys(itemsConfig[category])) {
            floatingItems.add(itemId);
          }
        }
      }

      // 方法3: 添加特定物品ID
      const specificItems = marketConfig.floating_items.items;
      for (const itemId of specificItems) {
        floatingItems.add(itemId);
      }

      return Array.from(floatingItems);
    } catch (error) {
      logger.error(`[MarketService] 获取浮动价格物品列表失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取静态价格 - 保持原有逻辑
   * @param {string} itemId 物品ID
   * @param {string} priceType 价格类型
   * @private
   */
  _getStaticPrice(itemId, priceType) {
    try {
      const itemInfo = this.itemResolver.getItemInfo(itemId);
      if (!itemInfo) {
        logger.warn(`[MarketService] 物品 ${itemId} 不存在`);
        return 0;
      }

      const price = priceType === 'buy' ? itemInfo.price : itemInfo.sellPrice;

      // 检查价格是否存在且有效
      if (price === undefined || price === null) {
        logger.warn(`[MarketService] 物品 ${itemId} 缺少 ${priceType} 价格配置`);
        return 0;
      }

      if (typeof price !== 'number' || price <= 0) {
        logger.warn(`[MarketService] 物品 ${itemId} 的 ${priceType} 价格配置无效: ${price}`);
        return 0;
      }

      return price;
    } catch (error) {
      logger.error(`[MarketService] 获取静态价格失败 [${itemId}]: ${error.message}`);
      return 0;
    }
  }

  /**
   * 检查动态定价功能是否启用 - 保持原有逻辑
   * @private
   */
  _isDynamicPricingEnabled() {
    try {
      const marketConfig = this.config.market;
      return marketConfig.enabled !== false; // 默认启用
    } catch (error) {
      logger.warn(`[MarketService] 检查动态定价开关失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 更新性能统计 - 保持原有逻辑
   * @param {number} updatedCount 更新数量
   * @param {number} duration 耗时
   * @private
   */
  _updatePerformanceStats(updatedCount, duration) {
    this.stats.priceUpdates++;
    this.stats.totalUpdateTime += duration;
    this.stats.averageUpdateTime = this.stats.totalUpdateTime / this.stats.priceUpdates;
    this.stats.lastUpdateTime = Date.now();

    // 记录性能指标
    logger.logMetric?.('priceUpdateDuration', duration, {
      updatedCount,
      averageTime: this.stats.averageUpdateTime.toFixed(2)
    });
  }
}

export default MarketService;