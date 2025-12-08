/**
 * 仓库功能命令处理器 (Miao-Yunzai 插件)
 * 处理玩家仓库相关指令：查看仓库、物品管理等
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:22:31+08:00; Reason: Shrimp Task ID: #faf85478, implementing inventory commands for T5;
// }}

import serviceContainer from '../services/index.js';
import { Puppeteer } from '../models/services.js';
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
          reg: '^#(nc)?仓库升级$',
          fnc: 'upgradeInventory'
        },
        {
          reg: '^#(nc)?锁定(.+)$',
          fnc: 'lockItem'
        },
        {
          reg: '^#(nc)?解锁(.+)$',
          fnc: 'unlockItem'
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
      if (!(await this.playerService.isPlayer(userId))) { await e.reply('您未注册，请先"#nc注册"'); return true; }

      // 获取格式化的仓库信息
      const inventoryData = await this.inventoryService.getFormattedInventory(userId);

      // 获取升级信息
      const upgradeInfo = await this._getUpgradeInfo(userId);

      // 计算容量百分比
      const usagePercentage = inventoryData.capacity > 0
        ? Math.round((inventoryData.usage / inventoryData.capacity) * 100)
        : 0;

      // 准备渲染数据
      const renderData = {
        usage: inventoryData.usage,
        capacity: inventoryData.capacity,
        usagePercentage: usagePercentage,
        isEmpty: inventoryData.isEmpty,
        inventory: inventoryData.inventory,
        canUpgrade: upgradeInfo.canUpgrade,
        upgradeCost: upgradeInfo.cost
      };

      // 使用Puppeteer渲染图片（Vue客户端渲染）
      const result = await Puppeteer.renderVue('inventory/index', renderData, {
        e,
        scale: 2.0
      });

      if (!result) {
        await e.reply('❌ 生成仓库图片失败，请稍后再试');
        return false;
      }

      return true;

    } catch (error) {
      logger.error(`[InventoryCommands] 查看仓库失败: ${error.message}`);
      await e.reply('❌ 查看仓库失败，请稍后再试');
      return true;
    }
  }

  /**
   * 获取升级信息
   * @param {string} userId 用户ID
   * @returns {Object} 升级信息
   */
  async _getUpgradeInfo(userId) {
    try {
      // 获取当前玩家数据
      const playerData = await this.playerService.getPlayer(userId);
      if (!playerData) {
        return { canUpgrade: false, cost: 0 };
      }

      // 获取配置
      const config = this.inventoryService.config;
      const upgradeSteps = config?.items?.inventory?.upgradeSteps || [];

      if (upgradeSteps.length === 0) {
        return { canUpgrade: false, cost: 0 };
      }

      const currentCapacity = playerData.inventory_capacity || config?.items?.inventory?.defaultCapacity || 20;

      // 查找下一级升级
      for (const step of upgradeSteps) {
        if (step.capacity > currentCapacity) {
          return {
            canUpgrade: true,
            cost: step.cost
          };
        }
      }

      // 已达最大容量
      return { canUpgrade: false, cost: 0 };

    } catch (error) {
      logger.error(`[InventoryCommands] 获取升级信息失败: ${error.message}`);
      return { canUpgrade: false, cost: 0 };
    }
  }

  /**
   * 渲染仓库图片（内部复用方法）
   * @param {Object} e Miao-Yunzai事件对象
   * @param {string} userId 用户ID
   * @returns {boolean} 渲染是否成功
   */
  async _renderInventoryImage(e, userId) {
    const inventoryData = await this.inventoryService.getFormattedInventory(userId);
    const upgradeInfo = await this._getUpgradeInfo(userId);
    const usagePercentage = inventoryData.capacity > 0
      ? Math.round((inventoryData.usage / inventoryData.capacity) * 100)
      : 0;

    const renderData = {
      usage: inventoryData.usage,
      capacity: inventoryData.capacity,
      usagePercentage: usagePercentage,
      isEmpty: inventoryData.isEmpty,
      inventory: inventoryData.inventory,
      canUpgrade: upgradeInfo.canUpgrade,
      upgradeCost: upgradeInfo.cost
    };

    return await Puppeteer.renderVue('inventory/index', renderData, { e, scale: 2.0 });
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
      if (!(await this.playerService.isPlayer(userId))) { await e.reply('您未注册，请先"#nc注册"'); return true; }

      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);

      if (!itemId) {
        await e.reply(`❌ 未找到物品 "${itemName}"\n💡 请检查物品名称是否正确`);
        return true;
      }

      // 执行锁定
      const result = await this.inventoryService.lockItem(userId, itemId);

      if (result.success) {
        // 渲染仓库图片显示锁定状态
        const rendered = await this._renderInventoryImage(e, userId);
        if (!rendered) {
          await e.reply(`🔒 ${result.message}`);
        }
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
      if (!(await this.playerService.isPlayer(userId))) { await e.reply('您未注册，请先"#nc注册"'); return true; }

      // 查找物品ID
      const itemId = this.itemResolver.findItemByName(itemName);

      if (!itemId) {
        await e.reply(`❌ 未找到物品 "${itemName}"\n💡 请检查物品名称是否正确`);
        return true;
      }

      // 执行解锁
      const result = await this.inventoryService.unlockItem(userId, itemId);

      if (result.success) {
        // 渲染仓库图片显示解锁状态
        const rendered = await this._renderInventoryImage(e, userId);
        if (!rendered) {
          await e.reply(`🔓 ${result.message}`);
        }
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
   * 升级仓库容量
   */
  async upgradeInventory(e) {
    try {
      const userId = e.user_id.toString();

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) { await e.reply('您未注册，请先"#nc注册"'); return true; }

      // 调用服务层方法进行仓库升级
      const result = await this.inventoryService.upgradeInventory(userId);

      if (result.success) {
        // 升级成功
        const message = `✅ ${result.message}\n` +
          `📦 容量变化: ${result.oldCapacity} → ${result.newCapacity}\n` +
          `💰 花费金币: ${result.cost}\n` +
          `💳 剩余金币: ${result.remainingCoins}`;

        await e.reply(message);
      } else {
        // 升级失败，显示具体原因
        let message = `❌ ${result.message}`;

        // 根据不同的失败原因提供额外信息
        if (result.requiredCoins && result.currentCoins) {
          // 金币不足的情况
          const shortfall = result.requiredCoins - result.currentCoins;
          // 格式化小数点，保留最多2位小数
          const formattedShortfall = Math.ceil(shortfall * 100) / 100;
          message += `\n💰 还差 ${formattedShortfall} 金币`;
        } else if (result.currentCapacity && result.maxCapacity) {
          // 已达上限的情况
          message += `\n📦 当前容量: ${result.currentCapacity}/${result.maxCapacity}`;
        }

        await e.reply(message);
      }

      return true;

    } catch (error) {
      logger.error(`[InventoryCommands] 升级仓库失败: ${error.message}`);
      await e.reply('❌ 升级仓库失败，请稍后再试');
      return true;
    }
  }
}
