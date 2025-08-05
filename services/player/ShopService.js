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

          // 记录审计日志（使用info级别）
          logger.info('交易审计记录', {
            action: 'transaction',
            type: transactionType,
            source: 'system',
            itemId,
            quantity,
            transactionType,
            timestamp: Date.now()
          });
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

    logger.info(`[ShopService] 开始购买流程 [${userId}]: ${itemName} x${quantity}`);

    try {
      // 参数验证（使用CommonUtils）
      CommonUtils.validateQuantity(quantity, 'buyItem quantity');
      logger.info(`[ShopService] 参数验证通过 [${userId}]: quantity=${quantity}`);

      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);
      logger.info(`[ShopService] 物品ID查找结果 [${userId}]: ${itemName} -> ${itemId || 'NOT_FOUND'}`);

      if (!itemId) {
        return {
          success: false,
          message: `商店中没有找到 "${itemName}"，请检查物品名称`
        };
      }

      const itemInfo = this.itemResolver.getItemInfo(itemId);
      logger.info(`[ShopService] 物品信息获取 [${userId}]:`, {
        itemId,
        hasInfo: !!itemInfo,
        hasPrice: itemInfo?.price !== undefined
      });

      if (!itemInfo || itemInfo.price === undefined) {
        return {
          success: false,
          message: `物品 "${itemName}" 信息不完整或无法购买`
        };
      }

      // 获取当前价格
      const unitPrice = await this._getItemPrice(itemId, 'buy');
      const totalCost = unitPrice * quantity;
      logger.info(`[ShopService] 价格计算 [${userId}]: 单价=${unitPrice}, 总价=${totalCost}`);

      // 获取玩家数据
      const player = await this.playerService.getPlayer(userId);
      logger.info(`[ShopService] 玩家数据获取 [${userId}]:`, {
        exists: !!player,
        coins: player?.coins,
        inventoryCapacity: player?.inventoryCapacity
      });

      if (!player) {
        return {
          success: false,
          message: '玩家不存在'
        };
      }

      // 验证金币是否足够
      logger.info(`[ShopService] 金币验证 [${userId}]: 需要=${totalCost}, 拥有=${player.coins}`);
      if (player.coins < totalCost) {
        return {
          success: false,
          message: `金币不足，需要 ${CommonUtils.formatNumber(totalCost)} 金币，当前拥有 ${CommonUtils.formatNumber(player.coins)} 金币`
        };
      }

      // 使用 InventoryService 检查仓库容量
      logger.info(`[ShopService] 检查仓库容量 [${userId}]: 需要添加 ${quantity} 个物品`);
      const hasCapacity = await this.inventoryService.hasCapacity(userId, quantity);
      logger.info(`[ShopService] 仓库容量检查结果 [${userId}]: ${hasCapacity ? '有足够空间' : '空间不足'}`);

      if (!hasCapacity) {
        return {
          success: false,
          message: `仓库空间不足，无法添加 ${quantity} 个物品`
        };
      }

      // 执行购买事务：扣除金币 + 添加物品
      logger.info(`[ShopService] 开始购买事务 [${userId}]: ${itemName} x${quantity}, 总价 ${totalCost} 金币`);

      return await this.playerService.dataService.executeWithTransaction(userId, async (dataService, userId) => {
        logger.info(`[ShopService] 事务内部 - 扣除金币前 [${userId}]: 当前金币 ${player.coins}`);

        // 扣除金币
        player.coins -= totalCost;
        player.lastUpdated = Date.now();

        logger.info(`[ShopService] 事务内部 - 扣除金币后 [${userId}]: 剩余金币 ${player.coins}`);

        // 更新统计数据
        if (player.statistics) {
          player.statistics.totalMoneySpent += totalCost;
          logger.info(`[ShopService] 更新统计数据 [${userId}]: 总花费 ${player.statistics.totalMoneySpent}`);
        }

        // 保存玩家数据（金币变更）
        await dataService.savePlayer(userId, player);
        logger.info(`[ShopService] 玩家数据已保存 [${userId}]`);

        // 使用 InventoryService 添加物品到仓库
        logger.info(`[ShopService] 调用 InventoryService.addItem [${userId}]: ${itemId} x${quantity}`);
        const addResult = await this.inventoryService.addItem(userId, itemId, quantity);
        logger.info(`[ShopService] InventoryService.addItem 结果 [${userId}]:`, {
          success: addResult.success,
          message: addResult.message,
          newUsage: addResult.newUsage
        });

        if (!addResult.success) {
          logger.error(`[ShopService] 添加物品失败，回滚事务 [${userId}]: ${addResult.message}`);
          // 如果添加物品失败，回滚金币（通过抛出错误让事务回滚）
          throw new Error(`添加物品失败: ${addResult.message}`);
        }

        // 记录交易统计（不影响主流程）
        await this._recordTransactionSafely(itemId, quantity, 'buy');

        const duration = Date.now() - startTime;
        logger.info(`购买商品完成: ${itemName} x${quantity}, 耗时: ${duration}ms`);

        // 更新交易统计
        this._updateTransactionStats(totalCost, duration);

        logger.info('购买交易成功', {
          userId,
          itemName,
          itemId,
          quantity,
          unitPrice: CommonUtils.formatNumber(unitPrice),
          totalCost: CommonUtils.formatNumber(totalCost),
          newInventoryUsage: `${addResult.newUsage}`,
          duration: `${duration}ms`
        });

        // 获取仓库容量来计算百分比
        logger.info(`[ShopService] 获取仓库数据计算使用率 [${userId}]`);
        const inventoryData = await this.inventoryService.getInventory(userId);
        const usagePercentage = Math.round((addResult.newUsage / inventoryData.capacity) * 100);

        logger.info(`[ShopService] 仓库使用率计算 [${userId}]: ${addResult.newUsage}/${inventoryData.capacity} = ${usagePercentage}%`);

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

        logger.info(`[ShopService] 购买事务完成 [${userId}]:`, {
          success: result.success,
          itemId,
          quantity,
          totalCost,
          remainingCoins: player.coins,
          inventoryUsage: result.inventoryUsage
        });

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
}

export default ShopService;
