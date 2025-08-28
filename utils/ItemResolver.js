/**
 * 统一物品解析器工具类
 * 提供一致的物品信息访问接口，消除代码重复
 */

class ItemResolver {
  constructor(config) {
    this.config = config;

    // 已标准化，删除旧键兼容映射

    // 从配置生成类别与显示名
    const itemsRoot = this.config.items || {};
    const categoryList = Array.isArray(itemsRoot.categories) ? itemsRoot.categories : [];

    if (categoryList.length === 0) {
      throw new Error('配置 items.categories 缺失，无法初始化物品类别');
    }

    this.categories = categoryList.map(c => c.key);
    this.categoryDisplayNames = {};
    for (const c of categoryList) {
      this.categoryDisplayNames[c.key] = c.name;
    }
  }

  /**
   * 根据ID查找物品完整配置
   * @param {string} itemId 物品ID
   * @returns {Object|null} 物品配置对象，包含category字段
   */
  findItemById(itemId) {
    const itemsConfig = this.config.items

    for (const category of this.categories) {
      if (category === 'crops') {
        const cropsConfig = this.config.crops
        if (cropsConfig[itemId]) {
          const itemConfig = cropsConfig[itemId];
          return {
            ...itemConfig,
            id: itemId,
            category: 'crops',
            originalCategory: 'crops'
          };
        }
      } else if (itemsConfig[category] && itemsConfig[category][itemId]) {
        const itemConfig = itemsConfig[category][itemId];

        return {
          ...itemConfig,
          id: itemId,
          category: category,
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
    const itemsConfig = this.config.items

    for (const category of this.categories) {
      if (category === 'crops') {
        const cropsConfig = this.config.crops
        for (const [itemId, itemInfo] of Object.entries(cropsConfig)) {
          if (itemInfo?.name === itemName) {
            return itemId;
          }
        }
      } else if (itemsConfig[category]) {
        for (const [itemId, itemInfo] of Object.entries(itemsConfig[category])) {
          if (itemInfo?.name === itemName) {
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
    const itemsConfig = this.config.items

    for (const category of this.categories) {
      if (category === 'crops') {
        const cropsConfig = this.config.crops
        if (cropsConfig[itemId]) return cropsConfig[itemId];
      } else if (itemsConfig[category] && itemsConfig[category][itemId]) {
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
    return this.categoryDisplayNames[category] || category;
  }

  /**
   * 获取物品售价
   * @param {string} itemId 物品ID
   * @returns {number} 售价，如果找不到返回0
   */
  getItemSellPrice(itemId) {
    const itemConfig = this.findItemById(itemId);
    return itemConfig?.sellPrice ?? 0;
  }

  /**
   * 获取物品购买价格
   * @param {string} itemId 物品ID
   * @returns {number} 购买价格，如果找不到返回0
   */
  getItemPrice(itemId) {
    const itemConfig = this.findItemById(itemId);
    return itemConfig?.price ?? 0;
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
    if (category === 'crops') {
      const cropsConfig = this.config.crops
      return Object.entries(cropsConfig).map(([itemId, itemInfo]) => ({
        id: itemId,
        ...itemInfo,
        category: 'crops',
        originalCategory: 'crops'
      }));
    }

    const itemsConfig = this.config.items
    const categoryItems = itemsConfig[category] || {};

    return Object.entries(categoryItems).map(([itemId, itemInfo]) => ({
      id: itemId,
      ...itemInfo,
      category: category,
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
    const itemsConfig = this.config.items
    const searchCategories = category ? [category] : this.categories;
    const results = [];

    for (const cat of searchCategories) {
      if (cat === 'crops') {
        const cropsConfig = this.config.crops
        for (const [itemId, itemInfo] of Object.entries(cropsConfig)) {
          if (itemInfo?.name?.includes(searchTerm) || itemId.includes(searchTerm)) {
            results.push({
              id: itemId,
              ...itemInfo,
              category: 'crops',
              originalCategory: 'crops'
            });
          }
        }
      } else if (itemsConfig[cat]) {
        for (const [itemId, itemInfo] of Object.entries(itemsConfig[cat])) {
          if (itemInfo?.name?.includes(searchTerm) || itemId.includes(searchTerm)) {
            results.push({
              id: itemId,
              ...itemInfo,
              category: cat,
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
