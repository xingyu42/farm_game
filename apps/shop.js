/**
 * 商店功能命令处理器 (Miao-Yunzai 插件)
 * 处理玩家商店相关指令：查看商店、购买、出售、市场价格等
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:22:31+08:00; Reason: Shrimp Task ID: #faf85478, implementing shop commands for T5;
// }}

import serviceContainer from '../services/index.js';

export class ShopCommands extends plugin {
  constructor() {
    super({
      name: '农场商店',
      dsc: '农场游戏商店功能',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#(nc)?商店$',
          fnc: 'viewShop'
        },
        {
          reg: '^#(nc)?市场$',
          fnc: 'viewMarket'
        },
        {
          reg: '^#(nc)?购买\\s+(.+?)\\s*(\\d+)?$',
          fnc: 'buyItem'
        },
        {
          reg: '^#(nc)?出售\\s+(.+?)\\s*(\\d+)?$',
          fnc: 'sellItem'
        },
        {
          reg: '^#(nc)?出售全部$',
          fnc: 'sellAllCrops'
        }
      ]
    });
  }

  /**
   * 查看商店
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewShop(e) {
    try {
      const userId = e.user_id.toString();
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const shopService = serviceContainer.getService('shopService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      const playerData = await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 获取商店商品
      const shopItems = await shopService.getShopItems();
      
      if (shopItems.length === 0) {
        await e.reply('🏪 商店暂时没有商品可供购买');
        return true;
      }
      
      // 构建商店显示
      let message = `🏪 农场商店 (金币: ${playerData.coins})\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      
      for (const category of shopItems) {
        message += `🏷️ ${category.category}\n`;
        
        for (const item of category.items) {
          const levelText = item.requiredLevel > 1 ? ` [Lv.${item.requiredLevel}]` : '';
          const availableText = playerData.level >= item.requiredLevel ? '✅' : '🔒';
          message += `   ${availableText} ${item.name} - ${item.price}金币${levelText}\n`;
        }
        
        message += '\n';
      }
      
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      message += '💡 使用 #nc购买 [物品名] [数量] 购买物品\n';
      message += '💡 使用 #nc市场 查看出售价格';
      
      await e.reply(message);
      return true;
      
    } catch (error) {
      logger.error(`[ShopCommands] 查看商店失败: ${error.message}`);
      await e.reply('❌ 查看商店失败，请稍后再试');
      return true;
    }
  }

  /**
   * 查看市场价格
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewMarket(e) {
    try {
      // 确保服务已初始化
      await serviceContainer.init();
      
      const shopService = serviceContainer.getService('shopService');
      
      // 获取市场价格
      const marketPrices = await shopService.getMarketPrices();
      
      if (marketPrices.length === 0) {
        await e.reply('📈 市场暂时没有价格信息');
        return true;
      }
      
      // 构建市场价格显示
      let message = '📈 市场价格信息\n';
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      
      for (const category of marketPrices) {
        message += `🏷️ ${category.category}\n`;
        
        for (const item of category.items) {
          const buyText = item.buyPrice ? ` | 购买: ${item.buyPrice}金币` : '';
          message += `   ${item.name} - 出售: ${item.sellPrice}金币${buyText}\n`;
        }
        
        message += '\n';
      }
      
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      message += '💡 使用 #nc出售 [物品名] [数量] 出售物品';
      
      await e.reply(message);
      return true;
      
    } catch (error) {
      logger.error(`[ShopCommands] 查看市场失败: ${error.message}`);
      await e.reply('❌ 查看市场失败，请稍后再试');
      return true;
    }
  }

  /**
   * 购买物品
   * @param {Object} e Miao-Yunzai事件对象
   */
  async buyItem(e) {
    try {
      const userId = e.user_id.toString();
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 14:36:57 +08:00; Reason: Shrimp Task ID: #db7410e1, upgrading to numbered capture groups for consistency with rule patterns; Principle_Applied: RegexPattern-Modernization;}}
      const match = e.msg.match(/^#(nc)?购买\s+(.+?)\s*(\d+)?$/);

      if (!match) {
        await e.reply('❌ 格式错误！使用: #nc购买 [物品名] [数量]');
        return true;
      }

      const itemName = match[2].trim();
      const quantity = parseInt(match[3]) || 1;
      
      if (quantity <= 0) {
        await e.reply('❌ 购买数量必须大于0');
        return true;
      }
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const shopService = serviceContainer.getService('shopService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 执行购买
      const result = await shopService.buyItem(userId, itemName, quantity);
      
      if (result.success) {
        await e.reply(`✅ ${result.message}\n💰 剩余金币: ${result.remainingCoins}\n🎒 仓库使用: ${result.inventoryUsage}`);
      } else {
        await e.reply(`❌ ${result.message}`);
      }
      
      return true;
      
    } catch (error) {
      logger.error(`[ShopCommands] 购买物品失败: ${error.message}`);
      await e.reply('❌ 购买失败，请稍后再试');
      return true;
    }
  }

  /**
   * 出售物品
   * @param {Object} e Miao-Yunzai事件对象
   */
  async sellItem(e) {
    try {
      const userId = e.user_id.toString();
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 14:36:57 +08:00; Reason: Shrimp Task ID: #db7410e1, upgrading to numbered capture groups for consistency with rule patterns; Principle_Applied: RegexPattern-Modernization;}}
      const match = e.msg.match(/^#(nc)?出售\s+(.+?)\s*(\d+)?$/);

      if (!match) {
        await e.reply('❌ 格式错误！使用: #nc出售 [物品名] [数量]');
        return true;
      }

      const itemName = match[2].trim();
      const quantity = parseInt(match[3]) || 1;
      
      if (quantity <= 0) {
        await e.reply('❌ 出售数量必须大于0');
        return true;
      }
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const shopService = serviceContainer.getService('shopService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 执行出售
      const result = await shopService.sellItem(userId, itemName, quantity);
      
      if (result.success) {
        const remainingText = result.remainingQuantity > 0 ? `\n📦 剩余数量: ${result.remainingQuantity}` : '';
        await e.reply(`✅ ${result.message}${remainingText}\n💰 当前金币: ${result.newCoins}`);
      } else {
        await e.reply(`❌ ${result.message}`);
      }
      
      return true;
      
    } catch (error) {
      logger.error(`[ShopCommands] 出售物品失败: ${error.message}`);
      await e.reply('❌ 出售失败，请稍后再试');
      return true;
    }
  }

  /**
   * 出售全部作物
   * @param {Object} e Miao-Yunzai事件对象
   */
  async sellAllCrops(e) {
    try {
      const userId = e.user_id.toString();
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const shopService = serviceContainer.getService('shopService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 执行批量出售
      const result = await shopService.sellAllCrops(userId);
      
      if (result.success) {
        let message = `✅ ${result.message}\n`;
        message += '📦 出售详情:\n';
        
        for (const item of result.items) {
          message += `   ${item.name} x${item.quantity} = ${item.earnings}金币\n`;
        }
        
        message += `💰 总收入: ${result.totalEarnings}金币`;
        
        await e.reply(message);
      } else {
        await e.reply(`❌ ${result.message}`);
      }
      
      return true;
      
    } catch (error) {
      logger.error(`[ShopCommands] 批量出售失败: ${error.message}`);
      await e.reply('❌ 批量出售失败，请稍后再试');
      return true;
    }
  }
} 