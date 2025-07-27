/**
 * 物品数据模型 - 提供物品数据结构、验证和业务逻辑
 * 支持作物、种子、材料等各类物品的统一管理
 */




class Item {
  constructor(data = {}, config = null) {
    this.config = config;

    // 基础属性
    this.id = data.id || null;
    this.type = data.type || 'unknown';
    this.category = data.category || 'general';
    this.name = data.name || '';
    this.description = data.description || '';

    // 数量和容量
    this.quantity = data.quantity;
    this.stackable = data.stackable;
    this.maxStack = data.maxStack;

    // 经济属性
    this.buyPrice = data.buyPrice;
    this.sellPrice = data.sellPrice;
    this.rarity = data.rarity;

    // 功能属性
    this.usable = data.usable;
    this.consumable = data.consumable;
    this.tradeable = data.tradeable;

    // 扩展属性
    this.icon = data.icon;
    this.requiredLevel = data.requiredLevel;
    this.expiryTime = data.expiryTime;
    this.metadata = data.metadata;
  }

  /**
   * 从配置创建物品实例 - 优化版本，避免重复创建ItemResolver
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @param {Object} config 配置对象
   * @param {ItemResolver} itemResolver 可选的ItemResolver实例，避免重复创建
   * @returns {Item} 物品实例
   */
  static fromConfig(itemId, quantity = 1, config = null, itemResolver = null) {
    if (!config) {
      throw new Error('配置数据不存在');
    }

    // 如果没有提供ItemResolver实例，则创建一个新的（向后兼容）
    const resolver = itemResolver;
    const itemConfig = resolver.findItemById(itemId);

    if (!itemConfig) {
      throw new Error(`找不到物品配置: ${itemId}`);
    }

    return new Item({
      id: itemId,
      quantity: quantity,
      type: itemConfig.type,
      category: itemConfig.category,
      name: itemConfig.name,
      description: itemConfig.description,
      buyPrice: itemConfig.buyPrice,
      sellPrice: itemConfig.sellPrice,
      rarity: itemConfig.rarity,
      usable: itemConfig.usable,
      consumable: itemConfig.consumable,
      tradeable: itemConfig.tradeable,
      icon: itemConfig.icon,
      requiredLevel: itemConfig.requiredLevel,
      stackable: itemConfig.stackable,
      maxStack: itemConfig.maxStack,
      metadata: itemConfig.metadata
    }, config);
  }

  /**
   * 创建物品堆叠
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @param {Object} config 配置对象
   * @returns {Item} 物品实例
   */
  static createStack(itemId, quantity, config = null) {
    const item = Item.fromConfig(itemId, quantity, config);

    if (!item.stackable && quantity > 1) {
      throw new Error(`物品 ${itemId} 不支持堆叠`);
    }

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

    // 验证堆叠
    if (!this.stackable && this.quantity > 1) {
      errors.push('不可堆叠物品的数量必须为1');
    }

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
   * 检查是否可以使用
   * @param {number} playerLevel 玩家等级
   * @returns {boolean}
   */
  canUse(playerLevel) {
    return this.usable &&
      playerLevel >= this.requiredLevel &&
      !this.isExpired() &&
      this.quantity > 0;
  }

  /**
   * 检查是否可以交易
   * @returns {boolean}
   */
  canTrade() {
    return this.tradeable && !this.isExpired() && this.quantity > 0;
  }

  /**
   * 检查是否可以出售
   * @returns {boolean}
   */
  canSell() {
    return this.sellPrice > 0 && this.canTrade();
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

    if (!this.stackable && amount > 0 && this.quantity > 0) {
      throw new Error('不可堆叠物品无法增加数量');
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

    if (!this.stackable && quantity > 1) {
      throw new Error('不可堆叠物品的数量必须为1');
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
    if (!this.stackable) {
      throw new Error('不可堆叠物品无法分割');
    }

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
    return this.stackable &&
      otherItem.stackable &&
      this.id === otherItem.id &&
      this.type === otherItem.type &&
      this.category === otherItem.category &&
      !this.isExpired() &&
      !otherItem.isExpired();
  }

  /**
   * 使用物品
   * @param {number} amount 使用数量
   * @returns {Object} 使用结果
   */
  use(amount = 1) {
    if (!this.usable) {
      throw new Error('该物品不可使用');
    }

    if (this.isExpired()) {
      throw new Error('物品已过期');
    }

    if (amount > this.quantity) {
      throw new Error(`数量不足，当前: ${this.quantity}, 需要: ${amount}`);
    }

    const useResult = {
      success: true,
      itemId: this.id,
      usedAmount: amount,
      remainingQuantity: this.quantity - amount,
      effects: this.metadata.effects
    };

    if (this.consumable) {
      this.removeQuantity(amount);
    }

    return useResult;
  }

  /**
   * 获取显示信息
   * @returns {Object} 显示信息
   */
  getDisplayInfo() {
    // 从配置文件获取稀有度图标
    const rarityIcons = this.config.items.inventory.rarityIcons;

    const statusInfo = [];

    if (this.isExpired()) {
      statusInfo.push('已过期');
    }

    if (!this.tradeable) {
      statusInfo.push('绑定');
    }

    const statusText = statusInfo.length > 0 ? ` [${statusInfo.join(', ')}]` : '';
    const rarityIcon = rarityIcons[this.rarity];
    const quantityText = this.stackable && this.quantity > 1 ? ` x${this.quantity}` : '';

    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      quantity: this.quantity,
      rarity: this.rarity,
      rarityIcon,
      category: this.category,
      type: this.type,
      buyPrice: this.buyPrice,
      sellPrice: this.sellPrice,
      canSell: this.canSell(),
      canTrade: this.canTrade(),
      isExpired: this.isExpired(),
      displayText: `${this.icon}${rarityIcon}${this.name}${quantityText}${statusText}`,
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
      canSell: this.canSell(),
      canTrade: this.canTrade()
    };
  }

  /**
   * 转换为JSON对象
   * @returns {Object} JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      category: this.category,
      name: this.name,
      description: this.description,
      quantity: this.quantity,
      stackable: this.stackable,
      maxStack: this.maxStack,
      buyPrice: this.buyPrice,
      sellPrice: this.sellPrice,
      rarity: this.rarity,
      usable: this.usable,
      consumable: this.consumable,
      tradeable: this.tradeable,
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