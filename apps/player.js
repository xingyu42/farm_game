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

      const renderData = this._buildPlayerRenderData(userId, playerData, userName, levelInfo, currentBonus, stealStats);
      await Puppeteer.renderVue('player/index', renderData, { e, scale: 2.0 });
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
  _buildPlayerRenderData(userId, playerData, userName, levelInfo, currentBonus, stealStats) {
    const now = Date.now();
    const experienceToNext = levelInfo ? levelInfo.experienceRequired : playerData.experience;
    const expPercentage = levelInfo ? Math.min((playerData.experience / experienceToNext) * 100, 100) : 100;
    const inventoryInfo = playerData.getInventoryInfo();

    // 下一等级解锁展示（兼容未知ID）
    const nextLevel = levelInfo?.level ?? null;
    const nextUnlockIds = Array.isArray(levelInfo?.unlocks) ? levelInfo.unlocks : [];
    const nextUnlockNames = nextUnlockIds.map(id => {
      const cfg = this.itemResolver?.findItemById(id);
      return cfg?.name ?? id;
    });
    const nextUnlocksText = nextUnlockNames.join('、');

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
      saveId: `player_${userId}`,
      avatarUrl: `https://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640`,
      playerName: playerData.name || userName,
      oderId: userId,
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
      isNewPlayer: playerData.isNewPlayer(),
      nextLevel,
      nextUnlocksText
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
   * 每日签到功能（图片化展示）
   */
  async dailySignIn(e) {
    try {
      const userId = e.user_id.toString();
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`;

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const signInResult = await this.playerService.signInService.signIn(userId);

      if (!signInResult.success) {
        await e.reply(signInResult.message);
        return true;
      }

      const renderData = this._buildSignInRenderData(signInResult, userName);
      await Puppeteer.renderVue('signin/index', renderData, { e, scale: 2.0 });
      return true;

    } catch (error) {
      logger.error('[农场游戏] 签到失败:', error);
      e.reply('签到失败，请稍后重试');
      return true;
    }
  }

  /**
   * 构建签到渲染数据
   */
  _buildSignInRenderData(signInResult, userName) {
    const { rewards, consecutiveDays, totalSignDays } = signInResult;

    // 构建本周签到数据
    const weekDays = this._buildWeekDays(consecutiveDays);

    // 计算里程碑进度
    const { nextMilestone, milestoneProgress } = this._calculateMilestoneProgress(consecutiveDays);

    // 获取明日奖励预览
    let nextRewardCoins = 0, nextRewardExp = 0;
    try {
      const previewRewards = this.playerService.signInService.getSignInRewardsPreview(consecutiveDays);
      const nextDayReward = previewRewards.find(r => r.day === consecutiveDays + 1);
      if (nextDayReward) {
        nextRewardCoins = nextDayReward.coins;
        nextRewardExp = nextDayReward.experience;
      }
    } catch (err) {
      logger.warn('[农场游戏] 获取明日奖励预览失败:', err);
    }

    // 处理物品奖励
    const rewardItems = (rewards.items || []).map(item => ({
      name: this.itemResolver ? this.itemResolver.getItemName(item.type) : item.type,
      quantity: item.quantity
    }));

    // 激励文案
    const encourageText = this._getEncourageText(consecutiveDays);

    return {
      saveId: `signin_${Date.now()}`,
      playerName: userName,
      consecutiveDays,
      totalSignDays,
      rewardCoins: rewards.coins.toLocaleString(),
      rewardExp: rewards.experience,
      rewardItems,
      hasMilestone: !!rewards.milestone,
      milestoneName: rewards.milestone || '',
      weekDays,
      nextMilestone,
      milestoneProgress,
      nextRewardCoins,
      nextRewardExp,
      encourageText
    };
  }

  /**
   * 构建本周签到数据
   */
  _buildWeekDays(consecutiveDays) {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const now = new Date();
    const todayIndex = now.getDay();

    // 获取本周一的日期
    const monday = new Date(now);
    monday.setDate(now.getDate() - (todayIndex === 0 ? 6 : todayIndex - 1));

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dayIndex = date.getDay();
      const isToday = date.toDateString() === now.toDateString();
      const isPast = date < now && !isToday;

      // 根据连续签到天数推算哪些天已签到
      let signed = false;
      if (isToday) {
        signed = true; // 今天刚签到
      } else if (isPast) {
        const daysAgo = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        signed = daysAgo < consecutiveDays;
      }

      weekDays.push({
        dayName: dayNames[dayIndex],
        signed,
        isToday
      });
    }
    return weekDays;
  }

  /**
   * 计算里程碑进度
   */
  _calculateMilestoneProgress(consecutiveDays) {
    const milestones = [7, 14, 30, 60, 100];
    const milestoneNames = ['一周', '两周', '一个月', '两个月', '百日'];

    let nextMilestoneIdx = milestones.findIndex(m => m > consecutiveDays);
    if (nextMilestoneIdx === -1) {
      return { nextMilestone: '已达成全部', milestoneProgress: 100 };
    }

    const target = milestones[nextMilestoneIdx];
    const prev = nextMilestoneIdx > 0 ? milestones[nextMilestoneIdx - 1] : 0;
    const progress = Math.round(((consecutiveDays - prev) / (target - prev)) * 100);

    return {
      nextMilestone: `${milestoneNames[nextMilestoneIdx]} (${target}天)`,
      milestoneProgress: Math.min(progress, 100)
    };
  }

  /**
   * 获取激励文案
   */
  _getEncourageText(consecutiveDays) {
    if (consecutiveDays >= 100) return '传奇农场主，你的坚持令人敬佩！';
    if (consecutiveDays >= 60) return '两个月的坚持，你已是资深农场主！';
    if (consecutiveDays >= 30) return '月度达人！继续保持这份热情！';
    if (consecutiveDays >= 14) return '两周连签，农场经营有声有色！';
    if (consecutiveDays >= 7) return '一周达成！好习惯正在养成！';
    const remaining = 7 - consecutiveDays;
    return `再坚持 ${remaining} 天，即可达成一周里程碑！`;
  }
}

// {{END MODIFICATIONS}}
