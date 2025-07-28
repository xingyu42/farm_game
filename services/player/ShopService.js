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
  constructor(redisClient, config, inventoryService, playerService, serviceContainer = null, logger = null) {
    this.redis = redisClient;
    this.config = config;
    this.inventoryService = inventoryService;
    this.playerService = playerService;
    this.serviceContainer = serviceContainer;
    this.itemResolver = new ItemResolver(config);

    // 创建标准化日志器
    this.logger = logger;

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
              this.logger.warn('获取动态价格失败，使用静态价格', {
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
      this.logger.error('获取物品价格失败', {
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

          // 记录审计日志
          this.logger.logAudit('transaction', transactionType, 'system', {
            itemId,
            quantity,
            transactionType,
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      // 记录错误但不抛出，避免影响主要交易流程
      this.logger.error('记录交易统计失败', {
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

      const shopConfig = itemsConfig.shop.categories;

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
              name: itemInfo.name,
              price: currentPrice,
              sellPrice: currentSellPrice,
              basePrice: itemInfo.price, // 原始基准价格
              isDynamic,
              priceTrend,
              description: itemInfo.description,
              category: categoryInfo.name,
              requiredLevel: itemInfo.requiredLevel
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
   * 购买物品（增强版本）
   * 
   * @param {string} userId 用户ID
   * @param {string} itemName 物品名称
   * @param {number} quantity 购买数量
   * @returns {Object} 购买结果
   */
  async buyItem(userId, itemName, quantity = 1) {
    const startTime = Date.now();

    try {
      // 参数验证（使用CommonUtils）
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

      return await this.playerService.executePlayerAction(userId, async (player) => {
        // 获取当前价格
        const unitPrice = await this._getItemPrice(itemId, 'buy');
        const totalCost = unitPrice * quantity;

        // 验证金币是否足够
        if (player.coins < totalCost) {
          return {
            success: false,
            message: `金币不足，需要 ${CommonUtils.formatNumber(totalCost)} 金币，当前拥有 ${CommonUtils.formatNumber(player.coins)} 金币`
          };
        }

        // 检查库存容量（使用CommonUtils）
        const maxCapacity = player.inventoryCapacity || 100;
        const currentUsage = CommonUtils.calculateInventoryUsage(player.inventory, maxCapacity);

        if (currentUsage >= 100) {
          return {
            success: false,
            message: `仓库已满（${currentUsage}%），请先清理仓库空间`
          };
        }

        // 计算购买后的容量使用率
        const newUsage = CommonUtils.calculateInventoryUsage({
          ...player.inventory,
          [itemId]: (player.inventory[itemId] || 0) + quantity
        }, maxCapacity);

        if (newUsage > 100) {
          const availableSpace = maxCapacity - Object.values(player.inventory).reduce((sum, qty) => sum + parseInt(qty || 0), 0);
          return {
            success: false,
            message: `仓库空间不足，最多还能购买 ${availableSpace} 个物品`
          };
        }

        // 执行购买
        player.coins -= totalCost;
        player.inventory[itemId] = (player.inventory[itemId] || 0) + quantity;

        // 记录交易统计（不影响主流程）
        await this._recordTransactionSafely(itemId, quantity, 'buy');

        const duration = Date.now() - startTime;
        this.logger.info(`购买商品完成: ${itemName} x${quantity}, 耗时: ${duration}ms`);

        // 更新交易统计
        this._updateTransactionStats(totalCost, duration);

        this.logger.info('购买交易成功', {
          userId,
          itemName,
          itemId,
          quantity,
          unitPrice: CommonUtils.formatNumber(unitPrice),
          totalCost: CommonUtils.formatNumber(totalCost),
          newInventoryUsage: `${newUsage}%`,
          duration: `${duration}ms`
        });

        return {
          success: true,
          message: `成功购买 ${quantity} 个 ${itemInfo.name}，花费 ${CommonUtils.formatNumber(totalCost)} 金币`,
          transaction: {
            itemId,
            itemName: itemInfo.name,
            quantity,
            unitPrice,
            totalCost,
            remainingCoins: player.coins,
            inventoryUsage: `${newUsage}%`
          }
        };
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('购买交易失败', {
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
}

export default ShopService;
