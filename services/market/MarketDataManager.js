/**
 * @fileoverview 市场数据管理服务 - 内存缓存 + JSON持久化 (v3.0)
 *
 * Input:
 * - ../../utils/ItemResolver.js - ItemResolver (物品配置查询)
 * - ../../utils/fileStorage.js - FileStorage (JSON文件操作)
 *
 * Output:
 * - MarketDataManager (class) - 数据管理服务类,提供:
 *   - initializeMarketData: 初始化市场数据结构
 *   - loadMarketData: 从JSON文件加载数据到内存
 *   - getMarketData: 获取所有市场数据
 *   - getItemData: 获取单个物品数据
 *   - updateItemData: 更新物品数据(自动触发持久化)
 *   - recordTransaction: 记录交易(供应量、价格更新)
 *   - isFloatingPriceItem: 检查是否为浮动价格物品
 *   - validateMarketData: 验证数据格式
 *
 * Pos: 服务层子服务,负责市场数据的存储、检索、验证和格式化
 *
 * 存储架构 (全JSON v3.0):
 * - 运行时: 内存缓存 (this._marketData)
 * - 持久化: JSON文件 (data/market/market.json)
 * - 写入策略: 修改后5秒自动保存(防抖),关键操作立即持久化
 * - 数据结构: { version, lastPersistedAt, items: {itemId: {...}}, globalStats }
 *
 * 性能优化:
 * - 防抖自动保存: 避免频繁写盘
 * - 并发写入控制: _persistPromise 确保同时只有一个持久化任务
 * - 脏标记: _dirty 标记避免无效持久化
 *
 * @version 3.0.0 - 全JSON架构：内存运行时 + 防抖自动持久化
 */
import ItemResolver from '../../utils/ItemResolver.js';
import { FileStorage } from '../../utils/fileStorage.js';

const SCHEMA_VERSION = 1
const MARKET_FILENAME = 'market.json'
const AUTO_SAVE_DELAY_MS = 5000  // 自动保存防抖延迟（毫秒）

export class MarketDataManager {
  constructor(redisClient, config) {
    this.redis = redisClient;
    this.config = config;
    this.itemResolver = new ItemResolver(config);

    this.storage = new FileStorage('data/market');
    this._marketData = null;

    // 自动持久化控制
    this._dirty = false;           // 脏标记：数据是否已修改
    this._saveTimer = null;        // 防抖定时器
    this._persistPromise = null;   // 并发写入控制：确保同时只有一个持久化任务

    // 获取市场配置
    this.marketConfig = this.config.market
    this.batchSize = this.marketConfig.batch_size
    this.historyDays = this.marketConfig.pricing?.history_days || 7
    this.minBaseSupply = this.marketConfig.pricing?.min_base_supply || 1
  }

  _getDefaultData() {
    return {
      version: SCHEMA_VERSION,
      lastPersistedAt: 0,
      items: {},
      globalStats: {
        totalItems: 0,
        lastUpdate: 0,
        updateCount: 0,
        avgUpdateTime: 0,
        errorCount: 0,
        lastReset: 0,
        lastResetCount: 0
      }
    }
  }

  /**
   * 从 JSON 文件加载市场数据到内存
   */
  async loadFromFile() {
    try {
      await this.storage.init();
      const data = await this.storage.readJSON(MARKET_FILENAME, null);

      if (!data || typeof data !== 'object') {
        this._marketData = this._getDefaultData();
        return;
      }

      const defaults = this._getDefaultData();
      this._marketData = {
        version: data.version ?? SCHEMA_VERSION,
        lastPersistedAt: data.lastPersistedAt ?? 0,
        items: data.items && typeof data.items === 'object' ? data.items : {},
        globalStats: { ...defaults.globalStats, ...(data.globalStats || {}) }
      };
    } catch (error) {
      logger.error('[MarketDataManager] 加载市场数据失败:', error);
      this._marketData = this._getDefaultData();
    }
  }

  /**
   * 确保内存中的市场数据已加载
   * @private
   */
  async _ensureMarketDataLoaded() {
    if (!this._marketData) {
      await this.loadFromFile();
    }
  }

  /**
   * 标记数据已变脏并启动防抖持久化
   *
   * 采用防抖策略：5秒内如果有新的修改，则重置定时器，避免频繁写文件。
   * timer.unref() 防止定时器阻止Node.js进程退出。
   *
   * @private
   */
  _markDirty() {
    if (!this._marketData) {
      return;
    }

    this._dirty = true;

    // 清除旧定时器
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }

    // 启动新的防抖定时器
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flushIfDirty().catch(error => {
        logger.error(`[MarketDataManager] 自动持久化失败: ${error.message}`);
      });
    }, AUTO_SAVE_DELAY_MS);

    // 允许进程在定时器期间退出（不阻塞进程关闭）
    if (typeof this._saveTimer?.unref === 'function') {
      this._saveTimer.unref();
    }
  }

  /**
   * 如果数据已标记为脏，则执行持久化
   * @private
   */
  async _flushIfDirty() {
    if (!this._dirty) {
      return;
    }

    this._dirty = false;
    await this.persistToFile();
  }

  /**
   * 将内存中的市场数据持久化到 JSON 文件（原子写入）
   *
   * 通过 _persistPromise 确保并发安全：同时只有一个持久化任务在执行。
   * 使用临时文件+原子rename避免写入过程中崩溃导致数据损坏。
   */
  async persistToFile() {
    // 并发控制：如果已有持久化任务在执行，直接返回同一个Promise
    if (this._persistPromise) {
      return this._persistPromise;
    }

    this._persistPromise = (async () => {
      if (!this._marketData) {
        await this.loadFromFile();
      }

      this._marketData.lastPersistedAt = Date.now();
      const tempFile = `${MARKET_FILENAME}.tmp.${Date.now()}`;

      try {
        await this.storage.init();
        await this.storage.writeJSON(tempFile, this._marketData);
        await this.storage.rename(tempFile, MARKET_FILENAME);
        logger.info(`[MarketDataManager] 市场数据已持久化，物品数: ${Object.keys(this._marketData.items).length}`);
      } catch (error) {
        try { await this.storage.deleteFile(tempFile); } catch { /* ignore */ }
        throw new Error(`持久化市场数据失败: ${error.message}`, { cause: error });
      } finally {
        this._persistPromise = null;
      }
    })();

    return this._persistPromise;
  }

  /**
   * 初始化市场数据
   * 为所有浮动价格物品创建初始的市场数据结构（基于 JSON 存储）
   * @returns {Promise<Object>} 初始化结果
   */
  async initializeMarketData() {
    try {
      await this._ensureMarketDataLoaded();

      const floatingItems = this._getFloatingPriceItems();
      logger.info(`[MarketDataManager] 开始初始化 ${floatingItems.length} 个浮动价格物品的市场数据`);

      let successCount = 0;
      const errors = [];

      for (const itemId of floatingItems) {
        try {
          const existing = this._marketData.items[itemId];

          if (!existing || !existing.stats) {
            const itemInfo = this.itemResolver.getItemInfo(itemId);
            if (itemInfo) {
              const basePrice = itemInfo.price;

              // 验证价格数据完整性
              if (this._validatePriceData(basePrice, itemId)) {
                const now = Date.now();

                this._marketData.items[itemId] = {
                  stats: {
                    basePrice,
                    currentPrice: basePrice,
                    supply24h: 0,
                    lastUpdated: now,
                    priceTrend: 'stable',
                    priceHistory: [basePrice],
                    lastTransaction: 0,
                    lastReset: now,
                    lastArchive: 0
                  },
                  supplyHistory: Array.isArray(existing?.supplyHistory) ? existing.supplyHistory : []
                };

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
      await this.persistToFile();

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
   * 记录交易统计数据（内存写入 + 防抖持久化）
   * 仅记录卖出（supply）统计，买入（buy）交易静默忽略
   * @param {string} itemId 物品ID
   * @param {number} quantity 交易数量
   * @param {string} transactionType 交易类型: 'buy' | 'sell'
   * @returns {Promise<boolean>} 记录是否成功
   */
  async recordTransaction(itemId, quantity, transactionType) {
    try {
      // 只记录 sell（供应统计），buy 交易不记录
      if (transactionType === 'buy') {
        return true;
      }

      const isFloating = await this._isFloatingPriceItem(itemId);
      if (!isFloating) {
        return false;
      }

      await this._ensureMarketDataLoaded();

      const itemData = this._marketData.items[itemId];
      if (!itemData || !itemData.stats) {
        logger.warn(`[MarketDataManager] 记录交易统计时发现物品数据不存在: ${itemId}`);
        return false;
      }

      const stats = itemData.stats;
      const delta = Number(quantity);

      // 验证数量有效性
      if (!Number.isFinite(delta) || delta <= 0) {
        logger.warn(`[MarketDataManager] 无效的交易数量: itemId=${itemId}, quantity=${quantity}, type=${transactionType}`);
        return false;
      }

      const current = Number.isFinite(stats.supply24h) ? stats.supply24h : 0;

      stats.supply24h = current + delta;
      stats.lastTransaction = Date.now();

      this._markDirty();

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
      await this._ensureMarketDataLoaded();

      const itemData = this._marketData.items[itemId];

      if (!itemData || !itemData.stats) {
        logger.warn(`[MarketDataManager] 归档供应量时发现物品数据不存在: ${itemId}`);
        return { success: false, dailySupply: 0, historyLength: 0 };
      }

      const dailySupply = Number.isFinite(itemData.stats.supply24h)
        ? itemData.stats.supply24h
        : 0;

      if (!Array.isArray(itemData.supplyHistory)) {
        itemData.supplyHistory = [];
      }

      itemData.supplyHistory.unshift(dailySupply);
      if (itemData.supplyHistory.length > this.historyDays) {
        itemData.supplyHistory.length = this.historyDays;
      }

      itemData.stats.supply24h = 0;
      itemData.stats.lastArchive = Date.now();

      const historyLength = itemData.supplyHistory.length;

      this._markDirty();

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
      await this._ensureMarketDataLoaded();

      const itemData = this._marketData.items[itemId];
      const history = Array.isArray(itemData?.supplyHistory) ? itemData.supplyHistory : [];

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
   * 批量归档所有浮动价格物品的供应量
   * 从内存 stats.supply24h 归档到 supplyHistory，然后重置为0
   * @returns {Promise<Object>} 归档结果统计
   */
  async archiveAllDailySupply() {
    const startTime = Date.now();
    const errors = [];

    try {
      await this._ensureMarketDataLoaded();

      const floatingItems = this._getFloatingPriceItems();
      logger.info(`[MarketDataManager] 开始归档 ${floatingItems.length} 个物品的每日供应量`);

      const archiveTime = Date.now();

      for (const itemId of floatingItems) {
        const itemIdStr = itemId;

        // 从内存中读取 supply24h
        const dailySupply = (() => {
          try {
            const itemData = this._marketData.items[itemIdStr];
            if (!itemData || !itemData.stats) {
              return 0;
            }
            return Number.isFinite(itemData.stats.supply24h)
              ? itemData.stats.supply24h
              : 0;
          } catch {
            return 0;
          }
        })();

        try {
          let itemData = this._marketData.items[itemIdStr];
          if (!itemData) {
            itemData = this._marketData.items[itemIdStr] = { stats: {}, supplyHistory: [] };
          }
          if (!itemData.stats) {
            itemData.stats = {};
          }
          if (!Array.isArray(itemData.supplyHistory)) {
            itemData.supplyHistory = [];
          }

          // 归档到历史列表
          itemData.supplyHistory.unshift(dailySupply);
          if (itemData.supplyHistory.length > this.historyDays) {
            itemData.supplyHistory.length = this.historyDays;
          }

          // 重置供应量并更新归档时间
          if (itemData.stats) {
            itemData.stats.lastArchive = archiveTime;
            itemData.stats.supply24h = 0;
          }
        } catch (error) {
          errors.push(`物品 ${itemIdStr} 归档失败: ${error.message}`);
        }
      }

      // 持久化到 JSON
      await this.persistToFile();

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

      await this._ensureMarketDataLoaded();

      const stats = [];

      for (const itemId of ids) {
        const itemData = this._marketData.items[itemId];
        const rawStats = itemData && itemData.stats;

        if (rawStats && Object.keys(rawStats).length > 0) {
          stats.push({
            itemId,
            ...this._parseStatsData(rawStats)
          });
        } else {
          stats.push({
            itemId,
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
            const priceChange = stats.basePrice > 0
              ? ((stats.currentPrice - stats.basePrice) / stats.basePrice * 100)
              : 0;

            categoryGroups[categoryName].push({
              id: itemId,
              name: itemInfo.name,
              currentPrice: stats.currentPrice,
              basePrice: stats.basePrice,
              priceChange: parseFloat(priceChange.toFixed(1)),
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
            const priceChange = stats.basePrice > 0
              ? ((stats.currentPrice - stats.basePrice) / stats.basePrice * 100)
              : 0;

            allItems.push({
              id: itemId,
              name: itemInfo.name,
              icon: itemInfo.icon,
              currentPrice: Math.round(stats.currentPrice),
              basePrice: stats.basePrice,
              priceChange: parseFloat(priceChange.toFixed(1)),
              priceTrend: stats.priceTrend,
              priceHistory: stats.priceHistory || [],
              supply24h: stats.supply24h || 0,
              volatility: Math.abs(priceChange)
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
   * 生成 SVG Sparkline 路径（平滑贝塞尔曲线）
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

    const data = priceHistory.slice(-24);
    if (data.length < 2) {
      return `M 0 ${height / 2} L ${width} ${height / 2}`;
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const effectiveHeight = height - padding * 2;

    const points = data.map((price, i) => ({
      x: (i / (data.length - 1)) * width,
      y: padding + effectiveHeight - ((price - min) / range * effectiveHeight)
    }));

    return this._catmullRomToPath(points);
  }

  /**
   * Catmull-Rom 样条转 SVG 贝塞尔路径
   * @param {Array<{x: number, y: number}>} points 点数组
   * @param {number} tension 张力系数（0-1，越小越平滑）
   * @returns {string} SVG path d属性值
   * @private
   */
  _catmullRomToPath(points, tension = 0.5) {
    if (points.length < 2) return '';
    if (points.length === 2) {
      return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
    }

    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || points[points.length - 1];

      const cp1x = p1.x + (p2.x - p0.x) * tension / 3;
      const cp1y = p1.y + (p2.y - p0.y) * tension / 3;
      const cp2x = p2.x - (p3.x - p1.x) * tension / 3;
      const cp2y = p2.y - (p3.y - p1.y) * tension / 3;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    return d;
  }

  /**
   * 重置每日统计数据（重置内存中的 supply24h）
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

      await this._ensureMarketDataLoaded();

      const floatingItems = this._getFloatingPriceItems();
      logger.info(`[MarketDataManager] 开始重置 ${floatingItems.length} 个物品的日统计数据`);

      const resetTime = Date.now();

      // 遍历所有浮动价格物品，重置内存中的统计数据
      for (const itemId of floatingItems) {
        try {
          const itemData = this._marketData.items[itemId];
          if (!itemData || !itemData.stats) {
            continue;
          }

          itemData.stats.supply24h = 0;
          itemData.stats.lastReset = resetTime;

          resetCount++;
        } catch (error) {
          errors.push(`重置物品 ${itemId} 日统计失败: ${error.message}`);
        }
      }

      // 更新全局统计（保存在 JSON 中）
      const globalStats = this._marketData.globalStats || {};
      globalStats.lastReset = resetTime;
      globalStats.lastResetCount = (Number(globalStats.lastResetCount) || 0) + resetCount;
      this._marketData.globalStats = globalStats;

      // 触发防抖持久化
      if (resetCount > 0) {
        this._markDirty();
      }

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

      await this._ensureMarketDataLoaded();

      let validUpdates = 0;
      const errors = [];

      for (const update of updates) {
        try {
          if (this._validateUpdateData(update)) {
            const itemId = update.itemId;
            let itemData = this._marketData.items[itemId];

            if (!itemData || !itemData.stats) {
              const itemInfo = this.itemResolver.getItemInfo(itemId);
              const basePrice = itemInfo?.price;
              if (!this._validatePriceData(basePrice, itemId)) {
                errors.push(`无效的基础数据: ${itemId}`);
                continue;
              }

              const now = Date.now();
              itemData = this._marketData.items[itemId] = {
                stats: {
                  basePrice,
                  currentPrice: basePrice,
                  supply24h: 0,
                  lastUpdated: now,
                  priceTrend: 'stable',
                  priceHistory: [basePrice],
                  lastTransaction: 0,
                  lastReset: now,
                  lastArchive: 0
                },
                supplyHistory: []
              };
            }

            const stats = itemData.stats;
            const data = update.data || {};

            if (data.base_price !== undefined) {
              stats.basePrice = parseFloat(data.base_price) || stats.basePrice;
            }
            if (data.current_price !== undefined) {
              stats.currentPrice = parseFloat(data.current_price) || stats.currentPrice;
            }
            if (data.supply_24h !== undefined) {
              stats.supply24h = parseInt(data.supply_24h) || 0;
            }
            if (data.last_updated !== undefined) {
              stats.lastUpdated = parseInt(data.last_updated) || stats.lastUpdated || Date.now();
            }
            if (data.price_trend !== undefined) {
              stats.priceTrend = data.price_trend || stats.priceTrend;
            }
            if (data.price_history !== undefined) {
              stats.priceHistory = this._parsePriceHistory(data.price_history);
            }
            if (data.last_transaction !== undefined) {
              stats.lastTransaction = parseInt(data.last_transaction) || stats.lastTransaction || 0;
            }
            if (data.last_reset !== undefined) {
              stats.lastReset = parseInt(data.last_reset) || stats.lastReset || 0;
            }
            if (data.last_archive !== undefined) {
              stats.lastArchive = parseInt(data.last_archive) || stats.lastArchive || 0;
            }

            validUpdates++;
          } else {
            errors.push(`无效的更新数据: ${update.itemId}`);
          }
        } catch (error) {
          errors.push(`处理更新 ${update.itemId} 失败: ${error.message}`);
        }
      }

      await this.persistToFile();

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
   * @param {string} itemId 物品ID
   * @returns {boolean} 验证结果
   * @private
   */
  _validatePriceData(basePrice, itemId) {
    if (basePrice === undefined) {
      logger.warn(`[MarketDataManager] 物品 ${itemId} 价格数据不完整`);
      return false;
    }

    if (typeof basePrice !== 'number' || basePrice <= 0) {
      logger.warn(`[MarketDataManager] 物品 ${itemId} 价格数据无效: price=${basePrice}`);
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
   * @param {Object} data 统计数据（Redis哈希或JSON stats对象）
   * @returns {Object} 解析后的数据
   * @private
   */
  _parseStatsData(data) {
    if (!data || typeof data !== 'object') {
      return {
        basePrice: 0,
        currentPrice: 0,
        supply24h: 0,
        lastUpdated: 0,
        priceTrend: 'stable',
        priceHistory: [],
        lastTransaction: 0,
        lastReset: 0,
        lastArchive: 0
      };
    }

    let basePrice;
    let currentPrice;
    let supply24h;
    let lastUpdated;
    let priceTrend;
    let priceHistory;
    let lastTransaction;
    let lastReset;
    let lastArchive;

    // 兼容 Redis 哈希结构（下划线命名）
    if (data.base_price !== undefined || data.current_price !== undefined) {
      basePrice = parseFloat(data.base_price) || 0;
      currentPrice = parseFloat(data.current_price) || 0;
      supply24h = parseInt(data.supply_24h) || 0;
      lastUpdated = parseInt(data.last_updated) || 0;
      priceTrend = data.price_trend || 'stable';
      priceHistory = this._parsePriceHistory(data.price_history);
      lastTransaction = parseInt(data.last_transaction) || 0;
      lastReset = parseInt(data.last_reset) || 0;
      lastArchive = parseInt(data.last_archive) || 0;
    } else {
      // JSON 文件中的 stats 结构（驼峰命名）
      basePrice = typeof data.basePrice === 'number' ? data.basePrice : 0;
      currentPrice = typeof data.currentPrice === 'number' ? data.currentPrice : 0;
      supply24h = typeof data.supply24h === 'number' ? data.supply24h : 0;
      lastUpdated = typeof data.lastUpdated === 'number' ? data.lastUpdated : 0;
      priceTrend = data.priceTrend || 'stable';
      priceHistory = Array.isArray(data.priceHistory) ? data.priceHistory : [];
      lastTransaction = typeof data.lastTransaction === 'number' ? data.lastTransaction : 0;
      lastReset = typeof data.lastReset === 'number' ? data.lastReset : 0;
      lastArchive = typeof data.lastArchive === 'number' ? data.lastArchive : 0;
    }

    // 如果只有一个价格字段可用，则将其作为两个价格的共同基准
    if (basePrice <= 0 && currentPrice > 0) {
      basePrice = currentPrice;
    } else if (currentPrice <= 0 && basePrice > 0) {
      currentPrice = basePrice;
    }

    return {
      basePrice,
      currentPrice,
      supply24h,
      lastUpdated,
      priceTrend,
      priceHistory,
      lastTransaction,
      lastReset,
      lastArchive
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
      await this._ensureMarketDataLoaded();

      const now = Date.now();
      const existing = this._marketData.globalStats || {};

      this._marketData.globalStats = {
        totalItems: typeof totalItems === 'number' ? totalItems : Number(existing.totalItems) || 0,
        lastUpdate: existing.lastUpdate || now,
        updateCount: Number(existing.updateCount) || 0,
        avgUpdateTime: Number(existing.avgUpdateTime) || 0,
        errorCount: Number(existing.errorCount) || 0,
        lastReset: existing.lastReset || now,
        lastResetCount: Number(existing.lastResetCount) || 0
      };
    } catch (error) {
      logger.error(`[MarketDataManager] 初始化全局统计失败: ${error.message}`);
    }
  }
}

export default MarketDataManager;
