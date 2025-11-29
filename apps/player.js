// {{CHENGQI:
// Action: Modified; Timestamp: 2025-07-14; Reason: Shrimp Task ID: #8a23c789, refactoring to use dedicated SignInService;
// }}
// {{START MODIFICATIONS}}

import serviceContainer from '../services/index.js';
import { Puppeteer } from '../models/services.js';


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
   * 显示玩家信息（图片化展示）
   */
  async showPlayerInfo(e) {
    try {
      const userId = e.user_id.toString();
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`;

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const playerData = await this.playerService.getPlayer(userId, userName);
      const levelInfo = await this.playerService.getLevelInfo(playerData.level);
      const currentBonus = await this.protectionService.getProtectionBonus(userId);
      const stealStats = await this.stealService.getStealStatistics(userId);

      const renderData = this._buildPlayerRenderData(playerData, userName, levelInfo, currentBonus, stealStats);
      await Puppeteer.render('player/index', renderData, { e, scale: 2.0 });
      return true;
    } catch (error) {
      logger.error('[农场游戏] 显示玩家信息失败:', error);
      e.reply('查看玩家信息失败，请稍后重试');
      return true;
    }
  }

  /**
   * 构建玩家信息渲染数据
   */
  _buildPlayerRenderData(playerData, userName, levelInfo, currentBonus, stealStats) {
    const now = Date.now();
    const experienceToNext = levelInfo ? levelInfo.experienceRequired : playerData.experience;
    const expPercentage = levelInfo ? Math.min((playerData.experience / experienceToNext) * 100, 100) : 100;
    const inventoryInfo = playerData.getInventoryInfo();

    // 狗粮防护状态
    const dogFood = playerData.protection?.dogFood;
    const dogFoodActive = dogFood?.effectEndTime > now;
    let dogFoodName = '未激活';
    let dogFoodBonus = 0;
    let dogFoodRemaining = 0;

    if (dogFoodActive) {
      dogFoodName = this.itemResolver.getItemName(dogFood.type);
      dogFoodBonus = dogFood.defenseBonus;
      dogFoodRemaining = Math.ceil((dogFood.effectEndTime - now) / (1000 * 60));
    }

    // 偷菜状态
    const canSteal = stealStats.cooldownStatus.canSteal;
    const stealCooldown = canSteal ? 0 : Math.ceil(stealStats.cooldownStatus.remainingTime / 60000);

    return {
      saveId: `player_${playerData.userId}`,
      playerName: playerData.name || userName,
      oderId: playerData.oderId || playerData.oderId,
      level: playerData.level,
      experience: playerData.experience,
      experienceToNext: levelInfo ? experienceToNext : 'Max',
      expPercentage: Math.round(expPercentage),
      coins: playerData.coins.toLocaleString(),
      landCount: playerData.landCount,
      maxLandCount: playerData.maxLandCount,
      inventoryUsage: inventoryInfo.usage,
      inventoryCapacity: inventoryInfo.capacity,
      defenseBonus: currentBonus,
      dogFoodActive,
      dogFoodName,
      dogFoodBonus,
      dogFoodRemaining,
      canSteal,
      stealCooldown,
      todayStealCount: stealStats.totalAttemptsToday,
      stealRate: stealStats.config.baseSuccessRate,
      maxStealPerAttempt: stealStats.config.maxStealPerAttempt,
      totalSignDays: playerData.signIn.totalSignDays || 0,
      consecutiveDays: playerData.signIn.consecutiveDays || 0,
      isNewPlayer: playerData.isNewPlayer()
    };
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
        `💡 发送 #农场帮助 查看游戏指令`
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