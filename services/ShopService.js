/**
 * 商店服务 - 管理买卖交易（根据PRD v3.2设计）
 * 包含：商店浏览、购买、出售、价格查询等功能
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:22:31+08:00; Reason: Shrimp Task ID: #faf85478, implementing shop system for T5;
// }}

import { ItemResolver } from '../utils/ItemResolver.js';

export class ShopService {
  constructor(redisClient, config, inventoryService, playerService, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.inventoryService = inventoryService;
    this.playerService = playerService;
    this.logger = logger || console;
    this.itemResolver = new ItemResolver(config);
  }

  /**
   * 获取商店商品列表
   * @param {string} category 商品类别 (可选)
   * @returns {Array} 商品列表
   */
  async getShopItems(category = null) {
    try {
      const itemsConfig = this.config.items || {};
      const shopConfig = itemsConfig.shop?.categories || [];
      
      let items = [];
      
      for (const categoryInfo of shopConfig) {
        // 如果指定了类别且不匹配，跳过
        if (category && categoryInfo.name !== category) {
          continue;
        }
        
        const categoryItems = [];
        
        for (const itemId of categoryInfo.items) {
          const itemInfo = this.itemResolver.getItemInfo(itemId);

          if (itemInfo && itemInfo.price !== undefined) {
            categoryItems.push({
              id: itemId,
              name: itemInfo.name,
              price: itemInfo.price,
              description: itemInfo.description || '暂无描述',
              category: categoryInfo.name,
              requiredLevel: itemInfo.requiredLevel || 1
            });
          }
        }
        
        if (categoryItems.length > 0) {
          items.push({
            category: categoryInfo.name,
            items: categoryItems.sort((a, b) => a.price - b.price)
          });
        }
      }
      
      return items;
    } catch (error) {
      this.logger.error(`[ShopService] 获取商店商品失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 购买物品
   * @param {string} userId 用户ID
   * @param {string} itemName 物品名称
   * @param {number} quantity 购买数量
   * @returns {Object} 购买结果
   */
  async buyItem(userId, itemName, quantity = 1) {
    try {
      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);

      if (!itemId) {
        return {
          success: false,
          message: `商店中没有找到 "${itemName}"，请检查物品名称`
        };
      }

      const itemInfo = this.itemResolver.getItemInfo(itemId);
      
      if (!itemInfo || itemInfo.price === undefined) {
        return {
          success: false,
          message: `${itemName} 不可购买`
        };
      }
      
      const totalCost = itemInfo.price * quantity;
      
      // 检查玩家信息
      const playerData = await this.playerService.getPlayerData(userId);
      
      // 检查等级要求
      if (itemInfo.requiredLevel && playerData.level < itemInfo.requiredLevel) {
        return {
          success: false,
          message: `需要等级 ${itemInfo.requiredLevel} 才能购买 ${itemName}，当前等级: ${playerData.level}`
        };
      }
      
      // 检查金币是否足够
      if (playerData.coins < totalCost) {
        return {
          success: false,
          message: `金币不足！需要 ${totalCost} 金币，当前拥有: ${playerData.coins}`
        };
      }
      
      // 检查仓库容量
      const hasCapacity = await this.inventoryService.hasCapacity(userId, quantity);
      
      if (!hasCapacity) {
        return {
          success: false,
          message: `仓库容量不足！无法添加 ${quantity} 个物品`
        };
      }
      
      // 执行购买事务 - 使用正确的PlayerDataService事务模式
      return await this.playerService.getDataService().executeWithTransaction(userId, async (multi, playerKey) => {
        // 在事务内获取最新玩家数据 - 使用正确的Hash读取方式
        const playerData = await this.playerService.getDataService().getPlayerFromHash(userId);

        if (!playerData) {
          throw new Error('玩家不存在');
        }

        // 在事务内再次检查金币（防止并发修改）
        if (playerData.coins < totalCost) {
          throw new Error(`金币不足！需要 ${totalCost} 金币，当前拥有: ${playerData.coins}`);
        }

        // 在事务内检查仓库容量
        const currentUsage = this._calculateInventoryUsage(playerData.inventory || {});
        const capacity = playerData.inventory_capacity || playerData.inventoryCapacity || 20;

        if (currentUsage + quantity > capacity) {
          throw new Error(`仓库容量不足！当前 ${currentUsage}/${capacity}，需要添加 ${quantity} 个物品`);
        }

        // 扣除金币 - 使用EconomyService的内部方法
        const economyService = this.playerService.getEconomyService();
        economyService._updateCoinsInTransaction(playerData, -totalCost);

        // 添加物品到仓库 - 直接操作库存数据
        if (!playerData.inventory) {
          playerData.inventory = {};
        }

        if (playerData.inventory[itemId]) {
          playerData.inventory[itemId].quantity += quantity;
        } else {
          const itemConfig = this.itemResolver.findItemById(itemId);
          playerData.inventory[itemId] = {
            quantity,
            name: itemConfig?.name || itemId,
            category: itemConfig?.category || 'unknown',
            lastUpdated: Date.now()
          };
        }

        playerData.lastUpdated = Date.now();

        // 保存数据 - 使用正确的Hash写入方式
        const serializer = this.playerService.getDataService().getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        this.logger.info(`[ShopService] 玩家 ${userId} 购买: ${itemName} x${quantity}, 花费 ${totalCost} 金币`);

        return {
          success: true,
          message: `成功购买 ${quantity} 个 ${itemName}，花费 ${totalCost} 金币`,
          item: {
            name: itemName,
            quantity,
            totalCost
          },
          remainingCoins: playerData.coins,
          inventoryUsage: this._calculateInventoryUsage(playerData.inventory)
        };
      });
    } catch (error) {
      this.logger.error(`[ShopService] 购买物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 出售物品
   * @param {string} userId 用户ID
   * @param {string} itemName 物品名称
   * @param {number} quantity 出售数量
   * @returns {Object} 出售结果
   */
  async sellItem(userId, itemName, quantity = 1) {
    try {
      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);

      if (!itemId) {
        return {
          success: false,
          message: `未找到 "${itemName}"，请检查物品名称`
        };
      }

      const itemInfo = this.itemResolver.getItemInfo(itemId);
      
      if (!itemInfo || itemInfo.sellPrice === undefined) {
        return {
          success: false,
          message: `${itemName} 无法出售`
        };
      }
      
      // 检查物品是否被锁定
      const isLocked = await this.inventoryService.isItemLocked(userId, itemId);
      if (isLocked) {
        return {
          success: false,
          message: `${itemName} 已被锁定，无法出售`
        };
      }
      
      // 检查仓库中的物品数量
      const currentQuantity = await this.inventoryService.getItemQuantity(userId, itemId);
      
      if (currentQuantity < quantity) {
        return {
          success: false,
          message: `数量不足！仓库中有 ${currentQuantity} 个，要出售 ${quantity} 个`,
          available: currentQuantity
        };
      }
      
      const totalEarnings = itemInfo.sellPrice * quantity;
      
      // 执行出售事务 - 使用正确的PlayerDataService事务模式
      return await this.playerService.getDataService().executeWithTransaction(userId, async (multi, playerKey) => {
        // 在事务内获取最新玩家数据 - 使用正确的Hash读取方式
        const playerData = await this.playerService.getDataService().getPlayerFromHash(userId);

        if (!playerData) {
          throw new Error('玩家不存在');
        }

        // 在事务内再次检查物品数量（防止并发修改）
        if (!playerData.inventory || !playerData.inventory[itemId]) {
          throw new Error(`仓库中没有 ${itemName}`);
        }

        // 在事务内再次检查物品是否被锁定
        if (playerData.inventory[itemId].locked) {
          throw new Error(`${itemName} 已被锁定，无法出售`);
        }

        const currentQuantity = playerData.inventory[itemId].quantity;
        if (currentQuantity < quantity) {
          throw new Error(`数量不足！仓库中有 ${currentQuantity} 个，要出售 ${quantity} 个`);
        }

        // 移除物品 - 直接操作库存数据
        playerData.inventory[itemId].quantity -= quantity;
        let remainingQuantity = playerData.inventory[itemId].quantity;

        // 如果数量为0，删除物品记录
        if (playerData.inventory[itemId].quantity <= 0) {
          delete playerData.inventory[itemId];
          remainingQuantity = 0;
        } else {
          playerData.inventory[itemId].lastUpdated = Date.now();
        }

        // 添加金币 - 使用EconomyService的内部方法
        const economyService = this.playerService.getEconomyService();
        economyService._updateCoinsInTransaction(playerData, totalEarnings);

        playerData.lastUpdated = Date.now();

        // 保存数据 - 使用正确的Hash写入方式
        const serializer = this.playerService.getDataService().getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        this.logger.info(`[ShopService] 玩家 ${userId} 出售: ${itemName} x${quantity}, 获得 ${totalEarnings} 金币`);

        return {
          success: true,
          message: `成功出售 ${quantity} 个 ${itemName}，获得 ${totalEarnings} 金币`,
          item: {
            name: itemName,
            quantity,
            totalEarnings
          },
          remainingQuantity,
          newCoins: playerData.coins
        };
      });
    } catch (error) {
      this.logger.error(`[ShopService] 出售物品失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量出售所有作物
   * @param {string} userId 用户ID
   * @returns {Object} 批量出售结果
   */
  async sellAllCrops(userId) {
    try {
      const inventory = await this.inventoryService.getInventory(userId);
      const cropItems = [];
      let totalEarnings = 0;
      
      // 找出所有作物（排除被锁定的）
      for (const [itemId, item] of Object.entries(inventory.items)) {
        if (item.category === 'crops' && !item.locked) {
          const itemInfo = this._getItemInfo(itemId);
          if (itemInfo && itemInfo.sellPrice) {
            const earnings = itemInfo.sellPrice * item.quantity;
            cropItems.push({
              id: itemId,
              name: item.name,
              quantity: item.quantity,
              earnings
            });
            totalEarnings += earnings;
          }
        }
      }
      
      if (cropItems.length === 0) {
        return {
          success: false,
          message: '仓库中没有可出售的作物'
        };
      }
      
      // 执行批量出售 - 使用正确的PlayerDataService事务模式
      return await this.playerService.getDataService().executeWithTransaction(userId, async (multi, playerKey) => {
        // 在事务内获取最新玩家数据 - 使用正确的Hash读取方式
        const playerData = await this.playerService.getDataService().getPlayerFromHash(userId);

        if (!playerData) {
          throw new Error('玩家不存在');
        }

        // 在事务内再次验证所有作物数量和锁定状态（防止并发修改）
        for (const crop of cropItems) {
          if (!playerData.inventory || !playerData.inventory[crop.id]) {
            throw new Error(`仓库中没有 ${crop.name}`);
          }

          // 检查是否被锁定
          if (playerData.inventory[crop.id].locked) {
            throw new Error(`${crop.name} 已被锁定，无法出售`);
          }

          const currentQuantity = playerData.inventory[crop.id].quantity;
          if (currentQuantity < crop.quantity) {
            throw new Error(`${crop.name} 数量不足！仓库中有 ${currentQuantity} 个，要出售 ${crop.quantity} 个`);
          }
        }

        // 移除所有作物 - 直接操作库存数据
        for (const crop of cropItems) {
          playerData.inventory[crop.id].quantity -= crop.quantity;

          // 如果数量为0，删除物品记录
          if (playerData.inventory[crop.id].quantity <= 0) {
            delete playerData.inventory[crop.id];
          } else {
            playerData.inventory[crop.id].lastUpdated = Date.now();
          }
        }

        // 添加金币 - 使用EconomyService的内部方法
        const economyService = this.playerService.getEconomyService();
        economyService._updateCoinsInTransaction(playerData, totalEarnings);

        playerData.lastUpdated = Date.now();

        // 保存数据 - 使用正确的Hash写入方式
        const serializer = this.playerService.getDataService().getSerializer();
        multi.hSet(playerKey, serializer.serializeForHash(playerData));

        this.logger.info(`[ShopService] 玩家 ${userId} 批量出售作物，获得 ${totalEarnings} 金币`);

        return {
          success: true,
          message: `成功出售 ${cropItems.length} 种作物，获得 ${totalEarnings} 金币`,
          items: cropItems,
          totalEarnings
        };
      });
    } catch (error) {
      this.logger.error(`[ShopService] 批量出售作物失败 [${userId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取市场价格信息
   * @returns {Array} 价格信息列表
   */
  async getMarketPrices() {
    try {
      const itemsConfig = this.config.items || {};
      const prices = [];
      
      const categories = ['seeds', 'fertilizers', 'dogFood', 'landMaterials', 'crops'];
      
      for (const category of categories) {
        if (itemsConfig[category]) {
          const categoryPrices = [];
          
          for (const [, itemInfo] of Object.entries(itemsConfig[category])) {
            if (itemInfo.sellPrice !== undefined) {
              categoryPrices.push({
                name: itemInfo.name,
                sellPrice: itemInfo.sellPrice,
                buyPrice: itemInfo.price || null
              });
            }
          }
          
          if (categoryPrices.length > 0) {
            prices.push({
              category: this._getCategoryDisplayName(category),
              items: categoryPrices.sort((a, b) => a.name.localeCompare(b.name))
            });
          }
        }
      }
      
      return prices;
    } catch (error) {
      this.logger.error(`[ShopService] 获取市场价格失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 根据名称查找物品ID（使用统一的ItemResolver）
   * @param {string} itemName 物品名称
   * @returns {string|null} 物品ID
   * @private
   */
  _findItemByName(itemName) {
    return this.itemResolver.findItemByName(itemName);
  }

  /**
   * 获取物品信息（使用统一的ItemResolver）
   * @param {string} itemId 物品ID
   * @returns {Object|null} 物品信息
   * @private
   */
  _getItemInfo(itemId) {
    return this.itemResolver.getItemInfo(itemId);
  }

  /**
   * 获取类别显示名称（使用统一的ItemResolver）
   * @param {string} category 类别key
   * @returns {string} 显示名称
   * @private
   */
  _getCategoryDisplayName(category) {
    return this.itemResolver.getCategoryDisplayName(category);
  }

  /**
   * 计算仓库使用量（内部方法）
   * @param {Object} inventory 仓库数据
   * @returns {number} 使用量
   * @private
   */
  _calculateInventoryUsage(inventory) {
    if (!inventory || typeof inventory !== 'object') {
      return 0;
    }

    let totalUsage = 0;
    for (const item of Object.values(inventory)) {
      if (item && typeof item.quantity === 'number') {
        totalUsage += item.quantity;
      }
    }

    return totalUsage;
  }
}

// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #45b71863, converting CommonJS module.exports to ES Modules export; Principle_Applied: ModuleSystem-Standardization;}}