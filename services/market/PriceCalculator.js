/**
 * @fileoverview 价格计算服务 - 活跃度驱动动态定价引擎 (v3.0)
 *
 * Input:
 * - ../../utils/CommonUtils.js - CommonUtils (安全计算工具)
 *
 * Output:
 * - PriceCalculator (class) - 价格计算引擎类,提供:
 *   - calculatePrice: 计算物品价格(活跃度驱动模式)
 *   - _calculateActivity: 计算市场活跃度
 *   - _calculateDynamicMomentum: 计算动态惯性系数
 *   - _calculateDynamicVolatility: 计算动态波动系数
 *   - _generateGaussianNoise: 生成正态分布噪声
 *   - _clampPrice: 价格边界限制
 *
 * Pos: 服务层子服务,负责市场价格计算的核心算法逻辑
 *
 * 核心算法 (活跃度驱动模式 v3.0):
 * 1. 活跃度计算: activity = actualSupply / (baseSupply × threshold)
 * 2. 动态惯性: momentum ∈ [0.3, 0.85], 随活跃度增加而减弱
 * 3. 动态波动: volatility ∈ [0.02, 0.12], 随活跃度增加而增强
 * 4. 价格公式: newPrice = (currentPrice × momentum) + (targetPrice × (1 - momentum)) + noise
 * 5. 目标价格: targetPrice = basePrice × (baseSupply / actualSupply)
 * 6. 正态噪声: noise ~ N(0, volatility × currentPrice), 截断3σ
 * 7. 价格边界: price ∈ [basePrice × minRatio, basePrice × maxRatio]
 *
 * 算法特性:
 * - 惯性延续: 价格变化平滑,避免剧烈波动
 * - 市场回归: 价格向目标价格靠拢(供需平衡)
 * - 活跃度调节: 市场活跃时波动增强、惯性减弱
 * - 正态噪声: 模拟市场随机性
 */
import { CommonUtils } from '../../utils/CommonUtils.js';

export class PriceCalculator {
  constructor(config) {
    this.config = config;
    this.cache = new Map();

    const pricing = this.config.market?.pricing || {};

    // 价格边界
    this.minRatio = pricing.min_ratio ?? 0.5;
    this.maxRatio = pricing.max_ratio ?? 1.5;
    this.stabilityThreshold = pricing.stability_threshold ?? 2;

    // 供应参数
    this.extremeRatioMax = pricing.extreme_ratio_max ?? 10;
    this.extremeRatioMin = pricing.extreme_ratio_min ?? 0.1;
    this.minBaseSupply = pricing.min_base_supply ?? 1;
    this.historyDays = pricing.history_days ?? 7;

    // 动态惯性配置
    const momentum = pricing.momentum || {};
    this.momentumMin = momentum.min ?? 0.3;
    this.momentumMax = momentum.max ?? 0.85;

    // 动态波动配置
    const volatility = pricing.volatility || {};
    this.volatilityMin = volatility.min ?? 0.02;
    this.volatilityMax = volatility.max ?? 0.12;
    this.volatilityTruncate = volatility.truncate ?? 3;

    // 活跃度阈值
    this.activityThreshold = pricing.activity_threshold ?? 2;
  }

  /**
   * 计算物品价格（活跃度驱动模式）
   * @param {string} itemId 物品ID
   * @param {number} basePrice 基准价格
   * @param {number} baseSupply 基准供应量（7日平均）
   * @param {number} actualSupply 昨日实际供应量
   * @param {number} currentPrice 当前价格（用于惯性计算）
   * @returns {Object} 价格计算结果
   */
  async calculatePrice(itemId, basePrice, baseSupply, actualSupply, currentPrice) {
    try {
      CommonUtils.validatePrice(basePrice, `base price for ${itemId}`);

      // 确保 currentPrice 有效，否则用 basePrice
      const validCurrentPrice = (typeof currentPrice === 'number' && isFinite(currentPrice) && currentPrice > 0)
        ? currentPrice
        : basePrice;

      // 1. 计算活跃度 [0, 1]
      const activity = this._calculateActivity(baseSupply, actualSupply);

      // 2. 动态参数
      const momentum = this._lerp(this.momentumMax, this.momentumMin, activity);
      const volatility = this._lerp(this.volatilityMin, this.volatilityMax, activity);

      // 3. 计算供应驱动的目标价格（线性映射，配置直接生效）
      const targetPrice = this._calculateTargetPrice(basePrice, baseSupply, actualSupply);

      // 4. 正态分布噪声
      const noise = this._sampleNoise(volatility);

      // 5. 最终价格 = 惯性延续 + 市场回归 + 随机扰动
      const rawPrice = validCurrentPrice * momentum
        + targetPrice * (1 - momentum)
        + basePrice * noise;

      // 6. 边界限制
      const finalPrice = this._clampPrice(rawPrice, basePrice);

      CommonUtils.validatePrice(finalPrice, `final price for ${itemId}`);

      const result = {
        itemId,
        basePrice,
        price: finalPrice,
        baseSupply,
        supply: actualSupply,
        activity,
        momentum,
        volatility,
        targetPrice,
        noise,
        timestamp: Date.now()
      };

      logger.debug(`[PriceCalculator] 价格计算`, {
        itemId,
        basePrice,
        currentPrice: validCurrentPrice,
        targetPrice: targetPrice.toFixed(2),
        finalPrice: finalPrice.toFixed(2),
        activity: activity.toFixed(3),
        momentum: momentum.toFixed(3),
        volatility: volatility.toFixed(4),
        noise: noise.toFixed(4)
      });

      return result;
    } catch (error) {
      logger.error(`[PriceCalculator] 价格计算失败 [${itemId}]: ${error.message}`);
      return {
        itemId,
        basePrice,
        price: basePrice,
        baseSupply,
        supply: actualSupply,
        activity: 0,
        momentum: this.momentumMax,
        volatility: this.volatilityMin,
        targetPrice: basePrice,
        noise: 0,
        timestamp: Date.now(),
        degraded: true
      };
    }
  }

  /**
   * 计算活跃度 [0, 1]
   * @private
   */
  _calculateActivity(baseSupply, actualSupply) {
    const safeBase = Math.max(baseSupply, this.minBaseSupply);
    const safeActual = Math.max(actualSupply, 0);

    // 活跃度 = 实际供应 / (基准供应 × 阈值)
    const rawActivity = safeActual / (safeBase * this.activityThreshold);

    return Math.min(1, Math.max(0, rawActivity));
  }

  /**
   * 计算供应驱动的目标价格（线性映射）
   * @private
   */
  _calculateTargetPrice(basePrice, baseSupply, actualSupply) {
    const safeBase = Math.max(baseSupply, this.minBaseSupply);
    const safeActual = Math.max(actualSupply, 0);

    // 供需比：base / actual，供应少则比值大
    let ratio;
    if (safeActual <= 0) {
      ratio = this.extremeRatioMax; // 无供应，极端短缺
    } else {
      ratio = safeBase / safeActual;
    }

    // 限制在极端范围内
    const clampedRatio = Math.max(this.extremeRatioMin, Math.min(this.extremeRatioMax, ratio));

    // 线性映射到 [minRatio, maxRatio]
    // ratio 高 → 短缺 → 高价
    // ratio 低 → 过剩 → 低价
    const normalizedRatio = (clampedRatio - this.extremeRatioMin)
      / (this.extremeRatioMax - this.extremeRatioMin);

    const multiplier = this.minRatio + normalizedRatio * (this.maxRatio - this.minRatio);

    return basePrice * multiplier;
  }

  /**
   * 正态分布噪声采样（Box-Muller）
   * @param {number} sigma 标准差
   * @returns {number} 噪声值
   * @private
   */
  _sampleNoise(sigma) {
    if (sigma <= 0) return 0;

    // Box-Muller 变换
    let u1 = 0;
    do { u1 = Math.random(); } while (u1 === 0);
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    // N(0, sigma)
    const noise = z * sigma;

    // 截断极端值
    const maxNoise = sigma * this.volatilityTruncate;
    return Math.max(-maxNoise, Math.min(maxNoise, noise));
  }

  /**
   * 线性插值
   * @private
   */
  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * 限制价格在配置范围内
   * @private
   */
  _clampPrice(price, basePrice) {
    return CommonUtils.safeCalculation(() => {
      CommonUtils.validatePrice(price, 'price in clamp');
      CommonUtils.validatePrice(basePrice, 'base price in clamp');

      const minPrice = basePrice * this.minRatio;
      const maxPrice = basePrice * this.maxRatio;
      const clamped = Math.max(minPrice, Math.min(maxPrice, price));

      return Math.round(clamped * 100) / 100;
    }, basePrice);
  }

  /**
   * 批量价格计算
   */
  async calculateBatchPrices(items) {
    const results = [];
    const startTime = Date.now();

    try {
      logger.info(`[PriceCalculator] 开始批量计算 ${items.length} 个物品价格`);

      const promises = items.map(item =>
        this.calculatePrice(
          item.itemId,
          item.basePrice,
          item.baseSupply,
          item.actualSupply,
          item.currentPrice
        )
      );

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      const duration = Date.now() - startTime;
      logger.info(`[PriceCalculator] 批量计算完成，耗时: ${duration}ms`);

      return results;
    } catch (error) {
      logger.error(`[PriceCalculator] 批量计算失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 分析价格趋势
   */
  analyzePriceTrend(oldPrice, newPrice) {
    return CommonUtils.safeCalculation(() => {
      CommonUtils.validatePrice(oldPrice, 'old price');
      CommonUtils.validatePrice(newPrice, 'new price');

      if (oldPrice === 0) return 'stable';

      const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

      if (Math.abs(changePercent) < this.stabilityThreshold) return 'stable';
      return changePercent > 0 ? 'rising' : 'falling';
    }, 'stable');
  }

  /**
   * 更新价格历史记录
   */
  updatePriceHistory(historyString, newPrice) {
    const validPrice = (typeof newPrice === 'number' && isFinite(newPrice) && newPrice >= 0)
      ? newPrice
      : 0;

    let history = [];

    try {
      const parsed = JSON.parse(historyString);
      if (Array.isArray(parsed)) {
        history = parsed.filter(p => typeof p === 'number' && isFinite(p) && p >= 0);
      }
    } catch {
      history = [];
    }

    history.push(validPrice);

    const maxRecords = this.config.market?.history?.max_records || 168;
    if (history.length > maxRecords) {
      history = history.slice(-maxRecords);
    }

    return history;
  }

  clearCache() {
    this.cache.clear();
    logger.debug('[PriceCalculator] 缓存已清理');
  }

  getCacheStats() {
    return { size: this.cache.size, maxSize: 1000 };
  }
}

export default PriceCalculator;
