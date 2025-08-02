/**
 * 土地管理功能命令处理器 (Miao-Yunzai 插件)
 * 处理土地扩张、品质升级、强化等相关指令
 */
import serviceContainer from '../services/index.js';
import ItemResolver from '../utils/ItemResolver.js';

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
          reg: '^#(nc)?土地进阶(\\d+)?$',
          fnc: 'upgradeLandQuality'
        },
        {
          reg: '^#(nc)?土地品质(\\d+)?$',
          fnc: 'viewLandQualityInfo'
        },
        {
          reg: '^#(nc)?强化土地(\\d+)?$',
          fnc: 'enhanceLand'
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
    this.landService = serviceContainer.getService('landService');
    this.playerService = serviceContainer.getService('playerService');
    this.config = serviceContainer.getService('config');

    // 初始化ItemResolver
    this.itemResolver = new ItemResolver(this.config);
  }

  _getItemName(itemId) {
    if (!this.itemResolver) {
      logger.warn('[LandManagementCommands] ItemResolver未初始化！');
      return itemId;
    }
    return this.itemResolver.getItemName(itemId);
  }

  async expandLand(e) {
    try {
      const userId = e.user_id.toString();
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')
      const result = await this.landService.expandLand(userId);

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

  async viewLandInfo(e) {
    try {
      const userId = e.user_id.toString();
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')
      const playerData = await this.playerService.getPlayer(userId, e.sender?.card || e.sender?.nickname);
      const landInfo = await this.landService.getLandExpansionInfo(userId);

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

  async upgradeLandQuality(e) {
    try {
      const userId = e.user_id.toString();
      const match = e.msg.match(/^#(nc)?土地进阶(\d+)?$/);

      if (!match || !match[2]) {
        await e.reply('请指定要进阶的土地编号，例如：#nc土地进阶1');
        return true;
      }

      const landId = parseInt(match[2]);

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const result = await this.landService.upgradeLandQuality(userId, landId);

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

  async viewLandQualityInfo(e) {
    try {
      const userId = e.user_id.toString();
      const match = e.msg.match(/^#(nc)?土地品质(\d+)?$/);

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')
      const playerData = await this.playerService.getPlayer(userId, e.sender?.card || e.sender?.nickname);

      if (!match || !match[2]) {
        let message = `🏞️ 土地品质概览\n`;
        message += '━━━━━━━━━━━━━━━━━━━━\n';
        for (let i = 1; i <= playerData.landCount; i++) {
          const land = playerData.lands?.[i - 1] || {};
          const quality = land.quality || 'normal';
          const qualityIcon = this._getQualityIcon(quality);
          message += `${qualityIcon} 土地${i}: ${this._getQualityName(quality)}\n`;
        }
        message += '\n💡 使用 #nc土地品质数字 查看详细信息';
        message += '\n💡 使用 #nc土地进阶数字 进行品质进阶';
        await e.reply(message);
        return true;
      }

      const landId = parseInt(match[2]);
      const upgradeInfo = await this.landService.getLandQualityUpgradeInfo(userId, landId);

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

  async enhanceLand(e) {
    try {
      const userId = e.user_id.toString();
      const match = e.msg.match(/^#(nc)?强化土地(\d+)?$/);

      if (!match || !match[2]) {
        await e.reply('请指定要强化的土地编号，例如：#nc强化土地1');
        return true;
      }

      const landId = parseInt(match[2]);

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const result = await this.landService.enhanceLand(userId, landId);

      await e.reply(result.message);

      return true;
    } catch (error) {
      logger.error(`[LandManagementCommands] 强化土地失败: ${error.message}`);
      await e.reply('❌ 强化土地失败，请稍后再试');
      return true;
    }
  }

  _getQualityIcon(quality) {
    const qualityIcons = {
      normal: '🟫',
      copper: '🟠',
      silver: '⚪',
      gold: '🟡'
    };
    return qualityIcons[quality] || qualityIcons.normal;
  }

  _getQualityName(quality) {
    const qualityNames = {
      normal: '普通土地',
      copper: '铜质土地',
      silver: '银质土地',
      gold: '金质土地'
    };
    return qualityNames[quality] || qualityNames.normal;
  }
}