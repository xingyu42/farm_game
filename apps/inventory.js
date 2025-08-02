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
        },
        {
          reg: '^#(nc)?锁定(.+)$',
          fnc: 'lockItem'
        },
        {
          reg: '^#(nc)?解锁(.+)$',
          fnc: 'unlockItem'
        },
        {
          reg: '^#(nc)?(查看锁定|锁定列表)$',
          fnc: 'viewLockedItems'
        }
      ]
    });

    // 初始化服务
    this._initServices();
  }

  /**
   * 初始化服务容器中的所有服务
   * 集中管理服务依赖，提高代码可维护性
   */
  _initServices() {
    this.inventoryService = serviceContainer.getService('inventoryService');
    this.playerService = serviceContainer.getService('playerService');
    this.itemResolver = serviceContainer.getService('itemResolver');
  }

  /**
   * 查看仓库
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewInventory(e) {
    try {
      const userId = e.user_id.toString();

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')
      // 获取格式化的仓库信息
      const inventoryData = await this.inventoryService.getFormattedInventory(userId);

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
          const lockIcon = item.locked ? '🔒' : '';
          message += `   ${lockIcon}${item.name} x${item.quantity}${sellPriceText}\n`;
        }

        message += '\n';
      }

      message += '━━━━━━━━━━━━━━━━━━━━\n';
      message += '💡 使用 #nc出售 [物品名] [数量] 出售物品\n';
      message += '💡 使用 #nc锁定 [物品名] 锁定物品\n';
      message += '💡 使用 #nc查看锁定 查看锁定的物品\n';
      message += '💡 使用 #nc商店 查看可购买的物品';

      await e.reply(message);
      return true;

    } catch (error) {
      logger.error(`[InventoryCommands] 查看仓库失败: ${error.message}`);
      await e.reply('❌ 查看仓库失败，请稍后再试');
      return true;
    }
  }

  /**
   * 锁定物品
   * @param {Object} e Miao-Yunzai事件对象
   */
  async lockItem(e) {
    try {
      const userId = e.user_id.toString();
      const match = e.msg.match(/^#(nc)?锁定(.+)$/);

      if (!match) {
        await e.reply('❌ 请指定要锁定的物品名称\n💡 使用格式: #nc锁定[物品名]');
        return true;
      }

      const itemName = match[2].trim();

      if (!itemName) {
        await e.reply('❌ 请指定要锁定的物品名称\n💡 使用格式: #nc锁定[物品名]');
        return true;
      }

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);

      if (!itemId) {
        await e.reply(`❌ 未找到物品 "${itemName}"\n💡 请检查物品名称是否正确`);
        return true;
      }

      // 执行锁定
      const result = await this.inventoryService.lockItem(userId, itemId);

      if (result.success) {
        await e.reply(`🔒 ${result.message}`);
      } else {
        await e.reply(`❌ ${result.message}`);
      }

      return true;

    } catch (error) {
      logger.error(`[InventoryCommands] 锁定物品失败: ${error.message}`);
      await e.reply('❌ 锁定物品失败，请稍后再试');
      return true;
    }
  }

  /**
   * 解锁物品
   * @param {Object} e Miao-Yunzai事件对象
   */
  async unlockItem(e) {
    try {
      const userId = e.user_id.toString();
      const match = e.msg.match(/^#(nc)?解锁(.+)$/);

      if (!match) {
        await e.reply('❌ 请指定要解锁的物品名称\n💡 使用格式: #nc解锁[物品名]');
        return true;
      }

      const itemName = match[2].trim();

      if (!itemName) {
        await e.reply('❌ 请指定要解锁的物品名称\n💡 使用格式: #nc解锁[物品名]');
        return true;
      }

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"');

      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);

      if (!itemId) {
        await e.reply(`❌ 未找到物品 "${itemName}"\n💡 请检查物品名称是否正确`);
        return true;
      }

      // 执行解锁
      const result = await this.inventoryService.unlockItem(userId, itemId);

      if (result.success) {
        await e.reply(`🔓 ${result.message}`);
      } else {
        await e.reply(`❌ ${result.message}`);
      }

      return true;

    } catch (error) {
      logger.error(`[InventoryCommands] 解锁物品失败: ${error.message}`);
      await e.reply('❌ 解锁物品失败，请稍后再试');
      return true;
    }
  }

  /**
   * 查看锁定的物品
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewLockedItems(e) {
    try {
      const userId = e.user_id.toString();

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 获取锁定物品列表
      const lockedData = await this.inventoryService.getLockedItems(userId);

      if (lockedData.isEmpty) {
        await e.reply('🔓 你没有锁定任何物品\n💡 使用 #nc锁定 [物品名] 来锁定物品');
        return true;
      }

      // 构建锁定物品显示
      let message = `🔒 锁定物品列表 (${lockedData.count} 个)\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\n';

      // 按类别分组显示
      const categories = {
        seeds: '种子',
        crops: '作物',
        fertilizer: '肥料',
        defense: '防御',
        materials: '材料',
        unknown: '其他'
      };

      const groupedItems = {};
      for (const item of lockedData.items) {
        const category = item.category || 'unknown';
        if (!groupedItems[category]) {
          groupedItems[category] = [];
        }
        groupedItems[category].push(item);
      }

      for (const [categoryKey, categoryName] of Object.entries(categories)) {
        if (groupedItems[categoryKey] && groupedItems[categoryKey].length > 0) {
          message += `📦 ${categoryName}\n`;
          for (const item of groupedItems[categoryKey]) {
            message += `   🔒${item.name} x${item.quantity}\n`;
          }
          message += '\n';
        }
      }

      message += '━━━━━━━━━━━━━━━━━━━━\n';
      message += '💡 使用 #nc解锁 [物品名] 解锁物品';

      await e.reply(message);
      return true;

    } catch (error) {
      logger.error(`[InventoryCommands] 查看锁定物品失败: ${error.message}`);
      await e.reply('❌ 查看锁定物品失败，请稍后再试');
      return true;
    }
  }
}