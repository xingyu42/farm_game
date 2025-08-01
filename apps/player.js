// {{CHENGQI:
// Action: Modified; Timestamp: 2025-07-14; Reason: Shrimp Task ID: #8a23c789, refactoring to use dedicated SignInService;
// }}
// {{START MODIFICATIONS}}

import serviceContainer from '../services/index.js';


/**
 * 玩家系统核心命令处理器
 * 处理玩家注册、信息查询、签到等基础功能
 */
export class player extends plugin {
  constructor() {
    super({
      name: '玩家管理',
      dsc: '玩家注册、信息查询等核心功能',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#(nc)?(我的信息|信息|个人信息|玩家信息)$',
          fnc: 'showPlayerInfo'
        },
        {
          reg: '^#(nc)?(注册|开始游戏|加入游戏)$',
          fnc: 'registerPlayer'
        },
        {
          reg: '^#(nc)?签到$',
          fnc: 'dailySignIn'
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
    this.playerService = serviceContainer.getService('playerService');
    this.protectionService = serviceContainer.getService('protectionService');
    this.stealService = serviceContainer.getService('stealService');
    this.itemResolver = serviceContainer.getService('itemResolver');
  }

  /**
   * 显示玩家信息（核心功能）
   * 首次交互时自动注册玩家
   */
  async showPlayerInfo(e) {
    try {
      const userId = e.user_id.toString();
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`;

      // 获取玩家数据
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')
      const playerData = await this.playerService.getPlayer(userId, userName);

      const levelInfo = await this.playerService.getLevelInfo(playerData.level);
      const experienceToNext = levelInfo ? levelInfo.experienceRequired : 'Max';

      // 获取当前防护加成
      const currentBonus = await this.protectionService.getProtectionBonus(userId);

      // 获取偷菜统计信息
      const stealStats = await this.stealService.getStealStatistics(userId);

      const playerInfo = [
        `🌾 ${playerData.name || userName} 的农场`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 等级: Lv.${playerData.level}`,
        `✨ 经验: ${playerData.experience}/${experienceToNext}`,
        `💰 金币: ${playerData.coins.toLocaleString()}`,
        `🏞️ 土地: ${playerData.landCount}/${playerData.maxLandCount}`,
        `📦 仓库: ${playerData.getInventoryInfo().usage}/${playerData.getInventoryInfo().capacity}`,
        `━━━━━━━━━━━━━━━━━━`,
        `🛡️ 当前防御: +${currentBonus}%`
      ];

      // 详细狗粮防护状态
      const now = Date.now();
      if (playerData.protection?.dogFood?.effectEndTime > now) {
        const remainingTime = Math.ceil((playerData.protection.dogFood.effectEndTime - now) / (1000 * 60));
        const dogFoodType = playerData.protection.dogFood.type;
        const defenseBonus = playerData.protection.dogFood.defenseBonus;
        const dogFoodName = this.itemResolver.getItemName(dogFoodType);
  
        playerInfo.push(`🍖 狗粮防护: 激活中`);
        playerInfo.push(`   类型: ${dogFoodName}`);
        playerInfo.push(`   加成: +${defenseBonus}%`);
        playerInfo.push(`   剩余: ${remainingTime}分钟`);
      } else {
        playerInfo.push(`🍖 狗粮防护: 未激活`);
      }

      // 详细偷菜状态信息
      playerInfo.push(`🥷 偷菜状态:`);
      if (stealStats.cooldownStatus.canSteal) {
        playerInfo.push(`   状态: 可以偷菜`);
      } else {
        const remainingMinutes = Math.ceil(stealStats.cooldownStatus.remainingTime / 60000);
        playerInfo.push(`   状态: 冷却中`);
        playerInfo.push(`   剩余时间: ${remainingMinutes} 分钟`);
      }
      playerInfo.push(`   今日偷菜次数: ${stealStats.totalAttemptsToday}`);
      playerInfo.push(`   基础成功率: ${stealStats.config.baseSuccessRate}%`);
      playerInfo.push(`   每次最多偷取: ${stealStats.config.maxStealPerAttempt} 块土地`);

      playerInfo.push(`━━━━━━━━━━━━━━━━━━`);
      playerInfo.push(`📅 总签到: ${playerData.signIn.totalSignDays || 0} 天`);
      playerInfo.push(`📈 连续签到: ${playerData.signIn.consecutiveDays || 0} 天`);

      if (playerData.isNewPlayer()) {
        playerInfo.push(``, `🎉 欢迎来到农场世界！`);
        playerInfo.push(`💡 输入 #nc帮助 查看游戏指令`);
      } else {
        playerInfo.push(`💡 使用 #使用狗粮 激活防护`);
      }

      e.reply(playerInfo.join('\n'));
      return true;
    } catch (error) {
      logger.error('[农场游戏] 显示玩家信息失败:', error);
      e.reply('查看玩家信息失败，请稍后重试');
      return true;
    }
  }

  /**
   * 手动注册玩家
   */
  async registerPlayer(e) {
    try {
      const userId = e.user_id.toString();
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`;

      // 创建玩家
      if (await this.playerService.isPlayer(userId)) return e.reply('您已注册，请勿重复注册')
      const playerData = await this.playerService.createPlayer(userId, userName);

      const welcomeMsg = [
        `🎉 欢迎 ${userName} 加入农场世界！`,
        `━━━━━━━━━━━━━━━━━━`,
        `🎁 初始资源已到账：`,
        `💰 金币: ${playerData.coins} 枚`,
        `🏞️ 土地: ${playerData.landCount} 块`,
        `📦 仓库容量: ${playerData.inventoryCapacity}`,
        ``,
        `🌾 您已获得初始礼包，请查看仓库！`,
        `💡 发送 #nc我的信息 查看详细信息`,
        `💡 发送 #nc帮助 查看游戏指令`
      ];

      e.reply(welcomeMsg.join('\n'));
      return true;
    } catch (error) {
      logger.error('[农场游戏] 注册玩家失败:', error);
      e.reply('注册失败，请稍后重试');
      return true;
    }
  }

  /**
   * 每日签到功能
   */
  async dailySignIn(e) {
    try {
      const userId = e.user_id.toString();

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 使用签到服务
      const signInResult = await this.playerService.signInService.signIn(userId);

      // 如果签到失败，直接返回错误信息
      if (!signInResult.success) {
        await e.reply(signInResult.message);
        return true;
      }

      // 格式化详细的签到奖励信息
      const detailedMessage = this._formatSignInRewards(signInResult);
      
      await e.reply(detailedMessage);
      return true;

    } catch (error) {
      logger.error('[农场游戏] 签到失败:', error);
      e.reply('签到失败，请稍后重试');
      return true;
    }
  }

  /**
   * 格式化签到奖励信息
   * @param {Object} signInResult 签到结果
   * @returns {string} 格式化后的奖励信息
   */
  _formatSignInRewards(signInResult) {
    const { rewards, consecutiveDays, totalSignDays } = signInResult;
    
    const messages = [
      `🎉 签到成功！连续签到 ${consecutiveDays} 天`,
      `━━━━━━━━━━━━━━━━━━`,
      `🎁 今日奖励：`
    ];

    // 基础奖励展示
    if (rewards.coins > 0) {
      messages.push(`💰 金币: +${rewards.coins.toLocaleString()}`);
    }
    
    if (rewards.experience > 0) {
      messages.push(`✨ 经验: +${rewards.experience}`);
    }

    // 物品奖励展示
    if (rewards.items && rewards.items.length > 0) {
      messages.push(`📦 物品奖励:`);
      rewards.items.forEach(item => {
        const itemName = this.itemResolver ? this.itemResolver.getItemName(item.type) : item.type;
        messages.push(`   • ${itemName} x${item.quantity}`);
      });
    }

    // 里程碑奖励特殊展示
    if (rewards.milestone) {
      messages.push(``, `🏆 里程碑达成: ${rewards.milestone}!`);
      
      // 根据连续签到天数显示特殊祝贺
      if (consecutiveDays === 7) {
        messages.push(`🌟 坚持一周签到，真不容易！`);
      } else if (consecutiveDays === 30) {
        messages.push(`🎊 连续签到一个月，你是真正的农场主！`);
      } else if (consecutiveDays === 100) {
        messages.push(`👑 签到百日成就解锁，传奇农场主诞生！`);
      }
    }

    // 签到统计信息
    messages.push(``, `📊 签到统计:`);
    messages.push(`📅 总签到天数: ${totalSignDays} 天`);
    messages.push(`🔥 连续签到: ${consecutiveDays} 天`);

    // 下次签到奖励预览 - 使用SignInService的预览功能
    try {
      const previewRewards = this.playerService.signInService.getSignInRewardsPreview(consecutiveDays);
      const nextDayReward = previewRewards.find(reward => reward.day === consecutiveDays + 1);
      
      if (nextDayReward) {
        messages.push(``, `🔮 明日奖励预览:`);
        messages.push(`💰 金币: +${nextDayReward.coins.toLocaleString()}`);
        messages.push(`✨ 经验: +${nextDayReward.experience}`);
        
        if (nextDayReward.milestone) {
          messages.push(`🏆 里程碑: ${nextDayReward.milestone}`);
        }
      }
    } catch (error) {
      logger.warn('[农场游戏] 获取明日奖励预览失败:', error);
    }

    // 激励信息
    if (consecutiveDays < 7) {
      const remainingDays = 7 - consecutiveDays;
      messages.push(``, `💪 再坚持 ${remainingDays} 天可获得一周里程碑奖励！`);
    } else if (consecutiveDays < 30) {
      const remainingDays = 30 - consecutiveDays;
      messages.push(``, `🚀 距离月度里程碑还有 ${remainingDays} 天！`);
    }

    return messages.join('\n');
  }
}

// {{END MODIFICATIONS}}