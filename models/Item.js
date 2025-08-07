/**
 * 物品数据模型 - 提供物品数据结构、验证和业务逻辑
 * 支持作物、种子、材料等各类物品的统一管理
 */

import ItemResolver from '../utils/ItemResolver.js';

class Item {
  constructor(data = {}, config) {
    this.config = config;

    // 基础属性
    this.id = data.id
    this.category = data.category
    this.name = data.name
    this.description = data.description

    // 数量和容量 - stackable 默认为 true，所有物品都可堆叠
    this.quantity = data.quantity;
    this.maxStack = data.maxStack;

    // 经济属性
    this.buyPrice = data.buyPrice;
    this.sellPrice = data.sellPrice;

    // 扩展属性
    this.icon = data.icon;
    this.requiredLevel = data.requiredLevel;
    this.expiryTime = data.expiryTime;
    this.metadata = data.metadata || {};
  }

  /**
   * 从配置创建物品实例 - 优化版本，避免重复创建ItemResolver
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @param {Object} config 配置对象
   * @param {ItemResolver} itemResolver 可选的ItemResolver实例，避免重复创建
   * @returns {Item} 物品实例
   */
  static fromConfig(itemId, quantity = 1, config, itemResolver = null) {
    if (!config) {
      throw new Error('配置数据不存在');
    }

    // 如果没有提供ItemResolver实例，则创建一个新的（向后兼容）
    const resolver = itemResolver || new ItemResolver(config);
    const itemConfig = resolver.findItemById(itemId);

    if (!itemConfig) {
      throw new Error(`找不到物品配置: ${itemId}`);
    }

    return new Item({
      id: itemId,
      quantity: quantity,
      category: itemConfig.category,
      name: itemConfig.name,
      description: itemConfig.description,
      buyPrice: itemConfig.buyPrice,
      sellPrice: itemConfig.sellPrice,
      icon: itemConfig.icon,
      requiredLevel: itemConfig.requiredLevel,
      maxStack: itemConfig.maxStack,
      metadata: itemConfig.metadata
    }, config);
  }

  /**
   * 从JSON数据创建物品实例 - 用于从Redis等存储中恢复物品数据
   * @param {Object} jsonData JSON数据对象
   * @param {Object} config 配置对象
   * @returns {Item} 物品实例
   */
  static fromJSON(jsonData, config) {
    if (!jsonData) {
      throw new Error('JSON数据不能为空');
    }

    if (!config) {
      throw new Error('配置数据不存在');
    }

    // 确保metadata存在且为对象
    const metadata = jsonData.metadata

    // 直接使用JSON数据创建Item实例，因为JSON数据已经包含了完整的物品信息
    return new Item({
      ...jsonData,
      metadata: {
        ...metadata,
        // 确保关键的metadata字段存在
        lastUpdated: metadata.lastUpdated || Date.now(),
        locked: Boolean(metadata.locked)
      }
    }, config);
  }

  /**
   * 创建物品堆叠
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @param {Object} config 配置对象
   * @returns {Item} 物品实例
   */
  static createStack(itemId, quantity, config) {
    const item = Item.fromConfig(itemId, quantity, config);

    // 所有物品都支持堆叠，只需检查最大堆叠数量
    if (quantity > item.maxStack) {
      throw new Error(`物品 ${itemId} 超过最大堆叠数量 ${item.maxStack}`);
    }

    return item;
  }

  /**
   * 验证物品数据
   * @returns {Object} 验证结果
   */
  validate() {
    const errors = [];

    // 验证必要字段
    if (!this.id || typeof this.id !== 'string') {
      errors.push('物品ID必须是有效字符串');
    }

    if (!this.name || typeof this.name !== 'string') {
      errors.push('物品名称必须是有效字符串');
    }

    // 验证数量
    if (!Number.isInteger(this.quantity) || this.quantity < 0) {
      errors.push('物品数量必须是非负整数');
    }

    // 验证堆叠 - 所有物品都支持堆叠
    if (this.quantity > this.maxStack) {
      errors.push(`物品数量不能超过最大堆叠数量 ${this.maxStack}`);
    }

    // 验证价格
    if (this.buyPrice < 0 || this.sellPrice < 0) {
      errors.push('物品价格不能为负数');
    }

    // 验证等级要求
    if (!Number.isInteger(this.requiredLevel) || this.requiredLevel < 1) {
      errors.push('需要等级必须是正整数');
    }

    // 验证过期时间
    if (this.expiryTime && (!Number.isInteger(this.expiryTime) || this.expiryTime < 0)) {
      errors.push('过期时间必须是有效的时间戳');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 检查是否过期
   * @param {number} currentTime 当前时间戳
   * @returns {boolean}
   */
  isExpired(currentTime = Date.now()) {
    return this.expiryTime && this.expiryTime <= currentTime;
  }

  /**
   * 检查是否可以出售 - 简化版本，只检查售价
   * @returns {boolean}
   */
  canSell() {
    return this.sellPrice > 0 && !this.isExpired() && this.quantity > 0;
  }

  /**
   * 添加数量
   * @param {number} amount 添加的数量
   * @returns {Item} 返回自身以支持链式调用
   */
  addQuantity(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error('添加数量必须是非负整数');
    }

    const newQuantity = this.quantity + amount;

    if (newQuantity > this.maxStack) {
      throw new Error(`超过最大堆叠数量 ${this.maxStack}`);
    }

    this.quantity = newQuantity;
    return this;
  }

  /**
   * 减少数量
   * @param {number} amount 减少的数量
   * @returns {Item} 返回自身以支持链式调用
   */
  removeQuantity(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error('减少数量必须是非负整数');
    }

    if (amount > this.quantity) {
      throw new Error(`数量不足，当前: ${this.quantity}, 需要: ${amount}`);
    }

    this.quantity -= amount;
    return this;
  }

  /**
   * 设置数量
   * @param {number} quantity 新数量
   * @returns {Item} 返回自身以支持链式调用
   */
  setQuantity(quantity) {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error('数量必须是非负整数');
    }

    if (quantity > this.maxStack) {
      throw new Error(`超过最大堆叠数量 ${this.maxStack}`);
    }

    this.quantity = quantity;
    return this;
  }

  /**
   * 分割物品堆叠
   * @param {number} splitQuantity 分割数量
   * @returns {Item} 新的物品实例
   */
  split(splitQuantity) {
    if (!Number.isInteger(splitQuantity) || splitQuantity <= 0) {
      throw new Error('分割数量必须是正整数');
    }

    if (splitQuantity >= this.quantity) {
      throw new Error('分割数量不能大于等于当前数量');
    }

    // 创建新的物品实例
    const newItem = this.clone();
    newItem.setQuantity(splitQuantity);

    // 减少当前物品数量
    this.removeQuantity(splitQuantity);

    return newItem;
  }

  /**
   * 合并物品堆叠
   * @param {Item} otherItem 要合并的物品
   * @returns {number} 剩余无法合并的数量
   */
  merge(otherItem) {
    if (!this.canMergeWith(otherItem)) {
      throw new Error('无法合并不同类型的物品');
    }

    const totalQuantity = this.quantity + otherItem.quantity;

    if (totalQuantity <= this.maxStack) {
      // 可以完全合并
      this.quantity = totalQuantity;
      otherItem.quantity = 0;
      return 0;
    } else {
      // 部分合并
      const overflow = totalQuantity - this.maxStack;
      this.quantity = this.maxStack;
      otherItem.quantity = overflow;
      return overflow;
    }
  }

  /**
   * 检查是否可以与另一个物品合并
   * @param {Item} otherItem 另一个物品
   * @returns {boolean}
   */
  canMergeWith(otherItem) {
    return this.id === otherItem.id &&
      this.category === otherItem.category &&
      !this.isExpired() &&
      !otherItem.isExpired();
  }



  /**
   * 获取显示信息
   * @returns {Object} 显示信息
   */
  getDisplayInfo() {
    const statusInfo = [];

    if (this.isExpired()) {
      statusInfo.push('已过期');
    }

    const statusText = statusInfo.length > 0 ? ` [${statusInfo.join(', ')}]` : '';
    const quantityText = this.quantity > 1 ? ` x${this.quantity}` : '';

    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      quantity: this.quantity,
      category: this.category,
      buyPrice: this.buyPrice,
      sellPrice: this.sellPrice,
      canSell: this.canSell(),
      isExpired: this.isExpired(),
      displayText: `${this.icon}${this.name}${quantityText}${statusText}`,
      description: this.description
    };
  }

  /**
   * 获取经济信息
   * @returns {Object} 经济信息
   */
  getEconomicInfo() {
    return {
      id: this.id,
      quantity: this.quantity,
      buyPrice: this.buyPrice,
      sellPrice: this.sellPrice,
      totalBuyValue: this.buyPrice * this.quantity,
      totalSellValue: this.sellPrice * this.quantity,
      canSell: this.canSell()
    };
  }

  /**
   * 转换为JSON对象
   * @returns {Object} JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      category: this.category,
      name: this.name,
      description: this.description,
      quantity: this.quantity,
      maxStack: this.maxStack,
      buyPrice: this.buyPrice,
      sellPrice: this.sellPrice,
      icon: this.icon,
      requiredLevel: this.requiredLevel,
      expiryTime: this.expiryTime,
      metadata: this.metadata
    };
  }

  /**
   * 复制物品实例
   * @returns {Item} 新的物品实例
   */
  clone() {
    return new Item(this.toJSON(), this.config);
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:35:24 +08:00; Reason: Shrimp Task ID: #9e864eaf, converting CommonJS module.exports to ES Modules export default; Principle_Applied: ModuleSystem-Standardization;}}
export default Item;

// {{END MODIFICATIONS}}