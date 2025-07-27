

import Calculator from '../utils/calculator.js';
import Item from '../models/Item.js';

/**
 * 仓库服务 - 管理玩家物品仓库（根据PRD v3.2设计）
 * 包含：物品添加、移除、查询、仓库扩容等功能
 */
export class InventoryService {
  constructor(redisClient, config, _logger = null) {
    this.redis = redisClient;
    this.config = config;
  }

  /**
   * 获取玩家仓库数据 - 使用Item模型
   * @param {string} userId 用户ID
   * @returns {Object} 仓库数据
   */
  async getInventory(userId) {
    try {
      const playerKey = this.redis.generateKey('player', userId);

      // 检查Hash是否存在
      const exists = await this.redis.exists(playerKey);
      if (!exists) {
        throw new Error('玩家不存在');
      }

      // 获取所有Hash字段
      const hashData = await this.redis.client.hGetAll(playerKey);

      if (!hashData || Object.keys(hashData).length === 0) {
        throw new Error('玩家数据为空');
      }

      // 解析inventory字段为Item实例
      const itemInstances = {};
      if (hashData.inventory) {
        try {
          const inventoryData = JSON.parse(hashData.inventory);

          // 将每个物品数据转换为Item实例
          for (const [itemId, itemData] of Object.entries(inventoryData)) {
            try {
              itemInstances[itemId] = Item.fromJSON(itemData, this.config);
            } catch (error) {
              logger.warn(`加载物品 ${itemId} 失败: ${error.message}`);
              // 跳过无效物品，不提供向后兼容
            }
          }
        } catch (error) {
          logger.error(`解析inventory字段失败: ${error.message}`);
          throw new Error('仓库数据格式错误');
        }
      }

      return {
        items: itemInstances,
        capacity: parseInt(hashData.inventory_capacity),
        maxCapacity: parseInt(hashData.maxInventoryCapacity),
        usage: this._calculateInventoryUsage(itemInstances)
      };
    } catch (error) {
      logger.error(`获取仓库数据失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 添加物品到仓库 - 使用Item模型
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @returns {Object} 添加结果
   */
  async addItem(userId, itemId, quantity) {
    try {
      // 直接获取当前仓库数据，内部已包含存在检查
      const inventory = await this.getInventory(userId);

      // 检查仓库容量
      if (inventory.usage + quantity > inventory.capacity) {
        return {
          success: false,
          message: `仓库容量不足！当前 ${inventory.usage}/${inventory.capacity}，需要添加 ${quantity} 个物品`,
          currentUsage: inventory.usage,
          capacity: inventory.capacity
        };
      }

      let targetItem;

      if (inventory.items[itemId]) {
        // 现有物品，尝试添加数量
        targetItem = inventory.items[itemId];

        try {
          targetItem.addQuantity(quantity);
        } catch (error) {
          if (error.message.includes('超过最大堆叠数量')) {
            const canAdd = targetItem.maxStack - targetItem.quantity;
            if (canAdd > 0) {
              targetItem.addQuantity(canAdd);
              return {
                success: false,
                message: `部分添加成功，还有 ${quantity - canAdd} 个物品因堆叠限制无法添加`,
                partialSuccess: true,
                added: canAdd,
                remaining: quantity - canAdd
              };
            } else {
              return {
                success: false,
                message: `物品已达最大堆叠数量 ${targetItem.maxStack}，无法添加更多`
              };
            }
          } else {
            throw error;
          }
        }
      } else {
        // 新物品，从配置创建
        targetItem = Item.fromConfig(itemId, quantity, this.config);

        // 验证新创建的物品
        const validation = targetItem.validate();
        if (!validation.isValid) {
          return {
            success: false,
            message: `物品验证失败: ${validation.errors.join(', ')}`
          };
        }

        inventory.items[itemId] = targetItem;
      }

      // 更新物品元数据
      targetItem.metadata.lastUpdated = Date.now();

      // 保存到Redis
      await this._saveInventoryToRedis(userId, inventory);

      logger.info(`玩家 ${userId} 添加物品: ${itemId} x${quantity}`);

      const displayInfo = targetItem.getDisplayInfo();

      return {
        success: true,
        message: `成功添加 ${quantity} 个 ${displayInfo.name}`,
        item: {
          id: itemId,
          name: displayInfo.name,
          quantity: targetItem.quantity,
          category: targetItem.category,
          displayInfo: displayInfo
        },
        newUsage: this._calculateInventoryUsage(inventory.items)
      };
    } catch (error) {
      logger.error(`添加物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量添加物品（用于初始礼包等）- 优化版本
   * @param {string} userId 用户ID
   * @param {Array} items 物品列表 [{item_id, quantity}, ...]
   * @returns {Object} 添加结果
   */
  async addItems(userId, items) {
    try {
      // 一次性获取仓库数据
      const inventory = await this.getInventory(userId);

      const results = [];
      let totalQuantityToAdd = 0;

      // 预检查总容量
      for (const item of items) {
        totalQuantityToAdd += item.quantity;
      }

      if (inventory.usage + totalQuantityToAdd > inventory.capacity) {
        return {
          success: false,
          message: `仓库容量不足！当前 ${inventory.usage}/${inventory.capacity}，需要添加 ${totalQuantityToAdd} 个物品`,
          currentUsage: inventory.usage,
          capacity: inventory.capacity,
          results: []
        };
      }

      // 批量处理物品
      for (const item of items) {
        let targetItem;

        if (inventory.items[item.item_id]) {
          // 现有物品
          targetItem = inventory.items[item.item_id];

          try {
            targetItem.addQuantity(item.quantity);
            targetItem.metadata.lastUpdated = Date.now();

            results.push({
              success: true,
              item_id: item.item_id,
              quantity: item.quantity,
              message: `成功添加 ${item.quantity} 个`
            });
          } catch (error) {
            if (error.message.includes('超过最大堆叠数量')) {
              const canAdd = targetItem.maxStack - targetItem.quantity;
              if (canAdd > 0) {
                targetItem.addQuantity(canAdd);
                targetItem.metadata.lastUpdated = Date.now();
                results.push({
                  success: false,
                  item_id: item.item_id,
                  quantity: canAdd,
                  partialSuccess: true,
                  message: `部分添加成功，还有 ${item.quantity - canAdd} 个物品因堆叠限制无法添加`
                });
              } else {
                results.push({
                  success: false,
                  item_id: item.item_id,
                  quantity: 0,
                  message: `物品已达最大堆叠数量，无法添加`
                });
              }
            } else {
              results.push({
                success: false,
                item_id: item.item_id,
                quantity: 0,
                message: error.message
              });
            }
          }
        } else {
          // 新物品
          try {
            targetItem = Item.fromConfig(item.item_id, item.quantity, this.config);

            const validation = targetItem.validate();
            if (!validation.isValid) {
              results.push({
                success: false,
                item_id: item.item_id,
                quantity: 0,
                message: `物品验证失败: ${validation.errors.join(', ')}`
              });
              continue;
            }

            targetItem.metadata.lastUpdated = Date.now();
            inventory.items[item.item_id] = targetItem;

            results.push({
              success: true,
              item_id: item.item_id,
              quantity: item.quantity,
              message: `成功添加 ${item.quantity} 个新物品`
            });
          } catch (error) {
            results.push({
              success: false,
              item_id: item.item_id,
              quantity: 0,
              message: error.message
            });
          }
        }
      }

      // 一次性保存到Redis
      await this._saveInventoryToRedis(userId, inventory);

      const successfulItems = results.filter(r => r.success);
      const totalAdded = successfulItems.reduce((sum, r) => sum + r.quantity, 0);

      logger.info(`玩家 ${userId} 批量添加物品完成，成功添加 ${totalAdded} 个物品`);

      return {
        success: successfulItems.length === items.length,
        message: `批量添加完成，成功添加 ${totalAdded} 个物品`,
        totalAdded,
        newUsage: this._calculateInventoryUsage(inventory.items),
        results
      };
    } catch (error) {
      logger.error(`批量添加物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 移除物品 - 使用Item模型
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @param {number} quantity 数量
   * @returns {Object} 移除结果
   */
  async removeItem(userId, itemId, quantity) {
    try {
      // 获取当前仓库数据
      const inventory = await this.getInventory(userId);

      if (!inventory.items[itemId]) {
        return {
          success: false,
          message: `仓库中没有该物品`
        };
      }

      const targetItem = inventory.items[itemId];

      // 检查物品是否被锁定
      if (targetItem.metadata.locked) {
        return {
          success: false,
          message: `${targetItem.name} 已被锁定，无法移除`,
          locked: true
        };
      }

      // 验证数量是否足够
      if (targetItem.quantity < quantity) {
        return {
          success: false,
          message: `数量不足！仓库中有 ${targetItem.quantity} 个，需要 ${quantity} 个`,
          available: targetItem.quantity
        };
      }

      // 使用Item的removeQuantity方法
      try {
        targetItem.removeQuantity(quantity);
        targetItem.metadata.lastUpdated = Date.now();
      } catch (error) {
        return {
          success: false,
          message: `移除失败: ${error.message}`
        };
      }

      // 如果数量为0，删除物品记录
      if (targetItem.quantity <= 0) {
        delete inventory.items[itemId];
      }

      // 保存到Redis
      await this._saveInventoryToRedis(userId, inventory);

      logger.info(`玩家 ${userId} 移除物品: ${itemId} x${quantity}`);

      const economicInfo = targetItem.getEconomicInfo();

      return {
        success: true,
        message: `成功移除 ${quantity} 个 ${targetItem.name}`,
        removed: {
          id: itemId,
          name: targetItem.name,
          quantity: quantity,
          category: targetItem.category
        },
        remaining: targetItem.quantity,
        totalValue: economicInfo.sellPrice * quantity
      };
    } catch (error) {
      logger.error(`移除物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查物品数量 - 使用Item模型
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @returns {number} 物品数量
   */
  async getItemQuantity(userId, itemId) {
    try {
      const inventory = await this.getInventory(userId);
      return inventory.items[itemId].quantity;
    } catch (error) {
      logger.error(`检查物品数量失败 [${userId}]: ${error.message}`);
      throw error;
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
      logger.error(`检查仓库容量失败 [${userId}]: ${error.message}`);
      throw error; // 重新抛出错误而不是返回默认值
    }
  }

  /**
   * 获取格式化的仓库显示 - 使用Item模型
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
        // 使用Item的显示方法获取丰富信息
        const displayInfo = item.getDisplayInfo();
        const economicInfo = item.getEconomicInfo();

        const category = item.category;
        if (!groupedItems[category]) {
          groupedItems[category] = [];
        }

        groupedItems[category].push({
          id: itemId,
          name: displayInfo.name,
          quantity: displayInfo.quantity,
          displayText: displayInfo.displayText,
          icon: displayInfo.icon,
          rarity: displayInfo.rarity,
          rarityIcon: displayInfo.rarityIcon,
          category: displayInfo.category,
          sellPrice: economicInfo.sellPrice,
          totalSellValue: economicInfo.totalSellValue,
          canSell: economicInfo.canSell,
          canTrade: displayInfo.canTrade,
          isExpired: displayInfo.isExpired,
          locked: Boolean(item.metadata.locked),
          description: displayInfo.description,
          requiredLevel: item.requiredLevel,
          tradeable: item.tradeable,
          usable: item.usable,
          consumable: item.consumable
        });
      }

      // 按类别顺序组织显示，按稀有度和名称排序
      const rarityOrder = this.config.items.inventory.rarityOrder;

      for (const [categoryKey, categoryName] of Object.entries(categories)) {
        if (groupedItems[categoryKey] && groupedItems[categoryKey].length > 0) {
          const sortedItems = groupedItems[categoryKey].sort((a, b) => {
            // 首先按稀有度排序（稀有度越高越靠前）
            const rarityDiff = rarityOrder[b.rarity] - rarityOrder[a.rarity];
            if (rarityDiff !== 0) return rarityDiff;

            // 然后按名称排序
            return a.name.localeCompare(b.name);
          });

          items.push({
            category: categoryName,
            categoryKey: categoryKey,
            items: sortedItems,
            totalItems: sortedItems.length,
            totalValue: sortedItems.reduce((sum, item) => sum + item.totalSellValue, 0)
          });
        }
      }

      return {
        inventory: items,
        usage: inventory.usage,
        capacity: inventory.capacity,
        isEmpty: Object.keys(inventory.items).length === 0,
        totalCategories: items.length,
        totalItems: items.reduce((sum, cat) => sum + cat.totalItems, 0),
        totalValue: items.reduce((sum, cat) => sum + cat.totalValue, 0)
      };
    } catch (error) {
      logger.error(`获取格式化仓库失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 保存仓库数据到Redis - 私有方法
   * @param {string} userId 用户ID
   * @param {Object} inventory 仓库数据对象
   * @returns {Promise<void>}
   * @private
   */
  async _saveInventoryToRedis(userId, inventory) {
    const playerKey = this.redis.generateKey('player', userId);
    const serializedInventory = {};

    for (const [id, item] of Object.entries(inventory.items)) {
      serializedInventory[id] = item.toJSON();
    }

    const updates = {
      inventory: JSON.stringify(serializedInventory),
      lastUpdated: Date.now().toString()
    };

    await this.redis.client.hSet(playerKey, updates);
  }

  /**
   * 计算仓库使用量 - 直接使用Calculator
   * @param {Object} itemInstances Item实例集合
   * @returns {number} 使用量
   * @private
   */
  _calculateInventoryUsage(itemInstances) {
    return Calculator.calculateInventoryUsage(itemInstances);
  }

  /**
   * 锁定物品，防止被出售或使用 - 使用Item metadata
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @returns {Object} 锁定结果
   */
  async lockItem(userId, itemId) {
    try {
      // 获取当前仓库数据
      const inventory = await this.getInventory(userId);

      if (!inventory.items[itemId]) {
        return {
          success: false,
          message: `仓库中没有该物品`
        };
      }

      const targetItem = inventory.items[itemId];

      // 检查是否已经锁定
      if (targetItem.metadata.locked) {
        return {
          success: false,
          message: `${targetItem.name} 已经被锁定`
        };
      }

      // 使用Item的metadata锁定物品
      targetItem.metadata.locked = true;
      targetItem.metadata.lockedAt = Date.now();
      targetItem.metadata.lastUpdated = Date.now();

      // 保存到Redis
      await this._saveInventoryToRedis(userId, inventory);

      logger.info(`玩家 ${userId} 锁定物品: ${itemId}`);

      const displayInfo = targetItem.getDisplayInfo();

      return {
        success: true,
        message: `成功锁定 ${displayInfo.name}`,
        item: {
          id: itemId,
          name: displayInfo.name,
          quantity: targetItem.quantity,
          locked: true,
          lockedAt: targetItem.metadata.lockedAt
        }
      };
    } catch (error) {
      logger.error(`锁定物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 解锁物品，恢复可用状态 - 使用Item metadata
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @returns {Object} 解锁结果
   */
  async unlockItem(userId, itemId) {
    try {
      // 获取当前仓库数据
      const inventory = await this.getInventory(userId);

      if (!inventory.items[itemId]) {
        return {
          success: false,
          message: `仓库中没有该物品`
        };
      }

      const targetItem = inventory.items[itemId];

      // 检查是否已经解锁
      if (!targetItem.metadata.locked) {
        return {
          success: false,
          message: `${targetItem.name} 未被锁定`
        };
      }

      // 使用Item的metadata解锁物品
      targetItem.metadata.locked = false;
      delete targetItem.metadata.lockedAt;
      targetItem.metadata.lastUpdated = Date.now();

      // 保存到Redis
      await this._saveInventoryToRedis(userId, inventory);

      logger.info(`玩家 ${userId} 解锁物品: ${itemId}`);

      const displayInfo = targetItem.getDisplayInfo();

      return {
        success: true,
        message: `成功解锁 ${displayInfo.name}`,
        item: {
          id: itemId,
          name: displayInfo.name,
          quantity: targetItem.quantity,
          locked: false
        }
      };
    } catch (error) {
      logger.error(`解锁物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查物品是否已锁定 - 使用Item metadata
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @returns {boolean} 是否已锁定
   */
  async isItemLocked(userId, itemId) {
    try {
      const inventory = await this.getInventory(userId);
      const item = inventory.items[itemId];

      if (!item) {
        return false;
      }

      return Boolean(item.metadata.locked);
    } catch (error) {
      logger.error(`检查物品锁定状态失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量锁定物品 - 优化版本
   * @param {string} userId 用户ID
   * @param {Array<string>} itemIds 物品ID列表
   * @returns {Object} 批量锁定结果
   */
  async lockItems(userId, itemIds) {
    try {
      // 一次性获取仓库数据
      const inventory = await this.getInventory(userId);
      const results = [];
      let hasChanges = false;

      for (const itemId of itemIds) {
        if (!inventory.items[itemId]) {
          results.push({
            itemId,
            success: false,
            message: `仓库中没有该物品`
          });
          continue;
        }

        const targetItem = inventory.items[itemId];

        if (targetItem.metadata.locked) {
          results.push({
            itemId,
            success: false,
            message: `${targetItem.name} 已经被锁定`
          });
          continue;
        }

        // 锁定物品
        targetItem.metadata.locked = true;
        targetItem.metadata.lockedAt = Date.now();
        targetItem.metadata.lastUpdated = Date.now();
        hasChanges = true;

        results.push({
          itemId,
          success: true,
          message: `成功锁定 ${targetItem.name}`,
          item: {
            id: itemId,
            name: targetItem.name,
            quantity: targetItem.quantity,
            locked: true,
            lockedAt: targetItem.metadata.lockedAt
          }
        });
      }

      // 如果有变更，一次性保存到Redis
      if (hasChanges) {
        await this._saveInventoryToRedis(userId, inventory);
      }

      const successful = results.filter(r => r.success).length;
      logger.info(`玩家 ${userId} 批量锁定物品完成，成功锁定 ${successful}/${itemIds.length} 个物品`);

      return {
        success: successful === itemIds.length,
        message: `批量锁定完成，成功锁定 ${successful}/${itemIds.length} 个物品`,
        results
      };
    } catch (error) {
      logger.error(`批量锁定物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量解锁物品 - 优化版本
   * @param {string} userId 用户ID
   * @param {Array<string>} itemIds 物品ID列表
   * @returns {Object} 批量解锁结果
   */
  async unlockItems(userId, itemIds) {
    try {
      // 一次性获取仓库数据
      const inventory = await this.getInventory(userId);
      const results = [];
      let hasChanges = false;

      for (const itemId of itemIds) {
        if (!inventory.items[itemId]) {
          results.push({
            itemId,
            success: false,
            message: `仓库中没有该物品`
          });
          continue;
        }

        const targetItem = inventory.items[itemId];

        if (!targetItem.metadata.locked) {
          results.push({
            itemId,
            success: false,
            message: `${targetItem.name} 未被锁定`
          });
          continue;
        }

        // 解锁物品
        targetItem.metadata.locked = false;
        delete targetItem.metadata.lockedAt;
        targetItem.metadata.lastUpdated = Date.now();
        hasChanges = true;

        results.push({
          itemId,
          success: true,
          message: `成功解锁 ${targetItem.name}`,
          item: {
            id: itemId,
            name: targetItem.name,
            quantity: targetItem.quantity,
            locked: false
          }
        });
      }

      // 如果有变更，一次性保存到Redis
      if (hasChanges) {
        await this._saveInventoryToRedis(userId, inventory);
      }

      const successful = results.filter(r => r.success).length;
      logger.info(`玩家 ${userId} 批量解锁物品完成，成功解锁 ${successful}/${itemIds.length} 个物品`);

      return {
        success: successful === itemIds.length,
        message: `批量解锁完成，成功解锁 ${successful}/${itemIds.length} 个物品`,
        results
      };
    } catch (error) {
      logger.error(`批量解锁物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取锁定物品列表 - 使用Item metadata
   * @param {string} userId 用户ID
   * @returns {Object} 锁定物品信息
   */
  async getLockedItems(userId) {
    try {
      const inventory = await this.getInventory(userId);
      const lockedItems = [];

      for (const [itemId, item] of Object.entries(inventory.items)) {
        if (item.metadata.locked) {
          const displayInfo = item.getDisplayInfo();

          lockedItems.push({
            id: itemId,
            name: displayInfo.name,
            quantity: displayInfo.quantity,
            lockedAt: item.metadata.lockedAt,
            category: displayInfo.category,
            displayText: displayInfo.displayText,
            rarity: displayInfo.rarity
          });
        }
      }

      // 按锁定时间排序（最新的在前）
      lockedItems.sort((a, b) => b.lockedAt - a.lockedAt);

      return {
        items: lockedItems,
        count: lockedItems.length,
        isEmpty: lockedItems.length === 0
      };
    } catch (error) {
      logger.error(`获取锁定物品列表失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #45b71863, converting CommonJS module.exports to ES Modules export; Principle_Applied: ModuleSystem-Standardization;}}