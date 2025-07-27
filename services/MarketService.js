/**
 * 增强版市场服务 - 动态定价机制的核心服务
 * 
 * 负责供需统计、价格计算、市场数据管理等功能。
 * 增强功能：
 * 1. 集成CommonUtils工具类，消除代码重复
 * 2. 实现批量处理优化，支持大规模数据处理
 * 3. 标准化日志系统集成
 * 4. 增强的错误处理和性能监控
 * 5. 配置验证和默认值机制
 * 
 * @version 2.0.0 - 增强版，解决代码重复和性能问题
 */
import ItemResolver from '../utils/ItemResolver.js';
import { CommonUtils } from '../utils/CommonUtils.js';

export class MarketService {
  constructor(redisClient, config, playerService, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.playerService = playerService;
    this.itemResolver = new ItemResolver(config);

    // 创建标准化日志器
    this.logger = logger;

    // 获取批量处理配置
    const marketConfig = this.config.market;
    this.batchSize = marketConfig.batch_size;
    this.maxBatchSize = marketConfig.performance.max_batch_size;

    // 性能统计
    this.stats = {
      priceUpdates: 0,
      totalUpdateTime: 0,
      averageUpdateTime: 0,
      lastUpdateTime: null,
      transactionRecords: 0
    };
  }

  /**
   * 初始化市场数据
   * 为所有浮动价格物品创建初始的Redis数据结构
   */
  async initializeMarketData() {
    try {
      const floatingItems = this._getFloatingPriceItems();
      this.logger.info(`[MarketService] 开始初始化 ${floatingItems.length} 个浮动价格物品的市场数据`);

      for (const itemId of floatingItems) {
        const statsKey = `market:stats:${itemId}`;
        const exists = await this.redis.exists(statsKey);

        if (!exists) {
          // 获取物品基础信息
          const itemInfo = this.itemResolver.getItemInfo(itemId);
          if (itemInfo) {
            const basePrice = itemInfo.price;
            const baseSellPrice = itemInfo.sellPrice;

            // 初始化市场统计数据
            await this.redis.hMSet(statsKey, {
              base_price: basePrice.toString(),
              current_price: basePrice.toString(),
              current_sell_price: baseSellPrice.toString(),
              demand_24h: '0',
              supply_24h: '0',
              last_updated: Date.now().toString(),
              price_trend: 'stable',
              price_history: JSON.stringify([basePrice])
            });

            this.logger.info(`[MarketService] 初始化物品 ${itemId} 市场数据: 基准价=${basePrice}, 出售价=${baseSellPrice}`);
          }
        }
      }

      // 初始化市场配置
      await this._initializeMarketConfig();

      this.logger.info('[MarketService] 市场数据初始化完成');
    } catch (error) {
      this.logger.error(`[MarketService] 市场数据初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查物品是否为浮动价格物品
   * @param {string} itemId 物品ID
   * @returns {Promise<boolean>} 是否为浮动价格物品
   */
  async isFloatingPriceItem(itemId) {
    try {
      // 检查全局动态定价开关
      if (!this._isDynamicPricingEnabled()) {
        return false;
      }

      // 方法1: 检查物品配置中的is_dynamic_price标识
      const itemInfo = this.itemResolver.getItemInfo(itemId);
      if (itemInfo && itemInfo.is_dynamic_price === true) {
        return true;
      }

      // 方法2: 检查物品类别是否在浮动价格类别列表中
      const marketConfig = this.config.market;
      const floatingCategories = marketConfig.floating_items.categories;

      if (itemInfo && floatingCategories.includes(itemInfo.category)) {
        return true;
      }

      // 方法3: 检查特定物品ID列表
      const floatingItems = marketConfig.floating_items.items;
      return floatingItems.includes(itemId);
    } catch (error) {
      this.logger.warn(`[MarketService] 检查浮动价格物品失败 [${itemId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * 获取物品当前价格
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

      // 尝试从Redis获取动态价格
      const statsKey = `market:stats:${itemId}`;
      const priceField = priceType === 'buy' ? 'current_price' : 'current_sell_price';
      const price = await this.redis.hGet(statsKey, priceField);

      if (price !== null && !isNaN(parseFloat(price))) {
        return parseFloat(price);
      }

      // 降级到静态价格
      this.logger.warn(`[MarketService] 获取动态价格失败，使用静态价格 [${itemId}]`);
      return this._getStaticPrice(itemId, priceType);
    } catch (error) {
      this.logger.error(`[MarketService] 获取物品价格失败 [${itemId}]: ${error.message}`);
      // 降级到静态价格
      return this._getStaticPrice(itemId, priceType);
    }
  }

  /**
   * 获取市场显示数据（用于前端展示）
   * @returns {Promise<Array>} 市场价格显示数据
   */
  async getMarketDisplayData() {
    try {
      const floatingItems = this._getFloatingPriceItems();
      const marketData = [];

      // 按类别分组
      const categoryGroups = {};

      for (const itemId of floatingItems) {
        const itemInfo = this.itemResolver.getItemInfo(itemId);
        if (!itemInfo) continue;

        const category = itemInfo.category || 'other';
        const categoryName = this.itemResolver.getCategoryDisplayName(category);

        if (!categoryGroups[categoryName]) {
          categoryGroups[categoryName] = [];
        }

        try {
          // 获取当前价格
          const currentBuyPrice = await this.getItemPrice(itemId, 'buy');
          const currentSellPrice = await this.getItemPrice(itemId, 'sell');
          const basePrice = itemInfo.price || 0;
          const baseSellPrice = itemInfo.sellPrice || 0;

          // 获取价格趋势
          const statsKey = `market:stats:${itemId}`;
          const priceTrend = await this.redis.hGet(statsKey, 'price_trend') || 'stable';

          // 计算价格变化百分比
          const buyPriceChange = basePrice > 0 ? ((currentBuyPrice - basePrice) / basePrice * 100).toFixed(1) : '0.0';
          const sellPriceChange = baseSellPrice > 0 ? ((currentSellPrice - baseSellPrice) / baseSellPrice * 100).toFixed(1) : '0.0';

          categoryGroups[categoryName].push({
            id: itemId,
            name: itemInfo.name,
            currentBuyPrice,
            currentSellPrice,
            basePrice,
            baseSellPrice,
            buyPriceChange: parseFloat(buyPriceChange),
            sellPriceChange: parseFloat(sellPriceChange),
            priceTrend,
            isDynamic: true
          });
        } catch (error) {
          this.logger.error(`获取物品 ${itemId} 市场数据失败: ${error.message}`);
          // 继续处理其他物品
        }
      }

      // 转换为数组格式并排序
      for (const [categoryName, items] of Object.entries(categoryGroups)) {
        if (items.length > 0) {
          marketData.push({
            category: categoryName,
            items: items.sort((a, b) => a.name.localeCompare(b.name))
          });
        }
      }

      return marketData.sort((a, b) => a.category.localeCompare(b.category));
    } catch (error) {
      this.logger.error(`获取市场显示数据失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 记录交易统计数据
   * @param {string} itemId 物品ID
   * @param {number} quantity 交易数量
   * @param {string} transactionType 交易类型: 'buy' | 'sell'
   */
  async recordTransaction(itemId, quantity, transactionType) {
    try {
      // 检查是否为浮动价格物品
      const isFloating = await this.isFloatingPriceItem(itemId);
      if (!isFloating) {
        return; // 固定价格物品不记录统计
      }

      const statsKey = `market:stats:${itemId}`;
      const field = transactionType === 'buy' ? 'demand_24h' : 'supply_24h';

      // 使用Redis事务确保原子性
      const multi = this.redis.multi();
      multi.hIncrBy(statsKey, field, quantity);
      multi.hSet(statsKey, 'last_transaction', Date.now().toString());

      await multi.exec();

      this.logger.info(`[MarketService] 记录交易统计: ${itemId} ${transactionType} ${quantity}`);
    } catch (error) {
      this.logger.error(`[MarketService] 记录交易统计失败 [${itemId}]: ${error.message}`);
      // 不抛出错误，避免影响主要交易流程
    }
  }

  /**
   * 获取浮动价格物品列表
   * @returns {Array<string>} 浮动价格物品ID列表
   * @private
   */
  _getFloatingPriceItems() {
    try {
      const floatingItems = new Set();

      // 从配置获取所有物品
      const itemsConfig = this.config.items;

      // 方法1: 扫描所有物品的is_dynamic_price标识
      for (const [_category, items] of Object.entries(itemsConfig)) {
        if (typeof items === 'object' && items !== null) {
          for (const [itemId, itemInfo] of Object.entries(items)) {
            if (itemInfo && itemInfo.is_dynamic_price === true) {
              floatingItems.add(itemId);
            }
          }
        }
      }

      // 方法2: 根据类别添加物品
      const marketConfig = this.config.market;
      const floatingCategories = marketConfig.floating_items.categories;

      for (const category of floatingCategories) {
        if (itemsConfig[category]) {
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
      this.logger.error(`[MarketService] 获取浮动价格物品列表失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取静态价格（从配置文件）
   * @param {string} itemId 物品ID
   * @param {string} priceType 价格类型
   * @returns {number} 静态价格
   * @private
   */
  _getStaticPrice(itemId, priceType) {
    try {
      const itemInfo = this.itemResolver.getItemInfo(itemId);
      if (!itemInfo) {
        this.logger.warn(`[MarketService] 物品 ${itemId} 不存在`);
        return 0;
      }

      return priceType === 'buy' ? itemInfo.price : itemInfo.sellPrice;
    } catch (error) {
      this.logger.error(`[MarketService] 获取静态价格失败 [${itemId}]: ${error.message}`);
      return 0;
    }
  }

  /**
   * 检查动态定价功能是否启用
   * @returns {boolean} 是否启用
   * @private
   */
  _isDynamicPricingEnabled() {
    try {
      const marketConfig = this.config.market;
      return marketConfig.enabled !== false; // 默认启用
    } catch (error) {
      this.logger.warn(`[MarketService] 检查动态定价开关失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 更新动态价格（增强版本）
   * 
   * 根据供需数据计算并更新所有浮动价格物品的价格。
   * 新增功能：
   * 1. 智能批量处理，支持大规模数据处理
   * 2. 性能监控和进度跟踪
   * 3. 错误隔离，单个物品失败不影响整体处理
   * 4. 详细的统计信息和性能指标
   */
  async updateDynamicPrices() {
    const startTime = Date.now();

    try {
      if (!this._isDynamicPricingEnabled()) {
        this.logger.info('动态定价功能已禁用，跳过价格更新');
        return { success: true, reason: 'disabled', updatedCount: 0 };
      }

      const floatingItems = this._getFloatingPriceItems();
      this.logger.info(`开始更新 ${floatingItems.length} 个浮动价格物品的价格`);

      let result;

      // 根据物品数量选择处理策略
      if (floatingItems.length > this.batchSize) {
        this.logger.info(`物品数量 ${floatingItems.length} 超过批次大小 ${this.batchSize}，使用批量处理`);
        result = await this._batchUpdatePrices(floatingItems);
      } else {
        this.logger.info(`物品数量 ${floatingItems.length} 未超过批次大小，使用直接处理`);
        result = await this._directUpdatePrices(floatingItems);
      }

      const duration = Date.now() - startTime;
      this.logger.info(`价格更新完成，耗时: ${duration}ms, 总计物品: ${floatingItems.length}, 更新数量: ${result.updatedCount}`);

      // 更新性能统计
      this._updatePerformanceStats(result.updatedCount, duration);

      // 性能告警
      this._checkPerformanceThresholds(duration, floatingItems.length);

      return {
        success: true,
        updatedCount: result.updatedCount,
        totalItems: floatingItems.length,
        duration,
        strategy: floatingItems.length > this.batchSize ? 'batch' : 'direct',
        priceChanges: result.priceChanges || [],
        errors: result.errors || []
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('价格更新失败', {
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });

      throw error;
    }
  }

  /**
   * 批量更新价格（大规模数据处理）
   * 
   * @param {Array} floatingItems - 浮动价格物品列表
   * @returns {Promise<Object>} 处理结果
   * @private
   */
  async _batchUpdatePrices(floatingItems) {
    const errors = [];
    let updatedCount = 0;
    const priceChanges = [];

    try {
      const results = await CommonUtils.batchProcess(
        floatingItems,
        async (itemId) => {
          try {
            return await this._updateSingleItemPrice(itemId);
          } catch (error) {
            errors.push({ itemId, error: error.message });
            this.logger.error(`批量处理中物品 ${itemId} 价格更新失败`, { error: error.message });
            return { updated: false, itemId, error: error.message };
          }
        },
        this.batchSize,
        (progress) => {
          this.logger.info(`价格更新进度: ${progress.progress.toFixed(1)}% (${progress.completed}/${progress.total} 批次)`);
        }
      );

      // 统计结果
      for (const result of results) {
        if (result.updated) {
          updatedCount++;
          if (result.priceChange) {
            priceChanges.push(result.priceChange);
          }
        }
      }

      return { updatedCount, priceChanges, errors };

    } catch (error) {
      this.logger.error('批量价格更新失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 直接更新价格（小规模数据处理）
   * 
   * @param {Array} floatingItems - 浮动价格物品列表
   * @returns {Promise<Object>} 处理结果
   * @private
   */
  async _directUpdatePrices(floatingItems) {
    const errors = [];
    let updatedCount = 0;
    const priceChanges = [];

    try {
      // 批量获取所有物品的统计数据
      const pipeline = this.redis.pipeline();
      for (const itemId of floatingItems) {
        pipeline.hGetAll(`market:stats:${itemId}`);
      }

      const results = await pipeline.exec();

      // 批量计算和更新价格
      const updatePipeline = this.redis.pipeline();
      const updateOperations = [];

      for (let i = 0; i < floatingItems.length; i++) {
        const itemId = floatingItems[i];
        const [err, stats] = results[i];

        if (err) {
          errors.push({ itemId, error: err.message });
          continue;
        }

        try {
          if (stats && Object.keys(stats).length > 0) {
            const updateData = this._calculateAndValidatePrice(stats, itemId);
            if (updateData) {
              updatePipeline.hMSet(`market:stats:${itemId}`, updateData.redis);
              updateOperations.push({ itemId, ...updateData });
              updatedCount++;

              if (updateData.priceChange) {
                priceChanges.push(updateData.priceChange);
              }
            }
          } else {
            this.logger.warn(`物品 ${itemId} 缺少统计数据，跳过更新`);
          }
        } catch (error) {
          errors.push({ itemId, error: error.message });
          this.logger.error(`物品 ${itemId} 价格计算失败`, { error: error.message });
        }
      }

      // 执行批量更新
      if (updateOperations.length > 0) {
        await updatePipeline.exec();
        this.logger.debug(`批量更新了 ${updateOperations.length} 个物品的价格`);
      }

    } catch (error) {
      this.logger.error('直接价格更新失败', { error: error.message });
      throw error;
    }

    return { updatedCount, priceChanges, errors };
  }

  /**
   * 计算并验证价格（使用CommonUtils）
   * 
   * @param {Object} stats - 统计数据
   * @param {string} itemId - 物品ID（用于日志）
   * @returns {Object|null} 价格更新数据或null（如果计算失败）
   * @private
   */
  _calculateAndValidatePrice(stats, itemId) {
    return CommonUtils.safeCalculation(() => {
      const basePrice = parseFloat(stats.base_price);
      const demand = parseInt(stats.demand_24h);
      const supply = parseInt(stats.supply_24h);
      const oldPrice = parseFloat(stats.current_price);

      // 使用CommonUtils验证价格
      CommonUtils.validatePrice(basePrice, `base price for ${itemId}`);

      // 计算新价格
      const calculatedPrice = this._calculatePriceFromSupplyDemand(basePrice, demand, supply);
      const clampedBuyPrice = this._clampPrice(calculatedPrice, basePrice);
      
      // 获取售价比例配置，默认为0.5
      const sellPriceRatio = this.config.market?.pricing?.sell_price_ratio || 0.5;
      const newSellPrice = clampedBuyPrice * sellPriceRatio;

      // 验证最终价格
      CommonUtils.validatePrice(clampedBuyPrice, `final buy price for ${itemId}`);
      CommonUtils.validatePrice(newSellPrice, `final sell price for ${itemId}`);

      // 计算价格趋势和历史
      const priceTrend = this._calculatePriceTrend(oldPrice, clampedBuyPrice);
      const priceHistory = this._updatePriceHistory(stats.price_history, clampedBuyPrice);

      // 构建Redis更新数据
      const redisData = {
        current_price: clampedBuyPrice.toString(),
        current_sell_price: newSellPrice.toFixed(2),
        price_trend: priceTrend,
        price_history: JSON.stringify(priceHistory),
        last_updated: Date.now().toString()
      };

      // 构建价格变化记录
      const priceChange = Math.abs(clampedBuyPrice - oldPrice) > 0.01 ? {
        itemId,
        oldPrice,
        newPrice: clampedBuyPrice,
        change: clampedBuyPrice - oldPrice,
        changePercent: ((clampedBuyPrice - oldPrice) / oldPrice * 100).toFixed(2),
        demand,
        supply,
        timestamp: Date.now()
      } : null;

      return {
        redis: redisData,
        priceChange,
        updated: true
      };
    }, null);
  }

  /**
   * 更新性能统计
   * 
   * @param {number} updatedCount - 更新数量
   * @param {number} duration - 耗时
   * @private
   */
  _updatePerformanceStats(updatedCount, duration) {
    this.stats.priceUpdates++;
    this.stats.totalUpdateTime += duration;
    this.stats.averageUpdateTime = this.stats.totalUpdateTime / this.stats.priceUpdates;
    this.stats.lastUpdateTime = Date.now();

    // 记录性能指标
    this.logger.logMetric('priceUpdateDuration', duration, {
      updatedCount,
      averageTime: this.stats.averageUpdateTime.toFixed(2)
    });
  }

  /**
   * 检查性能阈值
   * 
   * @param {number} duration - 耗时
   * @param {number} itemCount - 物品数量
   * @private
   */
  _checkPerformanceThresholds(duration, itemCount) {
    const avgTimePerItem = itemCount > 0 ? duration / itemCount : 0;

    // 获取性能阈值配置
    const performanceConfig = this.config.market?.performance || {};
    const maxTotalDuration = performanceConfig.max_total_duration || 60000; // 默认60秒
    const maxAvgTimePerItem = performanceConfig.max_avg_time_per_item || 100; // 默认100ms

    // 总耗时告警
    if (duration > maxTotalDuration) {
      this.logger.warn('价格更新耗时过长', {
        duration: `${duration}ms`,
        threshold: `${maxTotalDuration}ms`,
        itemCount,
        avgTimePerItem: `${avgTimePerItem.toFixed(2)}ms`
      });
    }

    // 单项平均耗时告警
    if (avgTimePerItem > maxAvgTimePerItem) {
      this.logger.warn('单项价格更新平均耗时过长', {
        avgTimePerItem: `${avgTimePerItem.toFixed(2)}ms`,
        threshold: `${maxAvgTimePerItem}ms`,
        itemCount,
        suggestion: '考虑增加批次大小或优化价格计算逻辑'
      });
    }
  }

  /**
   * 根据供需数据计算物品价格
   * 
   * 算法原理：
   * 1. 计算供需比率 = demand / supply
   * 2. 使用对数函数平滑处理：adjustment = log(ratio) * sensitivity
   * 3. 应用到基准价格：newPrice = basePrice * (1 + adjustment)
   * 
   * @param {number} basePrice - 基准价格
   * @param {number} demand - 24小时需求量
   * @param {number} supply - 24小时供应量
   * @returns {number} 计算后的价格
   * @private
   */
  _calculatePriceFromSupplyDemand(basePrice, demand, supply) {
    return CommonUtils.safeCalculation(() => {
      // 验证基准价格
      CommonUtils.validatePrice(basePrice, 'base price in price calculation');

      // 获取市场配置
      const marketConfig = this.config.market;
      const sensitivity = marketConfig.pricing.sensitivity;
      
      // 获取极端比率配置，提供默认值
      const pricingConfig = marketConfig.pricing || {};
      const maxRatio = pricingConfig.extreme_ratio_max || 10; // 极端比率上限
      const minRatio = pricingConfig.extreme_ratio_min || 0.1; // 极端比率下限

      let ratio;

      // 处理边界情况
      if (supply === 0) {
        // 零供应量：高需求系数或平衡状态
        ratio = demand > 0 ? maxRatio : 1;
        this.logger.debug(`零供应情况: demand=${demand}, 使用比率=${ratio}`);
      } else if (demand === 0) {
        // 零需求量：低需求系数
        ratio = minRatio;
        this.logger.debug(`零需求情况: supply=${supply}, 使用比率=${ratio}`);
      } else {
        // 正常情况：计算供需比率
        ratio = demand / supply;
        this.logger.debug(`正常供需情况: demand=${demand}, supply=${supply}, ratio=${ratio}`);
      }

      // 限制比率在合理范围内
      const clampedRatio = Math.max(minRatio, Math.min(maxRatio, ratio));

      // 使用对数函数计算价格调整系数
      const adjustment = Math.log(clampedRatio) * sensitivity;

      // 计算新价格
      const newPrice = basePrice * (1 + adjustment);

      this.logger.debug(`价格计算详情`, {
        basePrice,
        demand,
        supply,
        ratio: ratio.toFixed(4),
        clampedRatio: clampedRatio.toFixed(4),
        adjustment: adjustment.toFixed(4),
        newPrice: newPrice.toFixed(2)
      });

      return newPrice;
    }, basePrice);
  }

  /**
   * 限制价格在配置范围内
   * 
   * @param {number} calculatedPrice - 计算出的价格
   * @param {number} basePrice - 基准价格
   * @returns {number} 限制后的价格(保留2位小数)
   * @private
   */
  _clampPrice(calculatedPrice, basePrice) {
    return CommonUtils.safeCalculation(() => {
      // 验证输入参数
      CommonUtils.validatePrice(calculatedPrice, 'calculated price in clamp');
      CommonUtils.validatePrice(basePrice, 'base price in clamp');

      // 获取价格限制配置
      const marketConfig = this.config.market;
      const minRatio = marketConfig.pricing.min_ratio; // 0.5
      const maxRatio = marketConfig.pricing.max_ratio; // 1.5

      // 计算价格边界
      const minPrice = basePrice * minRatio;
      const maxPrice = basePrice * maxRatio;

      // 限制价格在边界内
      const clampedPrice = Math.max(minPrice, Math.min(maxPrice, calculatedPrice));

      // 保留2位小数
      const finalPrice = Math.round(clampedPrice * 100) / 100;

      // 验证最终价格
      CommonUtils.validatePrice(finalPrice, 'final clamped price');

      this.logger.debug(`价格限制详情`, {
        calculatedPrice: calculatedPrice.toFixed(2),
        basePrice: basePrice.toFixed(2),
        minPrice: minPrice.toFixed(2),
        maxPrice: maxPrice.toFixed(2),
        clampedPrice: clampedPrice.toFixed(2),
        finalPrice: finalPrice.toFixed(2)
      });

      return finalPrice;
    }, basePrice);
  }

  /**
   * 计算价格趋势
   * 
   * @param {number} oldPrice - 旧价格
   * @param {number} newPrice - 新价格
   * @returns {string} 趋势状态: 'rising' | 'falling' | 'stable'
   * @private
   */
  _calculatePriceTrend(oldPrice, newPrice) {
    return CommonUtils.safeCalculation(() => {
      // 验证价格参数
      CommonUtils.validatePrice(oldPrice, 'old price in trend calculation');
      CommonUtils.validatePrice(newPrice, 'new price in trend calculation');

      // 避免除零错误
      if (oldPrice === 0) {
        return 'stable';
      }

      // 计算价格变化百分比
      const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;
      
      // 获取稳定性阈值配置，默认为2%
      const stabilityThreshold = this.config.market?.pricing?.stability_threshold || 2;

      let trend;
      if (Math.abs(changePercent) < stabilityThreshold) {
        trend = 'stable';
      } else if (changePercent > 0) {
        trend = 'rising';
      } else {
        trend = 'falling';
      }

      this.logger.debug(`趋势计算详情`, {
        oldPrice: oldPrice.toFixed(2),
        newPrice: newPrice.toFixed(2),
        changePercent: changePercent.toFixed(2),
        threshold: stabilityThreshold,
        trend
      });

      return trend;
    }, 'stable');
  }

  /**
   * 更新价格历史记录
   * 
   * @param {string} historyString - JSON格式的价格历史
   * @param {number} newPrice - 新价格
   * @returns {Array<number>} 更新后的价格历史数组
   * @private
   */
  _updatePriceHistory(historyString, newPrice) {
    return CommonUtils.safeCalculation(() => {
      // 验证新价格
      CommonUtils.validatePrice(newPrice, 'new price in history update');

      let history = [];

      // 解析现有历史数据
      try {
        const parsed = JSON.parse(historyString || '[]');
        if (Array.isArray(parsed)) {
          // 过滤有效的数值价格
          history = parsed.filter(price => 
            typeof price === 'number' && 
            isFinite(price) && 
            price >= 0
          );
        } else {
          this.logger.warn('价格历史数据格式错误，重新创建历史数组', { parsed });
          history = [];
        }
      } catch (error) {
        this.logger.warn('解析价格历史数据失败，重新创建历史数组', { 
          error: error.message, 
          historyString 
        });
        history = [];
      }

      // 添加新价格
      history.push(newPrice);

      // 获取最大记录数配置
      const maxRecords = this.config.market.history.max_records; // 168

      // 清理过期记录（FIFO）
      if (history.length > maxRecords) {
        history = history.slice(-maxRecords);
        this.logger.debug(`价格历史记录清理`, {
          beforeLength: history.length + (history.length - maxRecords),
          afterLength: history.length,
          maxRecords
        });
      }

      this.logger.debug(`价格历史更新`, {
        newPrice: newPrice.toFixed(2),
        historyLength: history.length,
        maxRecords
      });

      return history;
    }, [newPrice]);
  }

  /**
   * 更新单个物品的价格
   * 
   * 处理流程：
   * 1. 获取物品统计数据
   * 2. 计算新价格
   * 3. 更新Redis数据
   * 4. 返回详细结果
   * 
   * @param {string} itemId - 物品ID
   * @returns {Promise<Object>} 更新结果
   * @private
   */
  async _updateSingleItemPrice(itemId) {
    try {
      const statsKey = `market:stats:${itemId}`;
      
      // 获取物品统计数据
      const stats = await this.redis.hGetAll(statsKey);
      
      if (!stats || Object.keys(stats).length === 0) {
        return {
          updated: false,
          itemId,
          error: '物品统计数据不存在',
          oldPrice: 0,
          newPrice: 0,
          priceChange: null
        };
      }

      // 使用现有的计算和验证逻辑
      const updateData = this._calculateAndValidatePrice(stats, itemId);
      
      if (!updateData) {
        return {
          updated: false,
          itemId,
          error: '价格计算失败',
          oldPrice: parseFloat(stats.current_price) || 0,
          newPrice: 0,
          priceChange: null
        };
      }

      // 更新Redis数据
      await this.redis.hMSet(statsKey, updateData.redis);

      this.logger.info(`单个物品价格更新成功`, {
        itemId,
        oldPrice: parseFloat(stats.current_price),
        newPrice: parseFloat(updateData.redis.current_price),
        trend: updateData.redis.price_trend
      });

      return {
        updated: true,
        itemId,
        oldPrice: parseFloat(stats.current_price) || 0,
        newPrice: parseFloat(updateData.redis.current_price),
        priceChange: updateData.priceChange,
        error: null
      };

    } catch (error) {
      this.logger.error(`单个物品价格更新失败`, {
        itemId,
        error: error.message,
        stack: error.stack
      });

      return {
        updated: false,
        itemId,
        error: error.message,
        oldPrice: 0,
        newPrice: 0,
        priceChange: null
      };
    }
  }

  /**
   * 初始化市场配置
   * 
   * 初始化内容：
   * 1. 全局市场统计
   * 2. 默认配置验证
   * 3. Redis键结构
   * 4. 性能监控指标
   * 
   * @returns {Promise<void>}
   * @private
   */
  async _initializeMarketConfig() {
    try {
      const floatingItems = this._getFloatingPriceItems();
      
      // 配置验证
      const configSchema = {
        sensitivity: { type: 'number', min: 0.01, max: 1, required: true },
        min_ratio: { type: 'number', min: 0.1, max: 0.9, required: true },
        max_ratio: { type: 'number', min: 1.1, max: 5, required: true }
      };

      const validation = CommonUtils.validateConfig(
        this.config.market.pricing, 
        configSchema
      );

      if (!validation.valid) {
        this.logger.warn('市场配置验证警告', { errors: validation.errors });
      } else {
        this.logger.info('市场配置验证通过');
      }

      // 初始化全局市场统计
      const globalStats = {
        total_items: floatingItems.length.toString(),
        last_update: Date.now().toString(),
        update_count: '0',
        avg_update_time: '0',
        error_count: '0',
        last_reset: Date.now().toString(),
        config_version: '2.0.0'
      };

      await this.redis.hMSet('market:global:stats', globalStats);

      // 初始化性能监控指标
      const performanceStats = {
        total_calculations: '0',
        avg_calculation_time: '0',
        max_calculation_time: '0',
        last_performance_check: Date.now().toString()
      };

      await this.redis.hMSet('market:performance:stats', performanceStats);

      this.logger.info('市场配置初始化完成', {
        totalItems: floatingItems.length,
        configValidation: validation.valid ? 'passed' : 'warning',
        globalStatsKey: 'market:global:stats',
        performanceStatsKey: 'market:performance:stats'
      });

    } catch (error) {
      this.logger.error('市场配置初始化失败', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * 重置每日统计数据
   * 
   * 重置内容：
   * 1. 清零所有物品的demand_24h和supply_24h
   * 2. 更新最后重置时间
   * 3. 记录重置统计信息
   * 
   * @returns {Promise<Object>} 重置结果统计
   */
  async resetDailyStats() {
    const startTime = Date.now();
    const errors = [];
    let resetCount = 0;

    try {
      if (!this._isDynamicPricingEnabled()) {
        return {
          success: true,
          reason: 'disabled',
          resetCount: 0,
          totalItems: 0,
          timestamp: Date.now(),
          duration: 0,
          errors: []
        };
      }

      const floatingItems = this._getFloatingPriceItems();
      this.logger.info(`开始重置 ${floatingItems.length} 个物品的日统计数据`);

      // 使用Redis Pipeline进行批量重置
      const pipeline = this.redis.pipeline();
      const resetTime = Date.now().toString();

      for (const itemId of floatingItems) {
        try {
          pipeline.hMSet(`market:stats:${itemId}`, {
            demand_24h: '0',
            supply_24h: '0',
            last_reset: resetTime
          });
          resetCount++;
        } catch (error) {
          errors.push(`物品 ${itemId} 重置失败: ${error.message}`);
          this.logger.warn(`物品 ${itemId} 重置准备失败`, { error: error.message });
        }
      }

      // 执行批量操作
      await pipeline.exec();

      // 更新全局统计
      await this.redis.hMSet('market:global:stats', {
        last_reset: resetTime,
        last_reset_count: resetCount.toString()
      });

      const duration = Date.now() - startTime;

      this.logger.info('日统计数据重置完成', {
        resetCount,
        totalItems: floatingItems.length,
        duration: `${duration}ms`,
        errorCount: errors.length
      });

      return {
        success: true,
        resetCount,
        totalItems: floatingItems.length,
        timestamp: Date.now(),
        duration,
        errors
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('日统计数据重置失败', {
        error: error.message,
        duration: `${duration}ms`,
        resetCount,
        errorCount: errors.length
      });

      return {
        success: false,
        resetCount,
        totalItems: 0,
        timestamp: Date.now(),
        duration,
        errors: [...errors, error.message]
      };
    }
  }

  /**
   * 市场监控和告警
   * 
   * 监控项目：
   * 1. 价格异常波动检测
   * 2. 供需比例极端情况
   * 3. 数据完整性验证
   * 4. 性能指标分析
   * 
   * @returns {Promise<Object>} 监控报告
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
      const pipeline = this.redis.pipeline();
      for (const itemId of floatingItems) {
        pipeline.hGetAll(`market:stats:${itemId}`);
      }

      const results = await pipeline.exec();

      // 分析每个物品的状态
      for (let i = 0; i < floatingItems.length; i++) {
        const itemId = floatingItems[i];
        const [err, stats] = results[i];

        if (err || !stats || Object.keys(stats).length === 0) {
          summary.errorItems++;
          alerts.push({
            level: 'ERROR',
            itemId,
            message: '缺少统计数据',
            value: 0,
            threshold: 0
          });
          continue;
        }

        try {
          const basePrice = parseFloat(stats.base_price) || 0;
          const currentPrice = parseFloat(stats.current_price) || 0;
          const demand = parseInt(stats.demand_24h) || 0;
          const supply = parseInt(stats.supply_24h) || 0;

          let itemStatus = 'healthy';

          // 检查价格异常波动（超过30%）
          if (basePrice > 0) {
            const priceChangePercent = Math.abs((currentPrice - basePrice) / basePrice * 100);
            const priceThreshold = this.config.market.monitoring.price_change_threshold * 100; // 30%

            if (priceChangePercent > priceThreshold) {
              itemStatus = 'warning';
              alerts.push({
                level: 'WARN',
                itemId,
                message: `价格波动异常: ${priceChangePercent.toFixed(1)}%`,
                value: priceChangePercent,
                threshold: priceThreshold
              });
            }
          }

          // 检查供需比例极端情况
          if (supply > 0) {
            const ratio = demand / supply;
            const extremeThreshold = this.config.market.monitoring.extreme_ratio_threshold; // 2.0

            if (ratio > extremeThreshold * 5 || ratio < 1 / (extremeThreshold * 5)) {
              itemStatus = 'warning';
              alerts.push({
                level: 'WARN',
                itemId,
                message: `供需比例极端: ${ratio.toFixed(2)}`,
                value: ratio,
                threshold: extremeThreshold
              });
            }
          }

          // 检查数据完整性
          if (!stats.last_updated || !stats.price_trend) {
            itemStatus = 'warning';
            alerts.push({
              level: 'WARN',
              itemId,
              message: '数据不完整',
              value: 0,
              threshold: 0
            });
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
            itemId,
            message: `分析失败: ${error.message}`,
            value: 0,
            threshold: 0
          });
        }
      }

      // 获取性能指标
      const globalStats = await this.redis.hGetAll('market:global:stats');
      const performance = {
        avgUpdateTime: parseFloat(globalStats.avg_update_time) || 0,
        errorRate: summary.totalItems > 0 ? (summary.errorItems / summary.totalItems * 100) : 0,
        lastUpdate: parseInt(globalStats.last_update) || 0
      };

      // 确定整体状态
      let overallStatus = 'healthy';
      if (summary.errorItems > 0) {
        overallStatus = 'error';
      } else if (summary.warningItems > 0) {
        overallStatus = 'warning';
      }

      const duration = Date.now() - startTime;

      this.logger.info('市场监控完成', {
        duration: `${duration}ms`,
        status: overallStatus,
        totalItems: summary.totalItems,
        healthyItems: summary.healthyItems,
        warningItems: summary.warningItems,
        errorItems: summary.errorItems,
        alertCount: alerts.length
      });

      return {
        timestamp: Date.now(),
        status: overallStatus,
        summary,
        alerts,
        performance
      };

    } catch (error) {
      this.logger.error('市场监控失败', {
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
}

export default MarketService;
