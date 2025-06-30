/**
 * 仓库功能命令处理器 (Miao-Yunzai 插件)
 * 处理玩家仓库相关指令：查看仓库、物品管理等
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:22:31+08:00; Reason: Shrimp Task ID: #faf85478, implementing inventory commands for T5;
// }}

import serviceContainer from '../services/index.js';

export class InventoryCommands extends plugin {
  constructor() {
    super({
      name: '农场仓库',
      dsc: '农场游戏仓库管理功能',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#(nc)?仓库$',
          fnc: 'viewInventory'
        }
      ]
    });
  }

  /**
   * 查看仓库
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewInventory(e) {
    try {
      const userId = e.user_id.toString();
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const inventoryService = serviceContainer.getService('inventoryService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 获取格式化的仓库信息
      const inventoryData = await inventoryService.getFormattedInventory(userId);
      
      if (inventoryData.isEmpty) {
        await e.reply('🎒 你的仓库是空的，快去种植作物或购买物品吧！');
        return true;
      }
      
      // 构建仓库显示
      let message = `🎒 仓库状态 (${inventoryData.usage}/${inventoryData.capacity})\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      
      for (const category of inventoryData.inventory) {
        message += `📦 ${category.category}\n`;
        
        for (const item of category.items) {
          const sellPriceText = item.sellPrice > 0 ? ` (售价: ${item.sellPrice}金币)` : '';
          message += `   ${item.name} x${item.quantity}${sellPriceText}\n`;
        }
        
        message += '\n';
      }
      
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      message += '💡 使用 #nc出售 [物品名] [数量] 出售物品\n';
      message += '💡 使用 #nc商店 查看可购买的物品';
      
      await e.reply(message);
      return true;
      
    } catch (error) {
      logger.error(`[InventoryCommands] 查看仓库失败: ${error.message}`);
      await e.reply('❌ 查看仓库失败，请稍后再试');
      return true;
    }
  }
} 