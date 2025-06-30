/**
 * 土地管理功能命令处理器 (Miao-Yunzai 插件)
 * 处理土地扩张、品质升级等相关指令
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:30:00+08:00; Reason: Shrimp Task ID: #b7430efe, implementing land expansion system for T6;
// }}

import serviceContainer from '../services/index.js';

export class LandManagementCommands extends plugin {
  constructor() {
    super({
      name: '农场土地管理',
      dsc: '农场游戏土地扩张和管理功能',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#nc土地扩张$',
          fnc: 'expandLand'
        },
        {
          reg: '^#nc土地信息$',
          fnc: 'viewLandInfo'
        }
      ]
    });
  }

  /**
   * 土地扩张
   * @param {Object} e Miao-Yunzai事件对象
   */
  async expandLand(e) {
    try {
      const userId = e.user_id.toString();
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const landService = serviceContainer.getService('landService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 执行土地扩张
      const result = await landService.expandLand(userId);
      
      if (result.success) {
        let message = `🎉 ${result.message}\n`;
        message += `📍 扩张至第 ${result.landNumber} 块土地\n`;
        message += `💰 花费: ${result.costGold} 金币\n`;
        message += `📊 当前土地数量: ${result.currentLandCount}\n`;
        message += `💰 剩余金币: ${result.remainingCoins}`;
        
        await e.reply(message);
      } else {
        await e.reply(`❌ ${result.message}`);
      }
      
      return true;
      
    } catch (error) {
      logger.error(`[LandManagementCommands] 土地扩张失败: ${error.message}`);
      await e.reply('❌ 土地扩张失败，请稍后再试');
      return true;
    }
  }

  /**
   * 查看土地信息
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewLandInfo(e) {
    try {
      const userId = e.user_id.toString();
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const landService = serviceContainer.getService('landService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      const playerData = await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 获取土地扩张信息
      const landInfo = await landService.getLandExpansionInfo(userId);
      
      let message = `🏞️ 土地信息\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      message += `📊 当前土地: ${playerData.landCount}/${playerData.maxLandCount}\n`;
      message += `💰 当前金币: ${playerData.coins}\n`;
      message += `⭐ 当前等级: ${playerData.level}\n\n`;
      
      if (landInfo.canExpand) {
        message += `🔓 下一块土地 (#${landInfo.nextLandNumber}):\n`;
        message += `   💰 费用: ${landInfo.nextCost} 金币\n`;
        message += `   ⭐ 等级要求: ${landInfo.nextLevelRequired}\n`;
        
        if (landInfo.meetsRequirements) {
          message += '   ✅ 满足扩张条件\n';
          message += '   💡 使用 #nc土地扩张 进行扩张';
        } else {
          message += '   ❌ 不满足扩张条件\n';
          if (playerData.level < landInfo.nextLevelRequired) {
            message += `   📈 需要升级至 ${landInfo.nextLevelRequired} 级\n`;
          }
          if (playerData.coins < landInfo.nextCost) {
            message += `   💰 需要 ${landInfo.nextCost - playerData.coins} 更多金币\n`;
          }
        }
      } else {
        message += '🎯 已达到最大土地数量！';
      }
      
      await e.reply(message);
      return true;
      
    } catch (error) {
      logger.error(`[LandManagementCommands] 查看土地信息失败: ${error.message}`);
      await e.reply('❌ 查看土地信息失败，请稍后再试');
      return true;
    }
  }
} 