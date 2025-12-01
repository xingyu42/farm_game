/**
 * 增强版商店服务 - 管理买卖交易（根据PRD v3.2设计）
 * 
 * 包含：商店浏览、购买、出售、价格查询等功能
 * 增强功能：
 * 1. 集成CommonUtils工具类，消除代码重复
 * 2. 标准化日志系统集成
 * 3. 参数验证统一化
 * 4. 错误处理增强
 * 5. 性能监控和批量处理支持
 * 
 * @version 2.0.0 - 增强版，解决代码重复和质量问题
 */
import ItemResolver from '../../utils/ItemResolver.js';
import { CommonUtils } from '../../utils/CommonUtils.js';

export class ShopService {
  constructor(redisClient, config, inventoryService, playerService, serviceContainer = null) {
    this.redis = redisClient;
    this.config = config;
    this.inventoryService = inventoryService;
    this.playerService = playerService;
    this.serviceContainer = serviceContainer;
    this.itemResolver = new ItemResolver(config);

    // 性能统计
    this.stats = {
      transactions: 0,
      totalValue: 0,
      averageTransactionTime: 0,
      lastTransactionTime: null
    };
  }

  /**
   * 获取物品价格（集成动态定价，增强版本）
   * 
   * @param {string} itemId 物品ID
   * @param {string} priceType 价格类型: 'buy' | 'sell'
   * @returns {Promise<number>} 物品价格
   * @private
   */
  async _getItemPrice(itemId, priceType = 'buy') {
    try {
      // 检查是否有MarketService并且是浮动价格物品
      if (this.serviceContainer) {
        const marketService = this.serviceContainer.getService('marketService');
        if (marketService) {
          const isFloating = await marketService.isFloatingPriceItem(itemId);

          if (isFloating) {
            try {
              const dynamicPrice = await marketService.getItemPrice(itemId, priceType);
              // 使用CommonUtils验证动态价格
              CommonUtils.validatePrice(dynamicPrice, `dynamic ${priceType} price for ${itemId}`);
              return dynamicPrice;
            } catch (error) {
              logger.warn('获取动态价格失败，使用静态价格', {
                itemId,
                priceType,
                error: error.message
              });
              // 降级到静态价格
            }
          }
        }
      }

      // 使用静态价格
      const itemInfo = this.itemResolver.getItemInfo(itemId);
      if (!itemInfo) {
        throw new Error(`物品不存在: ${itemId}`);
      }

      const price = priceType === 'buy' ? itemInfo.price : itemInfo.sellPrice;
      CommonUtils.validatePrice(price, `static ${priceType} price for ${itemId}`);

      return price;
    } catch (error) {
      logger.error('获取物品价格失败', {
        itemId,
        priceType,
        error: error.message
      });
      // 返回默认价格以避免交易中断
      return priceType === 'buy' ? 1 : 0;
    }
  }
  /**
   * 安全记录交易统计（不影响主流程）
   * 
   * @param {string} itemId 物品ID
   * @param {number} quantity 交易数量
   * @param {string} transactionType 交易类型: 'buy' | 'sell'
   * @private
   */
  async _recordTransactionSafely(itemId, quantity, transactionType) {
    try {
      if (this.serviceContainer) {
        const marketService = this.serviceContainer.getService('marketService');
        if (marketService) {
          await marketService.recordTransaction(itemId, quantity, transactionType);
        }
      }
    } catch (error) {
      // 记录错误但不抛出，避免影响主要交易流程
      logger.error('记录交易统计失败', {
        itemId,
        quantity,
        transactionType,
        error: error.message
      });
    }
  }

  /**
   * 更新交易统计
   * 
   * @param {number} transactionValue - 交易金额
   * @param {number} duration - 交易耗时
   * @private
   */
  _updateTransactionStats(transactionValue, duration) {
    this.stats.transactions++;
    this.stats.totalValue += transactionValue;
    this.stats.lastTransactionTime = Date.now();

    if (this.stats.transactions > 0) {
      this.stats.averageTransactionTime =
        (this.stats.averageTransactionTime * (this.stats.transactions - 1) + duration) / this.stats.transactions;
    }
  }

  /**
   * 获取商店商品列表
   * @param {string} category 商品类别 (可选)
   * @returns {Array} 商品列表
   */
  async getShopItems(category = null) {
    try {
      const itemsConfig = this.config.items;

      // 从新结构 items.categories 读取分类；传入的 category 既可为 key 也可为显示名
      const categories = Array.isArray(itemsConfig.categories) ? itemsConfig.categories : [];
      const items = [];

      for (const cat of categories) {
        const catKey = cat.key;
        const catName = cat.name;

        // 作物不可购买，只能通过种植获得
        if (catKey === 'crops') continue;

        // 过滤：如果指定了类别，仅当键或显示名匹配时处理
        if (category && !(category === catKey || category === catName)) {
          continue;
        }

        // 通过解析器按类别收集所有可售（有 price）的物品
        const allInCategory = this.itemResolver.getItemsByCategory(catKey);
        const categoryItems = [];

        for (const item of allInCategory) {
          if (item && item.price !== undefined) {
            const itemId = item.id;

            // 获取当前价格（可能是动态价格）
            const currentPrice = await this._getItemPrice(itemId, 'buy');
            const currentSellPrice = await this._getItemPrice(itemId, 'sell');

            // 检查是否为动态价格物品
            let isDynamic = false;
            let priceTrend = null;
            if (this.serviceContainer) {
              try {
                const marketService = this.serviceContainer.getService('marketService');
                if (marketService) {
                  isDynamic = await marketService.isFloatingPriceItem(itemId);
                  if (isDynamic) {
                    const stats = await marketService.getMarketStats(itemId);
                    if (stats) {
                      priceTrend = stats.priceTrend;
                    }
                  }
                }
              } catch {
                // 忽略市场服务错误
              }
            }

            categoryItems.push({
              id: itemId,
              name: item.name,
              price: currentPrice,
              sellPrice: currentSellPrice,
              basePrice: item.price,
              isDynamic,
              priceTrend,
              description: item.description,
              category: catName,
              requiredLevel: item.requiredLevel
            });
          }
        }

        if (categoryItems.length > 0) {
          items.push({
            category: catName,
            items: categoryItems.sort((a, b) => a.price - b.price)
          });
        }
      }

      return items;
    } catch (error) {
      logger.error(`[ShopService] 获取商店商品失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 购买物品（增强版本）- 使用 InventoryService 保持数据一致性
   *
   * @param {string} userId 用户ID
   * @param {string} itemName 物品名称
   * @param {number} quantity 购买数量
   * @returns {Object} 购买结果
   */
  async buyItem(userId, itemName, quantity = 1) {
    const startTime = Date.now();

    try {
      // 参数验证
      CommonUtils.validateQuantity(quantity, 'buyItem quantity');

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
          message: `物品 "${itemName}" 信息不完整或无法购买`
        };
      }

      // 作物不可购买，只能通过种植获得
      if (itemInfo.category === 'crops' || itemInfo.originalCategory === 'crops') {
        return {
          success: false,
          message: `"${itemInfo.name}" 是作物，无法购买，请通过种植获得`
        };
      }

      // 获取当前价格
      const unitPrice = await this._getItemPrice(itemId, 'buy');
      const totalCost = unitPrice * quantity;

      // 获取玩家数据
      const player = await this.playerService.getPlayer(userId);

      if (!player) {
        return {
          success: false,
          message: '玩家不存在'
        };
      }

      // 验证玩家等级是否满足物品购买要求
      const requiredLevel = itemInfo.requiredLevel ?? 1;
      if (player.level < requiredLevel) {
        return {
          success: false,
          message: `等级不足，购买 ${itemInfo.name} 需要 ${requiredLevel} 级，当前等级 ${player.level}`
        };
      }

      // 验证金币是否足够
      if (player.coins < totalCost) {
        return {
          success: false,
          message: `金币不足，需要 ${CommonUtils.formatNumber(totalCost)} 金币，当前拥有 ${CommonUtils.formatNumber(player.coins)} 金币`
        };
      }

      // 使用 InventoryService 检查仓库容量
      const hasCapacity = await this.inventoryService.hasCapacity(userId, quantity);

      if (!hasCapacity) {
        return {
          success: false,
          message: `仓库空间不足，无法添加 ${quantity} 个物品`
        };
      }

      // 执行购买事务：扣除金币 + 添加物品
      return await this.playerService.dataService.executeWithTransaction(userId, async (dataService, userId) => {
        // 扣除金币
        player.coins -= totalCost;
        player.lastUpdated = Date.now();

        // 更新统计数据
        if (player.statistics) {
          player.statistics.totalMoneySpent += totalCost;
        }

        // 保存玩家数据（金币变更）
        await dataService.savePlayer(userId, player);

        // 使用 InventoryService 添加物品到仓库
        const addResult = await this.inventoryService.addItem(userId, itemId, quantity);

        if (!addResult.success) {
          logger.error(`[ShopService] 添加物品失败，回滚事务 [${userId}]: ${addResult.message}`);
          // 如果添加物品失败，回滚金币（通过抛出错误让事务回滚）
          throw new Error(`添加物品失败: ${addResult.message}`);
        }

        // 记录交易统计（不影响主流程）
        await this._recordTransactionSafely(itemId, quantity, 'buy');

        const duration = Date.now() - startTime;
        this._updateTransactionStats(totalCost, duration);

        // 获取仓库容量来计算百分比
        const inventoryData = await this.inventoryService.getInventory(userId);
        const usagePercentage = Math.round((addResult.newUsage / inventoryData.capacity) * 100);

        const result = {
          success: true,
          message: `成功购买 ${quantity} 个 ${itemInfo.name}，花费 ${CommonUtils.formatNumber(totalCost)} 金币`,
          remainingCoins: CommonUtils.formatNumber(player.coins),
          inventoryUsage: `${usagePercentage}%`,
          transaction: {
            itemId,
            itemName: itemInfo.name,
            quantity,
            unitPrice,
            totalCost,
            remainingCoins: player.coins,
            inventoryUsage: `${usagePercentage}%`
          }
        };

        return result;
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('购买交易失败', {
        userId,
        itemName,
        quantity,
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });

      return {
        success: false,
        message: `购买失败: ${error.message}`
      };
    }
  }

  /**
   * 出售物品
   *
   * @param {string} userId 用户ID
   * @param {string} itemName 物品名称
   * @param {number} quantity 出售数量
   * @returns {Object} 出售结果
   */
  async sellItem(userId, itemName, quantity = 1) {
    const startTime = Date.now();

    try {
      // 参数验证
      CommonUtils.validateQuantity(quantity, 'sellItem quantity');

      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);

      if (!itemId) {
        return {
          success: false,
          message: `商店中没有找到 "${itemName}"，请检查物品名称`
        };
      }

      const itemInfo = this.itemResolver.getItemInfo(itemId);

      if (!itemInfo) {
        return {
          success: false,
          message: `物品 "${itemName}" 信息不完整`
        };
      }

      // 检查物品是否可以出售
      if (itemInfo.sellPrice === undefined || itemInfo.sellPrice <= 0) {
        return {
          success: false,
          message: `物品 "${itemName}" 不可出售`
        };
      }

      // 获取当前出售价格
      const unitPrice = await this._getItemPrice(itemId, 'sell');
      const totalValue = unitPrice * quantity;

      // 获取玩家数据
      const player = await this.playerService.getPlayer(userId);

      if (!player) {
        return {
          success: false,
          message: '玩家不存在'
        };
      }

      // 验证玩家是否拥有足够的物品
      const hasItemResult = await this.inventoryService.hasItem(userId, itemId, quantity);

      if (!hasItemResult.success) {
        return {
          success: false,
          message: hasItemResult.message
        };
      }

      // 执行出售事务：移除物品 + 增加金币
      return await this.playerService.dataService.executeWithTransaction(userId, async (dataService, userId) => {
        // 使用 InventoryService 移除物品
        const removeResult = await this.inventoryService.removeItem(userId, itemId, quantity);

        if (!removeResult.success) {
          // 如果移除物品失败，通过抛出错误让事务回滚
          throw new Error(`移除物品失败: ${removeResult.message}`);
        }

        // 获取 EconomyService 实例
        const economyService = this.playerService.getEconomyService();

        // 增加金币
        await economyService.addCoins(userId, totalValue);

        // 获取更新后的玩家数据
        const updatedPlayer = await this.playerService.getPlayer(userId);

        // 更新统计数据
        if (updatedPlayer.statistics) {
          updatedPlayer.statistics.totalMoneyEarned += totalValue;
        }

        // 记录交易统计（不影响主流程）
        await this._recordTransactionSafely(itemId, quantity, 'sell');

        const duration = Date.now() - startTime;
        this._updateTransactionStats(totalValue, duration);

        const result = {
          success: true,
          message: `成功出售 ${quantity} 个 ${itemInfo.name}，获得 ${CommonUtils.formatNumber(totalValue)} 金币`,
          remainingCoins: CommonUtils.formatNumber(updatedPlayer.coins),
          remainingItems: removeResult.remaining,
          transaction: {
            itemId,
            itemName: itemInfo.name,
            quantity,
            unitPrice,
            totalValue,
            remainingCoins: updatedPlayer.coins,
            remainingItems: removeResult.remaining
          }
        };

        return result;
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('出售交易失败', {
        userId,
        itemName,
        quantity,
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });

      return {
        success: false,
        message: `出售失败: ${error.message}`
      };
    }
  }

  /**
   * 批量出售所有作物
   *
   * @param {string} userId 用户ID
   * @returns {Object} 出售结果
   */
  async sellAllCrops(userId) {
    const startTime = Date.now();

    try {
      // 获取玩家数据
      const player = await this.playerService.getPlayer(userId);

      if (!player) {
        return {
          success: false,
          message: '玩家不存在'
        };
      }

      // 获取玩家仓库数据
      const inventoryData = await this.inventoryService.getInventory(userId);

      // 筛选出所有作物物品（类别为 'crops'）
      const cropItems = [];
      const skippedLocked = [];
      for (const [itemId, item] of Object.entries(inventoryData.items)) {
        if (item.category === 'crops' && item.quantity > 0) {
          // 跳过被锁定的物品
          if (item.metadata?.locked) {
            skippedLocked.push({ itemId, name: item.name, quantity: item.quantity });
            continue;
          }
          // 检查物品是否可以出售
          const economicInfo = item.getEconomicInfo();
          if (economicInfo.canSell && economicInfo.sellPrice > 0) {
            cropItems.push({
              itemId,
              item,
              quantity: item.quantity,
              unitPrice: await this._getItemPrice(itemId, 'sell')
            });
          }
        }
      }

      // 检查是否有作物可以出售
      if (cropItems.length === 0) {
        const lockedMsg = skippedLocked.length > 0
          ? `（${skippedLocked.length} 种作物已锁定）`
          : '';
        return {
          success: false,
          message: `仓库中没有可以出售的作物${lockedMsg}`
        };
      }

      // 计算总价值
      const totalValue = cropItems.reduce((sum, crop) => sum + (crop.unitPrice * crop.quantity), 0);

      // 执行批量出售事务：移除所有作物 + 增加金币
      return await this.playerService.dataService.executeWithTransaction(userId, async (dataService, userId) => {
        // 获取 EconomyService 实例
        const economyService = this.playerService.getEconomyService();

        // 批量移除作物并记录每种作物的出售详情
        const soldDetails = [];
        for (const crop of cropItems) {
          // 使用 InventoryService 移除物品
          const removeResult = await this.inventoryService.removeItem(userId, crop.itemId, crop.quantity);

          if (!removeResult.success) {
            throw new Error(`移除作物失败: ${crop.itemId} - ${removeResult.message}`);
          }

          // 记录出售详情
          const itemInfo = this.itemResolver.getItemInfo(crop.itemId);
          soldDetails.push({
            itemId: crop.itemId,
            itemName: itemInfo.name,
            quantity: crop.quantity,
            unitPrice: crop.unitPrice,
            totalValue: crop.unitPrice * crop.quantity
          });

          // 记录交易统计（不影响主流程）
          await this._recordTransactionSafely(crop.itemId, crop.quantity, 'sell');
        }

        // 增加金币
        await economyService.addCoins(userId, totalValue);

        // 获取更新后的玩家数据
        const updatedPlayer = await this.playerService.getPlayer(userId);

        // 更新统计数据
        if (updatedPlayer.statistics) {
          updatedPlayer.statistics.totalMoneyEarned += totalValue;
        }

        const duration = Date.now() - startTime;
        this._updateTransactionStats(totalValue, duration);

        // 获取仓库数据计算使用率
        const updatedInventoryData = await this.inventoryService.getInventory(userId);

        const lockedNote = skippedLocked.length > 0
          ? `（跳过 ${skippedLocked.length} 种锁定作物）`
          : '';
        const result = {
          success: true,
          message: `成功出售 ${cropItems.length} 种作物，获得 ${CommonUtils.formatNumber(totalValue)} 金币${lockedNote}`,
          remainingCoins: CommonUtils.formatNumber(updatedPlayer.coins),
          soldDetails: soldDetails,
          skippedLocked: skippedLocked,
          totalValue: totalValue,
          inventoryUsage: `${updatedInventoryData.usage}/${updatedInventoryData.capacity}`,
          transaction: {
            cropCount: cropItems.length,
            totalQuantity: cropItems.reduce((sum, crop) => sum + crop.quantity, 0),
            totalValue: totalValue,
            remainingCoins: updatedPlayer.coins,
            inventoryUsage: `${updatedInventoryData.usage}/${updatedInventoryData.capacity}`,
            soldDetails: soldDetails,
            skippedLocked: skippedLocked
          }
        };

        return result;
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('批量出售作物失败', {
        userId,
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      });

      return {
        success: false,
        message: `批量出售作物失败: ${error.message}`
      };
    }
  }
}

export default ShopService;
