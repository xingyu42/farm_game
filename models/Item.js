/**
 * @fileoverview 物品领域模型 - Item Entity
 *
 * Input:
 * - ../utils/ItemResolver.js - ItemResolver (物品解析和分类识别)
 * - ../utils/CommonUtils.js - CommonUtils (通用工具函数)
 *
 * Output:
 * - Item (default) - 物品领域模型类,包含验证和序列化方法
 *
 * Pos: 数据模型层,定义物品实体结构 (ID、分类、名称、数量、价格、图标、元数据)
 */

import ItemResolver from '../utils/ItemResolver.js';
import { CommonUtils } from '../utils/CommonUtils.js';

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
    this.price = data.price;

    // 扩展属性
    this.icon = data.icon;
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
      price: itemConfig.price,
      icon: itemConfig.icon,
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
    const metadata = jsonData.metadata && typeof jsonData.metadata === 'object'
      ? jsonData.metadata
      : {};

    return new Item({
      ...jsonData,
      metadata: {
        ...metadata,
        lastUpdated: metadata.lastUpdated || Date.now(),
        locked: Boolean(metadata.locked)
      }
    }, config);
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
    if (this.price < 0) {
      errors.push('物品价格不能为负数');
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
   * 检查是否可以出售
   * @returns {boolean}
   */
  canSell() {
    return this.price > 0 && !this.isExpired() && this.quantity > 0;
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
      price: this.price,
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
      price: this.price,
      totalValue: CommonUtils.calcCoins(this.price, this.quantity),
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
      price: this.price,
      icon: this.icon,
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