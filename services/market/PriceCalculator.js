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
  }

  /**
   * 计算物品价格
   * @param {string} itemId 物品ID
   * @param {number} basePrice 基准价格
   * @param {number} demand 24小时需求量
   * @param {number} supply 24小时供应量
   * @returns {Object} 价格计算结果
   */
  async calculatePrice(itemId, basePrice, demand, supply) {
    try {
      // 验证输入参数
      CommonUtils.validatePrice(basePrice, `base price for ${itemId}`);
      
      const cacheKey = `${itemId}_${basePrice}_${demand}_${supply}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // 计算新价格
      const calculatedPrice = this._calculatePriceFromSupplyDemand(basePrice, demand, supply);
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
        demand,
        supply,
        ratio: supply > 0 ? demand / supply : (demand > 0 ? this.extremeRatioMax : 1),
        timestamp: Date.now()
      };

      // 缓存结果（5分钟TTL）
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

      return result;
    } catch (error) {
      logger.error(`[PriceCalculator] 价格计算失败 [${itemId}]: ${error.message}`);
      // 返回降级结果
      return {
        itemId,
        basePrice,
        buyPrice: basePrice,
        sellPrice: basePrice * this.sellPriceRatio,
        demand,
        supply,
        ratio: 1,
        timestamp: Date.now(),
        degraded: true
      };
    }
  }

  /**
   * 批量价格计算
   * @param {Array} items 物品数组 [{itemId, basePrice, demand, supply}]
   * @returns {Promise<Array>} 批量计算结果
   */
  async calculateBatchPrices(items) {
    const results = [];
    const startTime = Date.now();

    try {
      logger.info(`[PriceCalculator] 开始批量计算 ${items.length} 个物品价格`);

      // 并行计算所有价格（利用缓存和快速计算）
      const promises = items.map(item => 
        this.calculatePrice(item.itemId, item.basePrice, item.demand, item.supply)
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
      
      // TODO: 实现基于时间的记录保留功能 - 为历史数据管理预留的配置项
      const keepDays = this.config.market?.history?.keep_days; // 未使用

      // 清理过期记录（FIFO）
      if (history.length > maxRecords) {
        history = history.slice(-maxRecords);
      }

      return history;
    }, [newPrice]);
  }

  /**
   * 根据供需数据计算物品价格
   * @param {number} basePrice 基准价格
   * @param {number} demand 24小时需求量
   * @param {number} supply 24小时供应量
   * @returns {number} 计算后的价格
   * @private
   */
  _calculatePriceFromSupplyDemand(basePrice, demand, supply) {
    return CommonUtils.safeCalculation(() => {
      // 验证基准价格
      CommonUtils.validatePrice(basePrice, 'base price in price calculation');

      let ratio;

      // 处理边界情况
      if (supply === 0) {
        // 零供应量：高需求系数或平衡状态
        ratio = demand > 0 ? this.extremeRatioMax : 1;
        logger.debug(`[PriceCalculator] 零供应情况: demand=${demand}, 使用比率=${ratio}`);
      } else if (demand === 0) {
        // 零需求量：低需求系数
        ratio = this.extremeRatioMin;
        logger.debug(`[PriceCalculator] 零需求情况: supply=${supply}, 使用比率=${ratio}`);
      } else {
        // 正常情况：计算供需比率
        ratio = demand / supply;
        logger.debug(`[PriceCalculator] 正常供需情况: demand=${demand}, supply=${supply}, ratio=${ratio}`);
      }

      // 限制比率在合理范围内
      const clampedRatio = Math.max(this.extremeRatioMin, Math.min(this.extremeRatioMax, ratio));

      // 使用对数函数计算价格调整系数
      const adjustment = Math.log(clampedRatio) * this.sensitivity;

      // 计算新价格
      const newPrice = basePrice * (1 + adjustment);

      logger.debug(`[PriceCalculator] 价格计算详情`, {
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