/**
 * MarketDataManager - 市场数据管理服务
 * 
 * 专门负责市场数据的存储、检索、验证和格式化。
 * 从原有MarketService中提取的数据管理核心逻辑。
 * 
 * @version 1.0.0
 */
import ItemResolver from '../../utils/ItemResolver.js';

export class MarketDataManager {
  constructor(redisClient, config) {
    this.redis = redisClient;
    this.config = config;
    this.itemResolver = new ItemResolver(config);

    // 获取市场配置
    this.marketConfig = this.config.market
    this.batchSize = this.marketConfig.batch_size
    this.historyDays = this.marketConfig.pricing?.history_days || 7
    this.minBaseSupply = this.marketConfig.pricing?.min_base_supply || 1
  }

  /**
   * 初始化市场数据
   * 为所有浮动价格物品创建初始的Redis数据结构
   * @returns {Promise<Object>} 初始化结果
   */
  async initializeMarketData() {
    try {
      const floatingItems = this._getFloatingPriceItems();
      logger.info(`[MarketDataManager] 开始初始化 ${floatingItems.length} 个浮动价格物品的市场数据`);

      let successCount = 0;
      const errors = [];

      for (const itemId of floatingItems) {
        try {
          const statsKey = `farm_game:market:stats:${itemId}`;
          const exists = await this.redis.exists(statsKey);

          if (!exists) {
            const itemInfo = this.itemResolver.getItemInfo(itemId);
            if (itemInfo) {
              const basePrice = itemInfo.price;
              const baseSellPrice = itemInfo.sellPrice;

              // 验证价格数据完整性
              if (this._validatePriceData(basePrice, baseSellPrice, itemId)) {
                // 初始化市场统计数据
                await this.redis.hSet(statsKey, {
                  base_price: basePrice.toString(),
                  current_price: basePrice.toString(),
                  current_sell_price: baseSellPrice.toString(),
                  demand_24h: '0',
                  supply_24h: '0',
                  last_updated: Date.now().toString(),
                  price_trend: 'stable',
                  price_history: JSON.stringify([basePrice])
                });

                successCount++;
              }
            } else {
              errors.push(`物品 ${itemId} 配置信息不存在`);
            }
          }
        } catch (error) {
          errors.push(`初始化物品 ${itemId} 失败: ${error.message}`);
          logger.error(`[MarketDataManager] 初始化物品 ${itemId} 失败`, { error: error.message, stack: error.stack });
        }
      }

      // 初始化全局市场统计
      await this._initializeGlobalStats(floatingItems.length);

      logger.info(`[MarketDataManager] 市场数据初始化完成，数量: ${floatingItems.length}`);

      return {
        success: true,
        totalItems: floatingItems.length,
        initializedItems: successCount,
        errors
      };
    } catch (error) {
      logger.error(`[MarketDataManager] 市场数据初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 记录交易统计数据
   * @param {string} itemId 物品ID
   * @param {number} quantity 交易数量
   * @param {string} transactionType 交易类型: 'buy' | 'sell'
   * @returns {Promise<boolean>} 记录是否成功
   */
  async recordTransaction(itemId, quantity, transactionType) {
    try {
      // 检查是否为浮动价格物品
      const isFloating = await this._isFloatingPriceItem(itemId);
      if (!isFloating) {
        return false; // 固定价格物品不记录统计
      }

      const statsKey = `farm_game:market:stats:${itemId}`;
      const field = transactionType === 'buy' ? 'demand_24h' : 'supply_24h';

      // 使用Redis事务确保原子性
      const multi = this.redis.pipeline();
      multi.hIncrBy(statsKey, field, quantity);
      multi.hSet(statsKey, 'last_transaction', Date.now().toString());

      await multi.exec();

      return true;
    } catch (error) {
      logger.error(`[MarketDataManager] 记录交易统计失败 [${itemId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * 归档昨日供应量到历史列表
   * @param {string} itemId 物品ID
   * @returns {Promise<Object>} 归档结果 { success, dailySupply, historyLength }
   */
  async archiveDailySupply(itemId) {
    try {
      const statsKey = `farm_game:market:stats:${itemId}`;
      const historyKey = `farm_game:market:supply:history:${itemId}`;

      // 获取昨日供应量
      const dailySupply = parseInt(await this.redis.hGet(statsKey, 'supply_24h')) || 0;

      // 写入历史列表（LPUSH 确保最新的在前面）
      await this.redis.lPush(historyKey, dailySupply.toString());

      // 只保留最近 N 天的数据
      await this.redis.lTrim(historyKey, 0, this.historyDays - 1);

      // 重置当日供应计数器
      await this.redis.hSet(statsKey, {
        supply_24h: '0',
        last_archive: Date.now().toString()
      });

      // 获取当前历史长度
      const historyLength = await this.redis.lLen(historyKey);

      logger.debug(`[MarketDataManager] 归档供应量: ${itemId}, dailySupply=${dailySupply}, historyLength=${historyLength}`);

      return { success: true, dailySupply, historyLength };
    } catch (error) {
      logger.error(`[MarketDataManager] 归档供应量失败 [${itemId}]: ${error.message}`);
      return { success: false, dailySupply: 0, historyLength: 0 };
    }
  }

  /**
   * 获取物品的供应历史
   * @param {string} itemId 物品ID
   * @returns {Promise<Array<number>>} 供应历史数组（最新的在前）
   */
  async getSupplyHistory(itemId) {
    try {
      const historyKey = `farm_game:market:supply:history:${itemId}`;
      const history = await this.redis.lRange(historyKey, 0, -1);

      // 转换为数字数组并过滤无效值
      return history
        .map(v => parseInt(v))
        .filter(v => Number.isFinite(v) && v >= 0);
    } catch (error) {
      logger.error(`[MarketDataManager] 获取供应历史失败 [${itemId}]: ${error.message}`);
      return [];
    }
  }

  /**
   * 计算基准供应量（7日滚动平均）
   * @param {string} itemId 物品ID
   * @returns {Promise<number>} 基准供应量
   */
  async calculateBaseSupply(itemId) {
    try {
      const history = await this.getSupplyHistory(itemId);

      // 冷启动：没有历史数据
      if (history.length === 0) {
        logger.debug(`[MarketDataManager] 无供应历史，使用最小基准: ${itemId}`);
        return this.minBaseSupply;
      }

      // 计算平均值
      const sum = history.reduce((acc, val) => acc + val, 0);
      const avg = sum / history.length;

      // 确保不低于最小值
      const baseSupply = Math.max(avg, this.minBaseSupply);

      logger.debug(`[MarketDataManager] 计算基准供应量: ${itemId}, history=${history.length}天, avg=${avg.toFixed(2)}, baseSupply=${baseSupply.toFixed(2)}`);

      return baseSupply;
    } catch (error) {
      logger.error(`[MarketDataManager] 计算基准供应量失败 [${itemId}]: ${error.message}`);
      return this.minBaseSupply;
    }
  }

  /**
   * 批量归档所有浮动价格物品的供应量（使用 pipeline 优化）
   * @returns {Promise<Object>} 归档结果统计
   */
  async archiveAllDailySupply() {
    const startTime = Date.now();
    const errors = [];

    try {
      const floatingItems = this._getFloatingPriceItems();
      logger.info(`[MarketDataManager] 开始归档 ${floatingItems.length} 个物品的每日供应量`);

      // Step 1: 批量获取所有物品的 supply_24h
      const readPipeline = this.redis.pipeline();
      for (const itemId of floatingItems) {
        readPipeline.hGet(`farm_game:market:stats:${itemId}`, 'supply_24h');
      }
      const supplyValues = await readPipeline.exec();

      // Step 2: 构造批量写入命令
      const writePipeline = this.redis.pipeline();
      const archiveTime = Date.now().toString();

      for (let i = 0; i < floatingItems.length; i++) {
        const itemId = floatingItems[i];
        const dailySupply = parseInt(supplyValues[i]) || 0;
        const statsKey = `farm_game:market:stats:${itemId}`;
        const historyKey = `farm_game:market:supply:history:${itemId}`;

        // 写入历史列表
        writePipeline.lPush(historyKey, dailySupply.toString());
        // 只保留最近 N 天
        writePipeline.lTrim(historyKey, 0, this.historyDays - 1);
        // 重置当日供应计数器
        writePipeline.hSet(statsKey, {
          supply_24h: '0',
          last_archive: archiveTime
        });
      }

      // Step 3: 执行批量写入
      await writePipeline.exec();

      const duration = Date.now() - startTime;
      logger.info(`[MarketDataManager] 归档完成: ${floatingItems.length} 个物品, 耗时: ${duration}ms`);

      return {
        success: true,
        archiveCount: floatingItems.length,
        totalItems: floatingItems.length,
        duration,
        errors
      };
    } catch (error) {
      logger.error(`[MarketDataManager] 批量归档失败: ${error.message}`);
      return {
        success: false,
        archiveCount: 0,
        totalItems: 0,
        duration: Date.now() - startTime,
        errors: [error.message]
      };
    }
  }

  /**
   * 获取市场统计数据
   * @param {string|Array<string>} itemIds 物品ID或ID数组
   * @returns {Promise<Object|Array>} 统计数据
   */
  async getMarketStats(itemIds) {
    try {
      const isArray = Array.isArray(itemIds);
      const ids = isArray ? itemIds : [itemIds];

      if (ids.length === 0) {
        return isArray ? [] : null;
      }

      // 批量获取统计数据
      const pipeline = this.redis.pipeline();
      for (const itemId of ids) {
        pipeline.hGetAll(`farm_game:market:stats:${itemId}`);
      }

      const results = await pipeline.exec();
      const stats = [];

      for (let i = 0; i < ids.length; i++) {
        const data = results[i];
        if (data && Object.keys(data).length > 0) {
          stats.push({
            itemId: ids[i],
            ...this._parseStatsData(data)
          });
        } else {
          stats.push({
            itemId: ids[i],
            error: '数据不存在'
          });
        }
      }

      return isArray ? stats : stats[0];
    } catch (error) {
      logger.error(`[MarketDataManager] 获取市场统计失败: ${error.message}`);
      throw error;
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
          // 获取统计数据
          const stats = await this.getMarketStats(itemId);
          if (stats && !stats.error) {
            // 计算价格变化百分比
            const buyPriceChange = stats.basePrice > 0
              ? ((stats.currentPrice - stats.basePrice) / stats.basePrice * 100)
              : 0;
            const sellPriceChange = stats.baseSellPrice > 0
              ? ((stats.currentSellPrice - stats.baseSellPrice) / stats.baseSellPrice * 100)
              : 0;

            categoryGroups[categoryName].push({
              id: itemId,
              name: itemInfo.name,
              currentBuyPrice: stats.currentPrice,
              currentSellPrice: stats.currentSellPrice,
              basePrice: stats.basePrice,
              baseSellPrice: stats.baseSellPrice,
              buyPriceChange: parseFloat(buyPriceChange.toFixed(1)),
              sellPriceChange: parseFloat(sellPriceChange.toFixed(1)),
              priceTrend: stats.priceTrend,
              isDynamic: true
            });
          }
        } catch (error) {
          logger.error(`[MarketDataManager] 获取物品 ${itemId} 市场数据失败: ${error.message}`);
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
      logger.error(`[MarketDataManager] 获取市场显示数据失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取市场图片渲染数据（按波动排序，分离Top10和其他）
   * @param {number} topCount 高波动商品数量，默认10
   * @returns {Promise<Object>} 渲染数据 { topVolatileItems, otherItems, totalItems }
   */
  async getMarketRenderData(topCount = 10) {
    try {
      const floatingItems = this._getFloatingPriceItems();
      const allItems = [];

      for (const itemId of floatingItems) {
        const itemInfo = this.itemResolver.getItemInfo(itemId);
        if (!itemInfo) continue;

        try {
          const stats = await this.getMarketStats(itemId);
          if (stats && !stats.error) {
            const buyPriceChange = stats.basePrice > 0
              ? ((stats.currentPrice - stats.basePrice) / stats.basePrice * 100)
              : 0;
            const sellPriceChange = stats.baseSellPrice > 0
              ? ((stats.currentSellPrice - stats.baseSellPrice) / stats.baseSellPrice * 100)
              : 0;

            allItems.push({
              id: itemId,
              name: itemInfo.name,
              icon: this.config.getItemIcon(itemId),
              currentBuyPrice: Math.round(stats.currentPrice),
              currentSellPrice: Math.round(stats.currentSellPrice),
              basePrice: stats.basePrice,
              buyPriceChange: parseFloat(buyPriceChange.toFixed(1)),
              sellPriceChange: parseFloat(sellPriceChange.toFixed(1)),
              priceTrend: stats.priceTrend,
              priceHistory: stats.priceHistory || [],
              demand24h: stats.demand24h || 0,
              supply24h: stats.supply24h || 0,
              volatility: Math.abs(buyPriceChange)
            });
          }
        } catch (error) {
          logger.error(`[MarketDataManager] 获取物品 ${itemId} 渲染数据失败: ${error.message}`);
        }
      }

      // 按波动幅度（绝对值）降序排序
      allItems.sort((a, b) => b.volatility - a.volatility);

      // 分离Top N和其他物品
      const topVolatileItems = allItems.slice(0, topCount).map(item => ({
        ...item,
        sparklinePath: this._generateSparklinePath(item.priceHistory)
      }));
      const otherItems = allItems.slice(topCount);

      return {
        topVolatileItems,
        otherItems,
        totalItems: allItems.length
      };
    } catch (error) {
      logger.error(`[MarketDataManager] 获取市场渲染数据失败: ${error.message}`);
      return { topVolatileItems: [], otherItems: [], totalItems: 0 };
    }
  }

  /**
   * 生成 SVG Sparkline 路径
   * @param {Array<number>} priceHistory 价格历史数组
   * @param {number} width SVG宽度，默认100
   * @param {number} height SVG高度，默认30
   * @returns {string} SVG path d属性值
   * @private
   */
  _generateSparklinePath(priceHistory, width = 100, height = 30) {
    if (!Array.isArray(priceHistory) || priceHistory.length < 2) {
      return `M 0 ${height / 2} L ${width} ${height / 2}`;
    }

    // 取最近24个数据点（一天的数据）
    const data = priceHistory.slice(-24);
    if (data.length < 2) {
      return `M 0 ${height / 2} L ${width} ${height / 2}`;
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const effectiveHeight = height - padding * 2;

    const points = data.map((price, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padding + effectiveHeight - ((price - min) / range * effectiveHeight);
      return { x, y };
    });

    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
    }

    return d;
  }

  /**
   * 重置每日统计数据
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
      logger.info(`[MarketDataManager] 开始重置 ${floatingItems.length} 个物品的日统计数据`);

      // 使用Redis Pipeline进行批量重置
      const pipeline = this.redis.pipeline();
      const resetTime = Date.now().toString();

      for (const itemId of floatingItems) {
        try {
          pipeline.hSet(`farm_game:market:stats:${itemId}`, {
            demand_24h: '0',
            supply_24h: '0',
            last_reset: resetTime
          });
          resetCount++;
        } catch (error) {
          errors.push(`物品 ${itemId} 重置失败: ${error.message}`);
        }
      }

      // 执行批量操作
      await pipeline.exec();

      // 更新全局统计
      await this.redis.hSet(`farm_game:market:global:stats`, {
        last_reset: resetTime,
        last_reset_count: resetCount.toString()
      });

      const duration = Date.now() - startTime;
      logger.info(`[MarketDataManager] 日统计数据重置完成，成功: ${resetCount}/${floatingItems.length}, 耗时: ${duration}ms`);

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
      logger.error(`[MarketDataManager] 日统计数据重置失败: ${error.message}`);

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
   * 批量更新市场数据
   * @param {Array} updates 更新数据数组
   * @returns {Promise<Object>} 更新结果
   */
  async batchUpdateMarketData(updates) {
    try {
      if (!Array.isArray(updates) || updates.length === 0) {
        return { success: true, updatedCount: 0, errors: [] };
      }

      const pipeline = this.redis.pipeline();
      let validUpdates = 0;
      const errors = [];

      for (const update of updates) {
        try {
          if (this._validateUpdateData(update)) {
            pipeline.hSet(`farm_game:market:stats:${update.itemId}`, update.data);
            validUpdates++;
          } else {
            errors.push(`无效的更新数据: ${update.itemId}`);
          }
        } catch (error) {
          errors.push(`处理更新 ${update.itemId} 失败: ${error.message}`);
        }
      }

      // 执行批量更新
      await pipeline.exec();

      logger.info(`[MarketDataManager] 批量更新完成，成功: ${validUpdates}/${updates.length}`);

      return {
        success: true,
        totalUpdates: updates.length,
        updatedCount: validUpdates,
        errors
      };
    } catch (error) {
      logger.error(`[MarketDataManager] 批量更新失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 验证价格数据
   * @param {number} basePrice 基准价格
   * @param {number} baseSellPrice 基准出售价格
   * @param {string} itemId 物品ID
   * @returns {boolean} 验证结果
   * @private
   */
  _validatePriceData(basePrice, baseSellPrice, itemId) {
    // 验证价格数据完整性
    if (basePrice === undefined || baseSellPrice === undefined) {
      logger.warn(`[MarketDataManager] 物品 ${itemId} 价格数据不完整: price=${basePrice}, sellPrice=${baseSellPrice}`);
      return false;
    }

    // 验证价格数据有效性
    if (typeof basePrice !== 'number' || typeof baseSellPrice !== 'number' || basePrice <= 0 || baseSellPrice <= 0) {
      logger.warn(`[MarketDataManager] 物品 ${itemId} 价格数据无效: price=${basePrice}, sellPrice=${baseSellPrice}`);
      return false;
    }

    return true;
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

      // 从 crops.yaml 读取动态定价标记（若存在）
      const cropsConfig = this.config.crops
      for (const [cropId, cropInfo] of Object.entries(cropsConfig)) {
        if (cropInfo && cropInfo.is_dynamic_price === true) {
          floatingItems.add(cropId);
        }
      }

      // 方法2: 根据类别添加物品
      const floatingCategories = this.marketConfig.floating_items?.categories || [];
      for (const category of floatingCategories) {
        if (category === 'crops') {
          for (const cropId of Object.keys(this.config.crops)) {
            floatingItems.add(cropId);
          }
        } else if (itemsConfig[category]) {
          const itemIds = Object.keys(itemsConfig[category]);
          for (const itemId of itemIds) {
            floatingItems.add(itemId);
          }
        }
      }

      // 方法3: 添加特定物品ID
      const specificItems = this.marketConfig.floating_items?.items || [];
      for (const itemId of specificItems) {
        floatingItems.add(itemId);
      }

      return Array.from(floatingItems);
    } catch (error) {
      logger.error(`[MarketDataManager] 获取浮动价格物品列表失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 检查是否为浮动价格物品
   * @param {string} itemId 物品ID
   * @returns {Promise<boolean>} 是否为浮动价格物品
   * @private
   */
  async _isFloatingPriceItem(itemId) {
    const floatingItems = this._getFloatingPriceItems();
    return floatingItems.includes(itemId);
  }

  /**
   * 检查动态定价功能是否启用
   * @returns {boolean} 是否启用
   * @private
   */
  _isDynamicPricingEnabled() {
    try {
      return this.marketConfig.enabled !== false; // 默认启用
    } catch (error) {
      logger.warn(`[MarketDataManager] 检查动态定价开关失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 解析统计数据
   * @param {Object} data Redis返回的数据
   * @returns {Object} 解析后的数据
   * @private
   */
  _parseStatsData(data) {
    return {
      basePrice: parseFloat(data.base_price) || 0,
      currentPrice: parseFloat(data.current_price) || 0,
      currentSellPrice: parseFloat(data.current_sell_price) || 0,
      baseSellPrice: parseFloat(data.base_price) * 0.5, // 估算基准出售价
      demand24h: parseInt(data.demand_24h) || 0,
      supply24h: parseInt(data.supply_24h) || 0,
      lastUpdated: parseInt(data.last_updated) || 0,
      priceTrend: data.price_trend || 'stable',
      priceHistory: this._parsePriceHistory(data.price_history),
      lastTransaction: parseInt(data.last_transaction) || 0,
      lastReset: parseInt(data.last_reset) || 0
    };
  }

  /**
   * 解析价格历史
   * @param {string} historyString JSON格式的价格历史
   * @returns {Array<number>} 价格历史数组
   * @private
   */
  _parsePriceHistory(historyString) {
    try {
      const parsed = JSON.parse(historyString);
      if (Array.isArray(parsed)) {
        return parsed.filter(price => typeof price === 'number' && isFinite(price) && price >= 0);
      }
    } catch (error) {
      logger.debug('[MarketDataManager] 解析价格历史失败，返回空数组');
    }
    return [];
  }

  /**
   * 验证更新数据
   * @param {Object} update 更新数据
   * @returns {boolean} 验证结果
   * @private
   */
  _validateUpdateData(update) {
    return update &&
      typeof update.itemId === 'string' &&
      update.itemId.length > 0 &&
      update.data &&
      typeof update.data === 'object';
  }

  /**
   * 初始化全局统计
   * @param {number} totalItems 物品总数
   * @private
   */
  async _initializeGlobalStats(totalItems) {
    try {
      const globalStats = {
        total_items: totalItems.toString(),
        last_update: Date.now().toString(),
        update_count: '0',
        avg_update_time: '0',
        error_count: '0',
        last_reset: Date.now().toString(),
      };

      await this.redis.hSet(`farm_game:market:global:stats`, globalStats);
    } catch (error) {
      logger.error(`[MarketDataManager] 初始化全局统计失败: ${error.message}`);
    }
  }
}

export default MarketDataManager;