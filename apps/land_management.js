/**
 * 土地管理功能命令处理器 (Miao-Yunzai 插件)
 * 处理土地扩张、品质升级等相关指令
 */

// {{CHENGQI:
// Action: Modified; Timestamp: 2025-06-30T13:47:33+08:00; Reason: Shrimp Task ID: #c69301bb, adding land quality upgrade commands for T7;
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
          reg: '^#(nc)?土地扩张$',
          fnc: 'expandLand'
        },
        {
          reg: '^#(nc)?土地信息$',
          fnc: 'viewLandInfo'
        },
        {
          reg: '^#(nc)?土地进阶\\s*(\\d+)?$',
          fnc: 'upgradeLandQuality'
        },
        {
          reg: '^#(nc)?土地品质\\s*(\\d+)?$',
          fnc: 'viewLandQualityInfo'
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

  /**
   * 土地品质进阶
   * @param {Object} e Miao-Yunzai事件对象
   */
  async upgradeLandQuality(e) {
    try {
      const userId = e.user_id.toString();
      const match = e.msg.match(/^#(nc)?土地进阶\s*(\d+)?$/);
      
      if (!match || !match[1]) {
        await e.reply('请指定要进阶的土地编号，例如：#nc土地进阶 1');
        return true;
      }
      
      const landId = parseInt(match[1]);
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const landService = serviceContainer.getService('landService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      // 执行土地品质进阶
      const result = await landService.upgradeLandQuality(userId, landId);
      
      if (result.success) {
        let message = `✨ ${result.message}\n`;
        message += `📍 土地编号: ${result.landId}\n`;
        message += `⬆️ 品质变化: ${result.fromQualityName} → ${result.toQualityName}\n`;
        message += `💰 花费金币: ${result.costGold}\n`;
        
        if (result.materialsCost && result.materialsCost.length > 0) {
          message += `🔧 消耗材料:\n`;
          for (const material of result.materialsCost) {
            const materialName = this._getItemName(material.item_id);
            message += `   • ${materialName} x${material.quantity}\n`;
          }
        }
        
        message += `💰 剩余金币: ${result.remainingCoins}`;
        
        await e.reply(message);
      } else {
        await e.reply(`❌ ${result.message}`);
      }
      
      return true;
      
    } catch (error) {
      logger.error(`[LandManagementCommands] 土地品质进阶失败: ${error.message}`);
      await e.reply('❌ 土地品质进阶失败，请稍后再试');
      return true;
    }
  }

  /**
   * 查看土地品质信息
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewLandQualityInfo(e) {
    try {
      const userId = e.user_id.toString();
      const match = e.msg.match(/^#(nc)?土地品质\s*(\d+)?$/);
      
      // 确保服务已初始化
      await serviceContainer.init();
      
      const landService = serviceContainer.getService('landService');
      const playerService = serviceContainer.getService('playerService');
      
      // 确保玩家存在
      const playerData = await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);
      
      if (!match || !match[1]) {
        // 显示所有土地的品质概览
        let message = `🏞️ 土地品质概览\n`;
        message += '━━━━━━━━━━━━━━━━━━━━\n';
        
        for (let i = 1; i <= playerData.landCount; i++) {
          const landKey = `land_${i}`;
          const land = playerData.lands?.[landKey] || {};
          const quality = land.quality || 'normal';
          const qualityIcon = this._getQualityIcon(quality);
          
          message += `${qualityIcon} 土地${i}: ${this._getQualityName(quality)}\n`;
        }
        
        message += '\n💡 使用 #nc土地品质 数字 查看详细信息';
        message += '\n💡 使用 #nc土地进阶 数字 进行品质进阶';
        
        await e.reply(message);
        return true;
      }
      
      const landId = parseInt(match[1]);
      
      // 获取土地品质进阶信息
      const upgradeInfo = await landService.getLandQualityUpgradeInfo(userId, landId);
      
      if (!upgradeInfo.canUpgrade && upgradeInfo.error) {
        await e.reply(`❌ ${upgradeInfo.error}`);
        return true;
      }
      
      let message = `🏞️ 土地 ${landId} 品质信息\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\n';
      message += `${this._getQualityIcon(upgradeInfo.currentQuality)} 当前品质: ${upgradeInfo.currentQualityName}\n\n`;
      
      if (upgradeInfo.canUpgrade && upgradeInfo.nextQuality) {
        message += `⬆️ 可进阶至: ${upgradeInfo.nextQualityName}\n`;
        message += `💰 金币需求: ${upgradeInfo.requirements.gold}\n`;
        message += `⭐ 等级需求: ${upgradeInfo.requirements.level}\n`;
        
        if (upgradeInfo.requirements.materials && upgradeInfo.requirements.materials.length > 0) {
          message += `🔧 材料需求:\n`;
          for (const material of upgradeInfo.requirements.materials) {
            const materialName = this._getItemName(material.item_id);
            const currentQuantity = upgradeInfo.playerStatus.inventory[material.item_id]?.quantity || 0;
            const hasEnough = currentQuantity >= material.quantity;
            const status = hasEnough ? '✅' : '❌';
            message += `   ${status} ${materialName}: ${currentQuantity}/${material.quantity}\n`;
          }
        }
        
        message += '\n📊 当前状态:\n';
        message += `   💰 金币: ${upgradeInfo.playerStatus.coins}/${upgradeInfo.requirements.gold} ${upgradeInfo.meetsGoldRequirement ? '✅' : '❌'}\n`;
        message += `   ⭐ 等级: ${upgradeInfo.playerStatus.level}/${upgradeInfo.requirements.level} ${upgradeInfo.meetsLevelRequirement ? '✅' : '❌'}\n`;
        message += `   🔧 材料: ${upgradeInfo.meetsMaterialRequirement ? '✅' : '❌'}\n`;
        
        if (upgradeInfo.meetsAllRequirements) {
          message += '\n🎉 满足所有进阶条件！';
          message += `\n💡 使用 #nc土地进阶 ${landId} 进行品质进阶`;
        } else {
          message += '\n⚠️ 进阶条件未满足';
          if (upgradeInfo.materialIssues.length > 0) {
            message += `\n❌ ${upgradeInfo.materialIssues.join('；')}`;
          }
        }
      } else if (upgradeInfo.reason) {
        message += `🎯 ${upgradeInfo.reason}`;
      }
      
      await e.reply(message);
      return true;
      
    } catch (error) {
      logger.error(`[LandManagementCommands] 查看土地品质信息失败: ${error.message}`);
      await e.reply('❌ 查看土地品质信息失败，请稍后再试');
      return true;
    }
  }

  /**
   * 获取品质图标
   * @param {string} quality 品质类型
   */
  _getQualityIcon(quality) {
    const qualityIcons = {
      normal: '🟫',   // 普通土地
      copper: '🟠',   // 铜质土地
      silver: '⚪',   // 银质土地
      gold: '🟡'      // 金质土地
    };
    return qualityIcons[quality] || qualityIcons.normal;
  }

  /**
   * 获取品质名称
   * @param {string} quality 品质类型
   */
  _getQualityName(quality) {
    const qualityNames = {
      normal: '普通土地',
      copper: '铜质土地',
      silver: '银质土地',
      gold: '金质土地'
    };
    return qualityNames[quality] || qualityNames.normal;
  }

  /**
   * 获取物品名称（临时方法，应该从配置获取）
   * @param {string} itemId 物品ID
   */
  _getItemName(itemId) {
    const itemNames = {
      copper_essence: '铜质精华',
      silver_essence: '银质精华',
      gold_essence: '金质精华'
    };
    return itemNames[itemId] || itemId;
  }
} 