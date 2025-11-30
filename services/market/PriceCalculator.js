/**
 * PriceCalculator - 价格计算服务
 * 
 * 专门负责动态价格计算、价格趋势分析和价格历史管理。
 * 从原有MarketService中提取的价格计算核心逻辑。
 * 
 * @version 1.0.0
 */
import { CommonUtils } from '../../utils/CommonUtils.js';

export class PriceCalculator {
  constructor(config) {
    this.config = config;
    this.cache = new Map(); // 价格计算缓存

    // 获取价格计算配置
    this.pricingConfig = this.config.market?.pricing
    this.sensitivity = this.pricingConfig.sensitivity
    this.minRatio = this.pricingConfig.min_ratio
    this.maxRatio = this.pricingConfig.max_ratio
    this.sellPriceRatio = this.pricingConfig.sell_price_ratio
    this.stabilityThreshold = this.pricingConfig.stability_threshold
    this.extremeRatioMax = this.pricingConfig.extreme_ratio_max
    this.extremeRatioMin = this.pricingConfig.extreme_ratio_min
    this.minBaseSupply = this.pricingConfig.min_base_supply || 1
    this.historyDays = this.pricingConfig.history_days || 7
  }

  /**
   * 计算物品价格（纯供应驱动模式）
   * @param {string} itemId 物品ID
   * @param {number} basePrice 基准价格
   * @param {number} baseSupply 基准供应量（7日平均）
   * @param {number} actualSupply 昨日实际供应量
   * @returns {Object} 价格计算结果
   */
  async calculatePrice(itemId, basePrice, baseSupply, actualSupply) {
    try {
      // 验证输入参数
      CommonUtils.validatePrice(basePrice, `base price for ${itemId}`);

      const cacheKey = `${itemId}_${basePrice}_${baseSupply}_${actualSupply}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // 计算供应比率
      const ratio = this._calculateSupplyRatio(baseSupply, actualSupply);

      // 计算新价格
      const calculatedPrice = this._calculatePriceFromSupply(basePrice, ratio);
      const clampedBuyPrice = this._clampPrice(calculatedPrice, basePrice);
      const newSellPrice = clampedBuyPrice * this.sellPriceRatio;

      // 验证最终价格
      CommonUtils.validatePrice(clampedBuyPrice, `final buy price for ${itemId}`);
      CommonUtils.validatePrice(newSellPrice, `final sell price for ${itemId}`);

      const result = {
        itemId,
        basePrice,
        buyPrice: clampedBuyPrice,
        sellPrice: parseFloat(newSellPrice.toFixed(2)),
        baseSupply,
        supply: actualSupply,
        ratio,
        timestamp: Date.now()
      };

      // 缓存结果（24小时TTL，因为每日只更新一次）
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 24 * 60 * 60 * 1000);

      return result;
    } catch (error) {
      logger.error(`[PriceCalculator] 价格计算失败 [${itemId}]: ${error.message}`);
      // 返回降级结果
      return {
        itemId,
        basePrice,
        buyPrice: basePrice,
        sellPrice: basePrice * this.sellPriceRatio,
        baseSupply,
        supply: actualSupply,
        ratio: 1,
        timestamp: Date.now(),
        degraded: true
      };
    }
  }

  /**
   * 计算供应比率（纯供应驱动）
   * @param {number} baseSupply 基准供应量（7日平均）
   * @param {number} actualSupply 昨日实际供应量
   * @returns {number} 供应比率
   * @private
   */
  _calculateSupplyRatio(baseSupply, actualSupply) {
    const safeBaseSupply = Number.isFinite(baseSupply) && baseSupply > 0 ? baseSupply : 0;
    const safeActualSupply = Number.isFinite(actualSupply) && actualSupply > 0 ? actualSupply : 0;

    // 冷启动 / 无人交易：保持价格稳定
    if (safeActualSupply <= 0 && safeBaseSupply <= 0) {
      logger.debug(`[PriceCalculator] 供应冷启动: baseSupply=${safeBaseSupply}, actualSupply=${safeActualSupply}, ratio=1`);
      return 1;
    }

    // 有历史基准但昨日无供应：严重短缺 → 高价
    if (safeActualSupply <= 0 && safeBaseSupply > 0) {
      logger.debug(`[PriceCalculator] 零供应短缺: baseSupply=${safeBaseSupply}, ratio=${this.extremeRatioMax}`);
      return this.extremeRatioMax;
    }

    // 无历史基准但有实际供应：暂时保持中性
    if (safeBaseSupply <= 0 && safeActualSupply > 0) {
      logger.debug(`[PriceCalculator] 无基准供应，中性比率: actualSupply=${safeActualSupply}, ratio=1`);
      return 1;
    }

    // 正常情况：baseSupply / actualSupply
    // 供应多于基准 → ratio < 1 → 价格下跌
    // 供应少于基准 → ratio > 1 → 价格上涨
    const ratio = safeBaseSupply / safeActualSupply;

    // 确保 ratio 始终在合理范围内（防止 log 计算异常）
    const clampedRatio = Math.max(this.extremeRatioMin, Math.min(this.extremeRatioMax, ratio));
    logger.debug(`[PriceCalculator] 供应驱动: baseSupply=${safeBaseSupply}, actualSupply=${safeActualSupply}, ratio=${ratio.toFixed(4)}, clamped=${clampedRatio.toFixed(4)}`);
    return clampedRatio;
  }

  /**
   * 批量价格计算
   * @param {Array} items 物品数组 [{itemId, basePrice, baseSupply, actualSupply}]
   * @returns {Promise<Array>} 批量计算结果
   */
  async calculateBatchPrices(items) {
    const results = [];
    const startTime = Date.now();

    try {
      logger.info(`[PriceCalculator] 开始批量计算 ${items.length} 个物品价格`);

      // 并行计算所有价格（利用缓存和快速计算）
      const promises = items.map(item =>
        this.calculatePrice(item.itemId, item.basePrice, item.baseSupply, item.actualSupply)
      );

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      const duration = Date.now() - startTime;
      logger.info(`[PriceCalculator] 批量计算完成，耗时: ${duration}ms，成功: ${results.length}/${items.length}`);

      return results;
    } catch (error) {
      logger.error(`[PriceCalculator] 批量计算失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 分析价格趋势
   * @param {number} oldPrice 旧价格
   * @param {number} newPrice 新价格
   * @returns {string} 趋势状态: 'rising' | 'falling' | 'stable'
   */
  analyzePriceTrend(oldPrice, newPrice) {
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

      let trend;
      if (Math.abs(changePercent) < this.stabilityThreshold) {
        trend = 'stable';
      } else if (changePercent > 0) {
        trend = 'rising';
      } else {
        trend = 'falling';
      }

      logger.debug(`[PriceCalculator] 趋势计算: ${oldPrice} -> ${newPrice} = ${trend} (${changePercent.toFixed(2)}%)`);
      return trend;
    }, 'stable');
  }

  /**
   * 更新价格历史记录
   * @param {string} historyString JSON格式的价格历史
   * @param {number} newPrice 新价格
   * @returns {Array<number>} 更新后的价格历史数组
   */
  updatePriceHistory(historyString, newPrice) {
    return CommonUtils.safeCalculation(() => {
      // 验证新价格
      CommonUtils.validatePrice(newPrice, 'new price in history update');

      let history = [];

      // 解析现有历史数据
      try {
        const parsed = JSON.parse(historyString);
        if (Array.isArray(parsed)) {
          // 过滤有效的数值价格
          history = parsed.filter(price =>
            typeof price === 'number' &&
            isFinite(price) &&
            price >= 0
          );
        }
      } catch (error) {
        logger.warn('[PriceCalculator] 解析价格历史数据失败，重新创建历史数组', {
          error: error.message,
          historyString
        });
        history = [];
      }

      // 添加新价格
      history.push(newPrice);

      // 获取最大记录数配置
      const maxRecords = this.config.market?.history?.max_records || 168;
      

      // 清理过期记录（FIFO）
      if (history.length > maxRecords) {
        history = history.slice(-maxRecords);
      }

      return history;
    }, [newPrice]);
  }

  /**
   * 根据供应比率计算物品价格（纯供应驱动）
   * @param {number} basePrice 基准价格
   * @param {number} ratio 供应比率（baseSupply / actualSupply）
   * @returns {number} 计算后的价格
   * @private
   */
  _calculatePriceFromSupply(basePrice, ratio) {
    return CommonUtils.safeCalculation(() => {
      // 验证基准价格
      CommonUtils.validatePrice(basePrice, 'base price in supply-based calculation');

      // 限制比率在合理范围内
      const clampedRatio = Math.max(this.extremeRatioMin, Math.min(this.extremeRatioMax, ratio));

      // 使用对数函数计算价格调整系数
      const adjustment = Math.log(clampedRatio) * this.sensitivity;

      // 计算新价格
      const newPrice = basePrice * (1 + adjustment);

      logger.debug(`[PriceCalculator] 价格计算详情`, {
        basePrice,
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
   * @param {number} calculatedPrice 计算出的价格
   * @param {number} basePrice 基准价格
   * @returns {number} 限制后的价格(保留2位小数)
   * @private
   */
  _clampPrice(calculatedPrice, basePrice) {
    return CommonUtils.safeCalculation(() => {
      // 验证输入参数
      CommonUtils.validatePrice(calculatedPrice, 'calculated price in clamp');
      CommonUtils.validatePrice(basePrice, 'base price in clamp');

      // 计算价格边界
      const minPrice = basePrice * this.minRatio;
      const maxPrice = basePrice * this.maxRatio;

      // 限制价格在边界内
      const clampedPrice = Math.max(minPrice, Math.min(maxPrice, calculatedPrice));

      // 保留2位小数
      const finalPrice = Math.round(clampedPrice * 100) / 100;

      // 验证最终价格
      CommonUtils.validatePrice(finalPrice, 'final clamped price');

      logger.debug(`[PriceCalculator] 价格限制详情`, {
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
   * 清理过期缓存
   */
  clearCache() {
    this.cache.clear();
    logger.debug('[PriceCalculator] 价格计算缓存已清理');
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 缓存统计
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: 1000, // 可配置
      hitRate: '未实现' // 可以添加命中率统计
    };
  }
}

export default PriceCalculator;