/**
 * 统一物品解析器工具类
 * 提供一致的物品信息访问接口，消除代码重复
 */

class ItemResolver {
  constructor(config) {
    this.config = config;

    // 物品类别配置
    this.categories = ['seeds', 'fertilizers', 'dogFood', 'landMaterials', 'crops'];

    // 类别显示名称映射
    this.categoryDisplayNames = {
      seeds: '种子',
      fertilizers: '肥料',
      dogFood: '防御',
      landMaterials: '材料',
      crops: '作物'
    };

    // 类别标准化映射（用于统一不同服务的类别命名）
    this.categoryNormalization = {
      fertilizers: 'fertilizer',
      dogFood: 'defense',
      landMaterials: 'materials'
    };
  }

  /**
   * 根据ID查找物品完整配置
   * @param {string} itemId 物品ID
   * @returns {Object|null} 物品配置对象，包含category字段
   */
  findItemById(itemId) {
    const itemsConfig = this.config.items;

    for (const category of this.categories) {
      if (itemsConfig[category] && itemsConfig[category][itemId]) {
        const itemConfig = itemsConfig[category][itemId];

        return {
          ...itemConfig,
          id: itemId,
          category: this.categoryNormalization[category],
          originalCategory: category
        };
      }
    }

    return null;
  }

  /**
   * 根据名称查找物品ID
   * @param {string} itemName 物品名称
   * @returns {string|null} 物品ID
   */
  findItemByName(itemName) {
    const itemsConfig = this.config.items;

    for (const category of this.categories) {
      if (itemsConfig[category]) {
        for (const [itemId, itemInfo] of Object.entries(itemsConfig[category])) {
          if (itemInfo.name === itemName) {
            return itemId;
          }
        }
      }
    }

    return null;
  }

  /**
   * 获取物品名称
   * @param {string} itemId 物品ID
   * @returns {string} 物品名称，如果找不到返回ID本身
   */
  getItemName(itemId) {
    const itemConfig = this.findItemById(itemId);
    return itemConfig.name;
  }

  /**
   * 获取物品信息（兼容ShopService._getItemInfo）
   * @param {string} itemId 物品ID
   * @returns {Object|null} 物品信息
   */
  getItemInfo(itemId) {
    const itemsConfig = this.config.items;

    for (const category of this.categories) {
      if (itemsConfig[category] && itemsConfig[category][itemId]) {
        return itemsConfig[category][itemId];
      }
    }

    return null;
  }

  /**
   * 获取类别显示名称
   * @param {string} category 类别key
   * @returns {string} 显示名称
   */
  getCategoryDisplayName(category) {
    return this.categoryDisplayNames[category];
  }

  /**
   * 获取物品售价
   * @param {string} itemId 物品ID
   * @returns {number} 售价，如果找不到返回0
   */
  getItemSellPrice(itemId) {
    const itemConfig = this.findItemById(itemId);
    return itemConfig.sellPrice;
  }

  /**
   * 获取物品购买价格
   * @param {string} itemId 物品ID
   * @returns {number} 购买价格，如果找不到返回0
   */
  getItemPrice(itemId) {
    const itemConfig = this.findItemById(itemId);
    return itemConfig.price;
  }

  /**
   * 检查物品是否存在
   * @param {string} itemId 物品ID
   * @returns {boolean} 是否存在
   */
  itemExists(itemId) {
    return this.findItemById(itemId) !== null;
  }

  /**
   * 获取指定类别的所有物品
   * @param {string} category 类别名称
   * @returns {Array} 物品列表
   */
  getItemsByCategory(category) {
    const itemsConfig = this.config.items;
    const categoryItems = itemsConfig[category];

    return Object.entries(categoryItems).map(([itemId, itemInfo]) => ({
      id: itemId,
      ...itemInfo,
      category: this.categoryNormalization[category],
      originalCategory: category
    }));
  }

  /**
   * 获取所有可用的类别
   * @returns {Array} 类别列表
   */
  getAvailableCategories() {
    return this.categories.slice();
  }

  /**
   * 批量获取物品信息
   * @param {Array<string>} itemIds 物品ID数组
   * @returns {Array<Object>} 物品信息数组
   */
  getItemsInfo(itemIds) {
    return itemIds.map(itemId => {
      const itemConfig = this.findItemById(itemId);
      return itemConfig ? { id: itemId, ...itemConfig } : null;
    }).filter(item => item !== null);
  }

  /**
   * 搜索物品（支持模糊匹配）
   * @param {string} searchTerm 搜索词
   * @param {string} category 限定类别（可选）
   * @returns {Array} 匹配的物品列表
   */
  searchItems(searchTerm, category = null) {
    const itemsConfig = this.config.items;
    const searchCategories = category ? [category] : this.categories;
    const results = [];

    for (const cat of searchCategories) {
      if (itemsConfig[cat]) {
        for (const [itemId, itemInfo] of Object.entries(itemsConfig[cat])) {
          if (itemInfo.name?.includes(searchTerm) || itemId.includes(searchTerm)) {
            results.push({
              id: itemId,
              ...itemInfo,
              category: this.categoryNormalization[cat],
              originalCategory: cat
            });
          }
        }
      }
    }

    return results;
  }
}

export default ItemResolver;
