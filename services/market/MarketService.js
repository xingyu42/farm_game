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
   * 为所有浮动价格物品创建初始的市场数据结构
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
   * 获取物品当前价格 - 统一买卖同价
   * @param {string} itemId 物品ID
   * @returns {Promise<number>} 当前价格
   */
  async getItemPrice(itemId) {
    try {
      // 检查是否为浮动价格物品
      const isFloating = await this.isFloatingPriceItem(itemId);

      if (!isFloating) {
        return this._getStaticPrice(itemId);
      }

      // 从MarketDataManager获取统计数据
      const stats = await this.dataManager.getMarketStats(itemId);

      if (stats && !stats.error) {
        const price = stats.currentPrice;
        if (typeof price === 'number' && !isNaN(price) && price > 0) {
          return price;
        }
      }

      // 降级到静态价格
      logger.warn(`[MarketService] 获取动态价格失败，使用静态价格 [${itemId}]`);
      return this._getStaticPrice(itemId);
    } catch (error) {
      logger.error(`[MarketService] 获取物品价格失败 [${itemId}]: ${error.message}`);
      return this._getStaticPrice(itemId);
    }
  }

  /**
   * 获取市场统计数据 - 委托给MarketDataManager
   * @param {string|Array<string>} itemIds 物品ID或ID数组
   * @returns {Promise<Object|Array>} 统计数据
   */
  async getMarketStats(itemIds) {
    try {
      return await this.dataManager.getMarketStats(itemIds);
    } catch (error) {
      logger.error(`[MarketService] 获取市场统计失败: ${error.message}`);
      return Array.isArray(itemIds) ? [] : null;
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
   * 每日价格更新任务入口（纯供应驱动模式）
   * 执行流程：1.归档昨日供应 → 2.计算新价格 → 3.持久化到JSON
   * @returns {Promise<Object>} 更新结果
   */
  async executeDailyPriceUpdate() {
    const startTime = Date.now();

    try {
      if (!this._isDynamicPricingEnabled()) {
        logger.info('[MarketService] 动态定价功能已禁用，跳过每日价格更新');
        return { success: true, reason: 'disabled', updatedCount: 0 };
      }

      logger.info('[MarketService] ===== 开始每日价格更新 =====');

      // Step 1: 归档所有物品的昨日供应量
      logger.info('[MarketService] Step 1: 归档昨日供应量');
      const archiveResult = await this.dataManager.archiveAllDailySupply();
      logger.info(`[MarketService] 归档完成: ${archiveResult.archiveCount}/${archiveResult.totalItems}`);

      // Step 2: 更新价格
      logger.info('[MarketService] Step 2: 计算并更新价格');
      const priceResult = await this.updateDynamicPrices();

      const duration = Date.now() - startTime;
      logger.info(`[MarketService] ===== 每日价格更新完成，总耗时: ${duration}ms =====`);

      return {
        success: true,
        archive: archiveResult,
        priceUpdate: priceResult,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('[MarketService] 每日价格更新失败', {
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * 更新动态价格（纯供应驱动模式）
   * 基于7日平均供应量与昨日供应量的比值计算价格
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

      const result = await this._updatePricesSupplyDriven(floatingItems);

      const duration = Date.now() - startTime;
      logger.info(`[MarketService] 价格更新完成，耗时: ${duration}ms, 更新数量: ${result.updatedCount}`);

      // 更新性能统计
      this._updatePerformanceStats(result.updatedCount, duration);

      return {
        success: true,
        updatedCount: result.updatedCount,
        totalItems: floatingItems.length,
        duration,
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
   * 纯供应驱动的价格更新逻辑
   * @param {Array} floatingItems 浮动价格物品列表
   * @returns {Promise<Object>} 更新结果
   * @private
   */
  async _updatePricesSupplyDriven(floatingItems) {
    const errors = [];
    let updatedCount = 0;
    const priceChanges = [];

    try {
      const priceUpdates = [];

      for (const itemId of floatingItems) {
        try {
          // 获取当前统计数据
          const stats = await this.dataManager.getMarketStats(itemId);
          if (!stats || stats.error) {
            errors.push({ itemId, error: '统计数据不存在' });
            continue;
          }

          // 获取基准供应量（7日平均）
          const baseSupply = await this.dataManager.calculateBaseSupply(itemId);

          // 获取昨日供应量（已归档到历史，取最新的历史记录）
          const supplyHistory = await this.dataManager.getSupplyHistory(itemId);
          const yesterdaySupply = supplyHistory.length > 0 ? supplyHistory[0] : 0;

          // 计算新价格（传入当前价格用于惯性计算）
          const priceResult = await this.priceCalculator.calculatePrice(
            itemId,
            stats.basePrice,
            baseSupply,
            yesterdaySupply,
            stats.currentPrice
          );

          if (!priceResult.degraded) {
            const trend = this.priceCalculator.analyzePriceTrend(stats.basePrice, priceResult.price);
            const history = this.priceCalculator.updatePriceHistory(
              JSON.stringify(stats.priceHistory),
              priceResult.price
            );

            priceUpdates.push({
              itemId,
              data: {
                current_price: priceResult.price.toString(),
                price_trend: trend,
                price_history: JSON.stringify(history),
                last_updated: Date.now().toString()
              }
            });

            // 记录价格变化
            if (Math.abs(priceResult.price - stats.currentPrice) > 0.01) {
              priceChanges.push({
                itemId,
                oldPrice: stats.currentPrice,
                newPrice: priceResult.price,
                change: priceResult.price - stats.currentPrice,
                changePercent: ((priceResult.price - stats.currentPrice) / stats.currentPrice * 100).toFixed(2),
                baseSupply,
                yesterdaySupply,
                activity: priceResult.activity,
                momentum: priceResult.momentum,
                volatility: priceResult.volatility,
                timestamp: Date.now()
              });
            }
          }
        } catch (error) {
          errors.push({ itemId, error: error.message });
        }
      }

      // 批量更新到内存并持久化到 JSON
      if (priceUpdates.length > 0) {
        const updateResult = await this.dataManager.batchUpdateMarketData(priceUpdates);
        updatedCount = updateResult.updatedCount;

        if (updateResult.errors && updateResult.errors.length > 0) {
          errors.push(...updateResult.errors);
        }
      }

      return { updatedCount, priceChanges, errors };

    } catch (error) {
      logger.error('[MarketService] 供应驱动价格更新失败', { error: error.message });
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
  _getStaticPrice(itemId) {
    try {
      const itemInfo = this.itemResolver.getItemInfo(itemId);
      if (!itemInfo) {
        logger.warn(`[MarketService] 物品 ${itemId} 不存在`);
        return 0;
      }

      const price = itemInfo.price;

      // 检查价格是否存在且有效
      if (price === undefined || price === null) {
        logger.warn(`[MarketService] 物品 ${itemId} 缺少价格配置`);
        return 0;
      }

      if (typeof price !== 'number' || price <= 0) {
        logger.warn(`[MarketService] 物品 ${itemId} 的价格配置无效: ${price}`);
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