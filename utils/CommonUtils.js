/**
 * 公共工具类 - 消除代码重复，提供统一API
 * 
 * 该工具类旨在解决项目中的代码重复问题，提供高质量、可复用的通用功能。
 * 所有方法都是静态方法，可以直接调用，无需实例化。
 * 
 * 主要功能：
 * 1. 仓库使用率计算
 * 2. 参数验证工具
 * 3. 安全数学计算
 * 4. 批量处理框架
 * 5. 配置验证工具
 * 
 * @author Claude Code
 * @version 1.0.0
 */
export class CommonUtils {
  /**
   * 计算仓库使用率
   * 
   * 统一管理所有服务中的仓库使用率计算逻辑，消除重复代码。
   * 支持边界情况处理，确保计算结果的准确性和可靠性。
   * 
   * @param {Object} inventory - 仓库数据对象，键为物品ID，值为数量
   * @param {number} maxCapacity - 最大容量
   * @returns {number} 使用率百分比 (0-100)
   * 
   * @example
   * const usage = CommonUtils.calculateInventoryUsage({
   *   'crop_wheat': 50,
   *   'tool_hoe': 1
   * }, 100);
   * console.log(usage); // 51
   */
  static calculateInventoryUsage(inventory, maxCapacity) {
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
   * 批量处理工具 - 支持大规模数据处理
   * 
   * 提供高效的批量处理框架，支持进度监控和错误处理。
   * 适用于处理大规模数据集，避免系统过载。
   * 
   * @param {Array} items - 待处理项目列表
   * @param {Function} processor - 处理函数，接收单个项目作为参数
   * @param {number} batchSize - 批次大小，默认100
   * @param {Function} progressCallback - 进度回调函数，可选
   * @returns {Promise<Array>} 处理结果数组
   * @throws {Error} 批量处理失败时抛出错误
   * 
   * @example
   * const results = await CommonUtils.batchProcess(
   *   itemIds,
   *   async (itemId) => await updatePrice(itemId),
   *   50,
   *   (progress) => console.log(`Progress: ${progress.progress}%`)
   * );
   */
  static async batchProcess(items, processor, batchSize = 100, progressCallback = null) {
    if (!Array.isArray(items)) {
      throw new Error('Items must be an array');
    }

    if (typeof processor !== 'function') {
      throw new Error('Processor must be a function');
    }

    if (typeof batchSize !== 'number' || batchSize <= 0) {
      throw new Error('Batch size must be a positive number');
    }

    const results = [];
    const totalBatches = Math.ceil(items.length / batchSize);

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      try {
        const batchResults = await Promise.all(
          batch.map(async (item, index) => {
            try {
              return await processor(item);
            } catch (error) {
              throw new Error(`Item ${i + index} processing failed: ${error.message}`);
            }
          })
        );

        results.push(...batchResults);

        // 进度回调
        if (progressCallback && typeof progressCallback === 'function') {
          progressCallback({
            completed: batchNumber,
            total: totalBatches,
            progress: Math.round((batchNumber / totalBatches) * 100),
            processedItems: i + batch.length,
            totalItems: items.length
          });
        }

        // 添加小延迟防止系统过载
        if (batchNumber < totalBatches) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }

      } catch (error) {
        throw new Error(`Batch processing failed at batch ${batchNumber}/${totalBatches}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * 配置验证工具
   * 
   * 提供灵活的配置验证机制，支持类型检查、范围验证等。
   * 
   * @param {Object} config - 配置对象
   * @param {Object} schema - 验证规则对象
   * @returns {Object} 验证结果 {valid: boolean, errors: Array<string>}
   * 
   * @example
   * const schema = {
   *   price: { type: 'number', min: 0, required: true },
   *   name: { type: 'string', required: true },
   *   category: { type: 'string', enum: ['crop', 'tool'] }
   * };
   * 
   * const result = CommonUtils.validateConfig(config, schema);
   * if (!result.valid) {
   *   console.error('Configuration errors:', result.errors);
   * }
   */
  static validateConfig(config, schema) {
    const errors = [];

    if (!config || typeof config !== 'object') {
      errors.push('Config must be an object');
      return { valid: false, errors };
    }

    if (!schema || typeof schema !== 'object') {
      errors.push('Schema must be an object');
      return { valid: false, errors };
    }

    for (const [key, rules] of Object.entries(schema)) {
      const value = config[key];

      // 检查必需字段
      if (rules.required && (value === undefined || value === null)) {
        errors.push(`Missing required config field: ${key}`);
        continue;
      }

      // 跳过可选的未定义字段
      if (value === undefined || value === null) {
        continue;
      }

      // 类型检查
      if (rules.type && typeof value !== rules.type) {
        errors.push(`Config field '${key}' should be ${rules.type}, got ${typeof value}`);
        continue;
      }

      // 数值范围检查
      if (rules.type === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          errors.push(`Config field '${key}' should be >= ${rules.min}, got ${value}`);
        }
        if (rules.max !== undefined && value > rules.max) {
          errors.push(`Config field '${key}' should be <= ${rules.max}, got ${value}`);
        }
      }

      // 字符串长度检查
      if (rules.type === 'string') {
        if (rules.minLength !== undefined && value.length < rules.minLength) {
          errors.push(`Config field '${key}' should have at least ${rules.minLength} characters`);
        }
        if (rules.maxLength !== undefined && value.length > rules.maxLength) {
          errors.push(`Config field '${key}' should have at most ${rules.maxLength} characters`);
        }
      }

      // 枚举检查
      if (rules.enum && Array.isArray(rules.enum) && !rules.enum.includes(value)) {
        errors.push(`Config field '${key}' should be one of [${rules.enum.join(', ')}], got '${value}'`);
      }

      // 自定义验证函数
      if (rules.validator && typeof rules.validator === 'function') {
        try {
          const customResult = rules.validator(value);
          if (customResult !== true) {
            errors.push(`Config field '${key}' validation failed: ${customResult || 'custom validation error'}`);
          }
        } catch (error) {
          errors.push(`Config field '${key}' validation error: ${error.message}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 深度克隆对象
   * 
   * 提供安全的对象深度克隆功能，避免引用问题。
   * 
   * @param {*} obj - 要克隆的对象
   * @returns {*} 克隆后的对象
   */
  static deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (obj instanceof Array) {
      return obj.map(item => CommonUtils.deepClone(item));
    }

    if (typeof obj === 'object') {
      const clonedObj = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          clonedObj[key] = CommonUtils.deepClone(obj[key]);
        }
      }
      return clonedObj;
    }

    return obj;
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

  /**
   * 生成唯一ID
   * 
   * @param {string} prefix - ID前缀
   * @returns {string} 唯一ID
   */
  static generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `${prefix}${timestamp}-${random}`;
  }

  /**
   * 节流函数
   * 
   * @param {Function} func - 要节流的函数
   * @param {number} wait - 等待时间（毫秒）
   * @returns {Function} 节流后的函数
   */
  static throttle(func, wait) {
    let timeout = null;
    let lastCallTime = 0;

    return function (...args) {
      const now = Date.now();

      if (now - lastCallTime >= wait) {
        lastCallTime = now;
        return func.apply(this, args);
      }

      if (!timeout) {
        timeout = setTimeout(() => {
          timeout = null;
          lastCallTime = Date.now();
          func.apply(this, args);
        }, wait - (now - lastCallTime));
      }
    };
  }
}

export default CommonUtils;