

import Calculator from '../utils/calculator.js';
/**
 * 仓库服务 - 管理玩家物品仓库（根据PRD v3.2设计）
 * 包含：物品添加、移除、查询、仓库扩容等功能
 */
class InventoryService {
  constructor(redisClient, config, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.logger = logger || console;
  }

  /**
   * 获取玩家仓库数据
   * @param {string} userId 用户ID
   * @returns {Object} 仓库数据
   */
  async getInventory(userId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      const playerData = await this.redis.get(playerKey);
      
      if (!playerData) {
        throw new Error('玩家不存在');
      }
      
      return {
        items: playerData.inventory || {},
        capacity: playerData.inventory_capacity || playerData.inventoryCapacity || 20,
        maxCapacity: playerData.maxInventoryCapacity || 200,
        usage: this._calculateInventoryUsage(playerData.inventory || {})
      };
    } catch (error) {
      this.logger.error(`[InventoryService] 获取仓库数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 添加物品到仓库
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @returns {Object} 添加结果
   */
  async addItem(userId, itemId, quantity) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.redis.get(playerKey);
        
        if (!playerData) {
          throw new Error('玩家不存在');
        }
        
        // 检查仓库容量
        const currentUsage = this._calculateInventoryUsage(playerData.inventory || {});
        const capacity = playerData.inventory_capacity || playerData.inventoryCapacity || 20;
        
        if (currentUsage + quantity > capacity) {
          return {
            success: false,
            message: `仓库容量不足！当前 ${currentUsage}/${capacity}，需要添加 ${quantity} 个物品`,
            currentUsage,
            capacity
          };
        }
        
        // 初始化仓库
        if (!playerData.inventory) {
          playerData.inventory = {};
        }
        
        // 添加物品
        if (playerData.inventory[itemId]) {
          playerData.inventory[itemId].quantity += quantity;
        } else {
          const itemConfig = this._getItemConfig(itemId);
          playerData.inventory[itemId] = {
            quantity,
            name: itemConfig?.name || itemId,
            category: itemConfig?.category || 'unknown',
            lastUpdated: Date.now()
          };
        }
        
        playerData.lastUpdated = Date.now();
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[InventoryService] 玩家 ${userId} 添加物品: ${itemId} x${quantity}`);
        
        return {
          success: true,
          message: `成功添加 ${quantity} 个 ${this._getItemName(itemId)}`,
          item: playerData.inventory[itemId],
          newUsage: this._calculateInventoryUsage(playerData.inventory)
        };
      });
    } catch (error) {
      this.logger.error(`[InventoryService] 添加物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量添加物品（用于初始礼包等）
   * @param {string} userId 用户ID
   * @param {Array} items 物品列表 [{item_id, quantity}, ...]
   * @returns {Object} 添加结果
   */
  async addItems(userId, items) {
    try {
      const results = [];
      let totalAdded = 0;
      
      for (const item of items) {
        const result = await this.addItem(userId, item.item_id, item.quantity);
        results.push(result);
        if (result.success) {
          totalAdded += item.quantity;
        }
      }
      
      return {
        success: results.every(r => r.success),
        message: `批量添加完成，成功添加 ${totalAdded} 个物品`,
        results
      };
    } catch (error) {
      this.logger.error(`[InventoryService] 批量添加物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 移除物品
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @returns {Object} 移除结果
   */
  async removeItem(userId, itemId, quantity) {
    try {
      const playerKey = this.redis.generateKey('player', userId);
      
      return await this.redis.transaction(async (multi) => {
        const playerData = await this.redis.get(playerKey);
        
        if (!playerData || !playerData.inventory || !playerData.inventory[itemId]) {
          return {
            success: false,
            message: `仓库中没有 ${this._getItemName(itemId)}`
          };
        }
        
        const currentQuantity = playerData.inventory[itemId].quantity;
        
        if (currentQuantity < quantity) {
          return {
            success: false,
            message: `数量不足！仓库中有 ${currentQuantity} 个，需要 ${quantity} 个`,
            available: currentQuantity
          };
        }
        
        // 移除物品
        playerData.inventory[itemId].quantity -= quantity;
        
        // 如果数量为0，删除物品记录
        if (playerData.inventory[itemId].quantity <= 0) {
          delete playerData.inventory[itemId];
        } else {
          playerData.inventory[itemId].lastUpdated = Date.now();
        }
        
        playerData.lastUpdated = Date.now();
        multi.set(playerKey, this.redis.serialize(playerData));
        
        this.logger.info(`[InventoryService] 玩家 ${userId} 移除物品: ${itemId} x${quantity}`);
        
        return {
          success: true,
          message: `成功移除 ${quantity} 个 ${this._getItemName(itemId)}`,
          remaining: playerData.inventory[itemId]?.quantity || 0
        };
      });
    } catch (error) {
      this.logger.error(`[InventoryService] 移除物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查物品数量
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @returns {number} 物品数量
   */
  async getItemQuantity(userId, itemId) {
    try {
      const inventory = await this.getInventory(userId);
      return inventory.items[itemId]?.quantity || 0;
    } catch (error) {
      this.logger.error(`[InventoryService] 检查物品数量失败 [${userId}]: ${error.message}`);
      return 0;
    }
  }

  /**
   * 检查仓库容量是否足够
   * @param {string} userId 用户ID
   * @param {number} additionalItems 要添加的物品数量
   * @returns {boolean} 是否有足够容量
   */
  async hasCapacity(userId, additionalItems) {
    try {
      const inventory = await this.getInventory(userId);
      return inventory.usage + additionalItems <= inventory.capacity;
    } catch (error) {
      this.logger.error(`[InventoryService] 检查仓库容量失败 [${userId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * 获取格式化的仓库显示
   * @param {string} userId 用户ID
   * @returns {Array} 格式化的物品列表
   */
  async getFormattedInventory(userId) {
    try {
      const inventory = await this.getInventory(userId);
      const items = [];
      
      // 按类别分组物品
      const categories = {
        seeds: '种子',
        crops: '作物',
        fertilizer: '肥料',
        defense: '防御',
        materials: '材料',
        unknown: '其他'
      };
      
      const groupedItems = {};
      
      for (const [itemId, item] of Object.entries(inventory.items)) {
        const category = item.category || 'unknown';
        if (!groupedItems[category]) {
          groupedItems[category] = [];
        }
        
        groupedItems[category].push({
          id: itemId,
          name: item.name,
          quantity: item.quantity,
          sellPrice: this._getItemSellPrice(itemId)
        });
      }
      
      // 按类别顺序组织显示
      for (const [categoryKey, categoryName] of Object.entries(categories)) {
        if (groupedItems[categoryKey] && groupedItems[categoryKey].length > 0) {
          items.push({
            category: categoryName,
            items: groupedItems[categoryKey].sort((a, b) => a.name.localeCompare(b.name))
          });
        }
      }
      
      return {
        inventory: items,
        usage: inventory.usage,
        capacity: inventory.capacity,
        isEmpty: Object.keys(inventory.items).length === 0
      };
    } catch (error) {
      this.logger.error(`[InventoryService] 获取格式化仓库失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 计算仓库使用量
   * 使用统一的Calculator.calculateInventoryUsage方法，与Player类保持一致
   * @param {Object} inventory 仓库数据
   * @returns {number} 使用量
   * @private
   */
  _calculateInventoryUsage(inventory) {
    return Calculator.calculateInventoryUsage(inventory);
  }

  /**
   * 获取物品配置
   * @param {string} itemId 物品ID
   * @returns {Object} 物品配置
   * @private
   */
  _getItemConfig(itemId) {
    const itemsConfig = this.config.items || {};
    
    // 搜索所有类别
    const categories = ['seeds', 'fertilizers', 'dogFood', 'landMaterials', 'crops'];
    
    for (const category of categories) {
      if (itemsConfig[category] && itemsConfig[category][itemId]) {
        return {
          ...itemsConfig[category][itemId],
          category: category === 'fertilizers' ? 'fertilizer' : 
                   category === 'dogFood' ? 'defense' :
                   category === 'landMaterials' ? 'materials' : category
        };
      }
    }
    
    return null;
  }

  /**
   * 获取物品名称
   * @param {string} itemId 物品ID
   * @returns {string} 物品名称
   * @private
   */
  _getItemName(itemId) {
    const itemConfig = this._getItemConfig(itemId);
    return itemConfig?.name || itemId;
  }

  /**
   * 获取物品售价
   * @param {string} itemId 物品ID
   * @returns {number} 售价
   * @private
   */
  _getItemSellPrice(itemId) {
    const itemConfig = this._getItemConfig(itemId);
    return itemConfig?.sellPrice || 0;
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #45b71863, converting CommonJS module.exports to ES Modules export; Principle_Applied: ModuleSystem-Standardization;}}
export { InventoryService };