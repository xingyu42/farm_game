

import Calculator from '../../utils/calculator.js';
import Item from '../../models/Item.js';
import ItemResolver from '../../utils/ItemResolver.js';
import { CommonUtils } from '../../utils/CommonUtils.js';

/**
 * 仓库服务 - 管理玩家物品仓库（根据PRD v3.2设计）
 * 包含：物品添加、移除、查询、仓库扩容等功能
 */
export class InventoryService {
  constructor(redisClient, config, _logger = null, playerDataService = null, economyService = null) {
    this.redis = redisClient;
    this.config = config;
    this.itemResolver = new ItemResolver(config);
    this.playerDataService = playerDataService;
    this.economyService = economyService;
  }

  /**
   * 获取玩家仓库数据 - 使用Item模型
   * @param {string} userId 用户ID
   * @returns {Object} 仓库数据
   */
  async getInventory(userId) {
    try {
      if (!this.playerDataService) {
        throw new Error('PlayerDataService not initialized');
      }

      // 通过PlayerDataService获取玩家数据
      const playerData = await this.playerDataService.getPlayer(userId);
      if (!playerData) {
        throw new Error('玩家不存在');
      }

      // 解析inventory字段为Item实例
      const itemInstances = {};
      if (playerData.inventory) {
        try {
          const inventoryData = typeof playerData.inventory === 'string'
            ? JSON.parse(playerData.inventory)
            : playerData.inventory;

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
        capacity: parseInt(playerData.inventory_capacity) || this.config.items.inventory.startingCapacity,
        maxCapacity: parseInt(playerData.maxInventoryCapacity) || this.config.items.inventory.maxCapacity,
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
        targetItem = Item.fromConfig(itemId, quantity, this.config, this.itemResolver);

        // 验证新创建的物品
        const validation = targetItem.validate();
        if (!validation.isValid) {
          logger.error(`[InventoryService] 物品验证失败 [${userId}]: ${validation.errors.join(', ')}`);
          return {
            success: false,
            message: `物品验证失败: ${validation.errors.join(', ')}`
          };
        }

        inventory.items[itemId] = targetItem;
      }

      // 更新物品元数据
      targetItem.metadata.lastUpdated = Date.now();

      // 持久化仓库数据
      await this._saveInventory(userId, inventory);

      const displayInfo = targetItem.getDisplayInfo();
      const newUsage = this._calculateInventoryUsage(inventory.items);

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
        newUsage: newUsage
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
            targetItem = Item.fromConfig(item.item_id, item.quantity, this.config, this.itemResolver);

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

      // 一次性持久化
      await this._saveInventory(userId, inventory);

      const successfulItems = results.filter(r => r.success);
      const totalAdded = successfulItems.reduce((sum, r) => sum + r.quantity, 0);


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

      // 持久化仓库数据
      await this._saveInventory(userId, inventory);

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
        totalValue: CommonUtils.calcCoins(economicInfo.price, quantity)
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
      return inventory.items[itemId] ? inventory.items[itemId].quantity : 0;
    } catch (error) {
      logger.error(`检查物品数量失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查是否有足够的物品数量
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @param {number} requiredQuantity 需要的数量
   * @returns {Object} 检查结果 {success: boolean, available: number, message?: string}
   */
  async hasItem(userId, itemId, requiredQuantity) {
    try {
      const inventory = await this.getInventory(userId);
      const item = inventory.items[itemId];

      if (!item) {
        return {
          success: false,
          available: 0,
          message: `仓库中没有 ${itemId}`
        };
      }

      const available = item.quantity;
      const hasEnough = available >= requiredQuantity;

      return {
        success: hasEnough,
        available: available,
        message: hasEnough ?
          `有足够的 ${item.name}` :
          `${item.name} 数量不足，需要 ${requiredQuantity} 个，仓库中有 ${available} 个`
      };
    } catch (error) {
      logger.error(`检查物品是否足够失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取物品数量（别名方法，兼容性）
   * @param {string} userId 用户ID
   * @param {string} itemId 物品ID
   * @returns {number} 物品数量
   */
  async getItemCount(userId, itemId) {
    return await this.getItemQuantity(userId, itemId);
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
   * 检查仓库空间（兼容调用）
   * @param {string} userId 用户ID
   * @param {number} additionalItems 预计新增的物品数量
   * @returns {Object} { success, currentUsage, capacity, needed, available }
   */
  async checkSpaceForItems(userId, additionalItems) {
    try {
      const inventory = await this.getInventory(userId);
      const currentUsage = inventory.usage;
      const capacity = inventory.capacity;
      const hasEnough = currentUsage + additionalItems <= capacity;

      return {
        success: hasEnough,
        currentUsage,
        capacity,
        needed: additionalItems,
        available: Math.max(0, capacity - currentUsage)
      };
    } catch (error) {
      logger.error(`检查仓库空间失败 [${userId}]: ${error.message}`);
      throw error;
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

      // 从配置驱动的类别与显示名
      const categoriesList = Array.isArray(this.config.items?.categories) ? this.config.items.categories : [];
      const categories = categoriesList.reduce((acc, c) => { acc[c.key] = c.name; return acc; }, {});
      // 追加未知分类显示名
      categories.unknown = '其他';

      const groupedItems = {};

      for (const [itemId, item] of Object.entries(inventory.items)) {
        // 使用Item的显示方法获取丰富信息
        const displayInfo = item.getDisplayInfo();
        const economicInfo = item.getEconomicInfo();

        const category = item.category;
        if (!groupedItems[category]) {
          groupedItems[category] = [];
        }

        // 从配置解析展示所需的等级（模型不再持有 requiredLevel）
        const cfg = this.itemResolver.findItemById(itemId);
        const requiredLevel = cfg?.requiredLevel ?? 1;

        groupedItems[category].push({
          id: itemId,
          name: displayInfo.name,
          quantity: displayInfo.quantity,
          displayText: displayInfo.displayText,
          icon: displayInfo.icon,
          shortName: displayInfo.name ? displayInfo.name[0] : '?',

          category: displayInfo.category,
          price: economicInfo.price,
          canSell: economicInfo.canSell,
          isExpired: displayInfo.isExpired,
          locked: Boolean(item.metadata.locked),
          description: displayInfo.description,
          requiredLevel
        });
      }

      // 按配置中的类别顺序组织显示，按名称排序
      for (const c of categoriesList) {
        const categoryKey = c.key;
        const categoryName = c.name;
        if (groupedItems[categoryKey] && groupedItems[categoryKey].length > 0) {
          const sortedItems = groupedItems[categoryKey].sort((a, b) => {
            // 按名称排序
            return a.name.localeCompare(b.name);
          });

          items.push({
            category: categoryName,
            categoryKey: categoryKey,
            items: sortedItems,
            totalItems: sortedItems.length
          });
        }
      }

      // 附加 unknown 类别（如有）
      if (groupedItems.unknown && groupedItems.unknown.length > 0) {
        const sortedItems = groupedItems.unknown.sort((a, b) => a.name.localeCompare(b.name));
        items.push({
          category: categories.unknown,
          categoryKey: 'unknown',
          items: sortedItems,
          totalItems: sortedItems.length
        });
      }

      return {
        inventory: items,
        usage: inventory.usage,
        capacity: inventory.capacity,
        isEmpty: Object.keys(inventory.items).length === 0,
        totalCategories: items.length,
        totalItems: items.reduce((sum, cat) => sum + cat.totalItems, 0)
      };
    } catch (error) {
      logger.error(`获取格式化仓库失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 保存仓库数据 - 私有方法
   * @param {string} userId 用户ID
   * @param {Object} inventory 仓库数据对象
   * @returns {Promise<void>}
   * @private
   */
  async _saveInventory(userId, inventory) {
    if (!this.playerDataService) {
      throw new Error('PlayerDataService not initialized');
    }

    const serializedInventory = {};
    for (const [id, item] of Object.entries(inventory.items)) {
      serializedInventory[id] = item.toJSON();
    }

    const updates = {
      inventory: serializedInventory,
      lastUpdated: Date.now()
    };

    await this.playerDataService.updateFields(userId, updates);
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

      // 持久化仓库数据
      await this._saveInventory(userId, inventory);


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

      // 持久化仓库数据
      await this._saveInventory(userId, inventory);


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

      // 如果有变更，一次性持久化
      if (hasChanges) {
        await this._saveInventory(userId, inventory);
      }

      const successful = results.filter(r => r.success).length;

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

      // 如果有变更，一次性持久化
      if (hasChanges) {
        await this._saveInventory(userId, inventory);
      }

      const successful = results.filter(r => r.success).length;

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

  /**
   * 升级仓库容量
   * @param {string} userId 用户ID
   * @returns {Object} 升级结果
   */
  async upgradeInventory(userId) {
    try {

      // 2. 获取玩家数据
      if (!this.playerDataService) {
        throw new Error('PlayerDataService not initialized');
      }

      const playerData = await this.playerDataService.getPlayer(userId);
      if (!playerData) {
        return {
          success: false,
          message: '玩家不存在'
        };
      }

      // 3. 获取当前容量信息
      const inventory = await this.getInventory(userId);
      const currentCapacity = inventory.capacity;
      const maxCapacity = inventory.maxCapacity;

      // 4. 从配置中查找下一个升级档位
      const upgradeSteps = this.config.items.inventory.upgradeSteps;
      if (!upgradeSteps || !Array.isArray(upgradeSteps)) {
        return {
          success: false,
          message: '升级配置不存在'
        };
      }

      // 查找第一个容量大于当前容量的升级步骤
      const nextStep = upgradeSteps.find(step => step.capacity > currentCapacity);

      // 5. 检查是否已达上限
      if (!nextStep) {
        return {
          success: false,
          message: `仓库已达到最大容量 ${maxCapacity}`,
          currentCapacity: currentCapacity,
          maxCapacity: maxCapacity
        };
      }

      // 6. 检查金币是否足够
      if (playerData.coins < nextStep.cost) {
        return {
          success: false,
          message: `金币不足！升级需要 ${nextStep.cost} 金币，您只有 ${playerData.coins} 金币`,
          requiredCoins: nextStep.cost,
          currentCoins: playerData.coins
        };
      }

      // 7. 扣除金币
      if (!this.economyService) {
        throw new Error('EconomyService not initialized');
      }

      const updatedPlayerData = await this.economyService.deductCoins(userId, nextStep.cost);
      if (!updatedPlayerData) {
        return {
          success: false,
          message: '扣费失败，请稍后再试'
        };
      }

      // 8. 更新仓库容量
      await this.playerDataService.updateSimpleField(userId, 'inventory_capacity', nextStep.capacity);


      return {
        success: true,
        message: `仓库升级成功！容量已提升至 ${nextStep.capacity}`,
        oldCapacity: currentCapacity,
        newCapacity: nextStep.capacity,
        cost: nextStep.cost,
        remainingCoins: updatedPlayerData.coins
      };

    } catch (error) {
      logger.error(`升级仓库失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }
}

export default InventoryService;
