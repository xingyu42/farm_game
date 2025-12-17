/**
 * 公共工具类 - 消除代码重复，提供统一API
 *
 * 该工具类旨在解决项目中的代码重复问题，提供高质量、可复用的通用功能。
 * 所有方法都是静态方法，可以直接调用，无需实例化。
 *
 * 主要功能：
 * 1. 仓库使用率计算
 * 2. 参数验证工具（价格、数量）
 * 3. 安全数学计算（浮点精度处理）
 * 4. 数字格式化工具
 *
 * @author Claude Code
 * @version 1.1.0
 */
export class CommonUtils {
  /**
   * 计算仓库使用率百分比
   *
   * 统一管理所有服务中的仓库使用率计算逻辑，消除重复代码。
   * 支持边界情况处理，确保计算结果的准确性和可靠性。
   *
   * @param {Object} inventory - 仓库数据对象，键为物品ID，值为数量
   * @param {number} maxCapacity - 最大容量
   * @returns {number} 使用率百分比 (0-100)
   *
   * @example
   * const usage = CommonUtils.getInventoryUsagePercent({
   *   'crop_wheat': 50,
   *   'tool_hoe': 1
   * }, 100);
   * console.log(usage); // 51
   */
  static getInventoryUsagePercent(inventory, maxCapacity) {
    // 边界情况处理
    if (!inventory || typeof inventory !== 'object') {
      return 0;
    }

    if (typeof maxCapacity !== 'number' || maxCapacity <= 0) {
      return 0;
    }

    // 计算总物品数量
    const totalItems = Object.values(inventory).reduce((sum, quantity) => {
      const numQuantity = parseInt(quantity);
      return sum + (isNaN(numQuantity) ? 0 : Math.max(0, numQuantity));
    }, 0);

    // 计算使用率，确保不超过100%
    const usage = (totalItems / maxCapacity) * 100;
    return Math.min(100, Math.round(usage));
  }

  /**
   * @deprecated 使用 getInventoryUsagePercent 代替
   * @param {Object} inventory - 仓库数据对象
   * @param {number} maxCapacity - 最大容量
   * @returns {number} 使用率百分比 (0-100)
   */
  static calculateInventoryUsage(inventory, maxCapacity) {
    return CommonUtils.getInventoryUsagePercent(inventory, maxCapacity);
  }

  /**
   * 验证价格参数
   * 
   * 统一价格验证逻辑，确保价格数据的有效性和一致性。
   * 
   * @param {number} price - 价格值
   * @param {string} context - 上下文信息，用于错误报告
   * @returns {boolean} 验证结果，成功返回true
   * @throws {Error} 价格无效时抛出详细错误信息
   * 
   * @example
   * CommonUtils.validatePrice(100.5, 'buyItem price');
   * // 成功: 返回true
   * 
   * CommonUtils.validatePrice(-10, 'sellItem price');
   * // 失败: 抛出Error
   */
  static validatePrice(price, context = 'price') {
    if (typeof price !== 'number') {
      throw new Error(`Invalid price type in ${context}: expected number, got ${typeof price}`);
    }

    if (!isFinite(price)) {
      throw new Error(`Invalid price value in ${context}: ${price} (not finite)`);
    }

    if (price < 0) {
      throw new Error(`Invalid price value in ${context}: ${price} (negative value)`);
    }

    return true;
  }

  /**
   * 计算金币（解决浮点精度问题）
   * @param {number} price - 单价
   * @param {number} qty - 数量
   * @returns {number} 总价（保留2位小数）
   */
  static calcCoins(price, qty) {
    return Math.round((price * qty + Number.EPSILON) * 100) / 100;
  }

  /**
   * 验证数量参数
   *
   * 统一数量验证逻辑，确保数量数据的有效性。
   * 
   * @param {number} quantity - 数量值
   * @param {string} context - 上下文信息，用于错误报告
   * @returns {boolean} 验证结果，成功返回true
   * @throws {Error} 数量无效时抛出详细错误信息
   * 
   * @example
   * CommonUtils.validateQuantity(5, 'buyItem quantity');
   * // 成功: 返回true
   * 
   * CommonUtils.validateQuantity(0, 'sellItem quantity');
   * // 失败: 抛出Error
   */
  static validateQuantity(quantity, context = 'quantity') {
    if (typeof quantity !== 'number') {
      throw new Error(`Invalid quantity type in ${context}: expected number, got ${typeof quantity}`);
    }

    if (!Number.isInteger(quantity)) {
      throw new Error(`Invalid quantity value in ${context}: ${quantity} (not integer)`);
    }

    if (quantity <= 0) {
      throw new Error(`Invalid quantity value in ${context}: ${quantity} (must be positive)`);
    }

    return true;
  }

  /**
   * 安全的数学计算 - 防止NaN和Infinity
   * 
   * 包装数学计算逻辑，提供错误处理和备选值机制。
   * 确保计算结果的可靠性，避免异常值影响系统稳定性。
   * 
   * @param {Function} calculation - 计算函数
   * @param {*} fallbackValue - 失败时的后备值
   * @returns {*} 计算结果或后备值
   * 
   * @example
   * const result = CommonUtils.safeCalculation(() => {
   *   return Math.log(demand / supply);
   * }, 0);
   * // 如果计算产生NaN或Infinity，返回0
   */
  static safeCalculation(calculation, fallbackValue = 0) {
    try {
      const result = calculation();

      // 检查结果是否为有效数值
      if (typeof result === 'number' && isFinite(result) && !isNaN(result)) {
        return result;
      }

      return fallbackValue;
    } catch {
      return fallbackValue;
    }
  }

  /**
   * 格式化数字为可读字符串
   *
   * @param {number} number - 要格式化的数字
   * @param {number} decimals - 小数位数，默认2位
   * @returns {string} 格式化后的字符串
   */
  static formatNumber(number, decimals = 2) {
    if (typeof number !== 'number' || !isFinite(number)) {
      return '0';
    }

    return number.toLocaleString('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals
    });
  }

  // ==================== 时间工具方法 ====================

  /**
   * 计算剩余分钟数
   * @param {number} endTime - 结束时间戳
   * @param {number} currentTime - 当前时间戳（默认 Date.now()）
   * @returns {number} 剩余分钟数（向上取整，最小为0）
   */
  static getRemainingMinutes(endTime, currentTime = Date.now()) {
    const end = Number(endTime);
    const now = Number(currentTime);
    if (!Number.isFinite(end) || !Number.isFinite(now)) {
      return 0;
    }
    const remaining = Math.max(0, end - now);
    return Math.ceil(remaining / 60000);
  }

  /**
   * 格式化剩余时间为可读字符串
   * @param {number} endTime - 结束时间戳
   * @param {number} currentTime - 当前时间戳（默认 Date.now()）
   * @returns {string} 格式化后的时间字符串
   */
  static formatRemainingTime(endTime, currentTime = Date.now()) {
    const minutes = CommonUtils.getRemainingMinutes(endTime, currentTime);
    if (!Number.isFinite(minutes) || minutes <= 0) return '已结束';
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    return remainingMins > 0 ? `${hours}小时${remainingMins}分钟` : `${hours}小时`;
  }

  /**
   * 获取今日日期字符串（用于Redis键等场景）
   * @param {number} timestamp - 时间戳（默认 Date.now()）
   * @returns {string} 日期字符串（格式如 "Mon Jan 01 2024"）
   */
  static getTodayKey(timestamp = Date.now()) {
    return new Date(timestamp).toDateString();
  }

  // ==================== 物品数量工具方法 ====================

  /**
   * 获取单个物品条目的数量（统一处理多种数据格式）
   * @param {number|string|Object} entry - 物品条目（可以是数字、数字字符串或包含quantity的对象）
   * @returns {number} 物品数量（非负整数）
   */
  static getItemQuantity(entry) {
    if (typeof entry === 'number') {
      return Math.max(0, Math.floor(entry));
    }
    if (typeof entry === 'string') {
      const parsed = parseInt(entry, 10);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
    if (entry && typeof entry === 'object') {
      const qty = entry.quantity;
      if (typeof qty === 'number') {
        return Math.max(0, Math.floor(qty));
      }
      if (typeof qty === 'string') {
        const parsed = parseInt(qty, 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      }
    }
    return 0;
  }
}

export default CommonUtils;