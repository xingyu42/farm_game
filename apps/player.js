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
  }

  /**
   * 显示玩家信息（核心功能）
   * 首次交互时自动注册玩家
   */
  async showPlayerInfo(e) {
    try {
      const userId = e.user_id.toString();
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`;

      // 确保服务已初始化
      await serviceContainer.init();
      const playerService = serviceContainer.getService('playerService');

      const playerData = await playerService.ensurePlayer(userId, userName);

      if (!playerData) {
        e.reply('获取玩家信息失败，请稍后重试');
        return true;
      }

      const levelInfo = await playerService.getLevelInfo(playerData.level);
      const experienceToNext = levelInfo ? levelInfo.experienceRequired : 'Max';

      const playerInfo = [
        `🌾 ${playerData.name || userName} 的农场`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 等级: Lv.${playerData.level}`,
        `✨ 经验: ${playerData.experience}/${experienceToNext}`,
        `💰 金币: ${playerData.coins.toLocaleString()}`,
        `🏞️ 土地: ${playerData.landCount}/${playerData.maxLandCount}`,
        `📦 仓库: ${playerData.getInventoryInfo().usage}/${playerData.getInventoryInfo().capacity}`,
        `━━━━━━━━━━━━━━━━━━`,
        `🛡️ 防护状态: ${playerData.getDogFoodStatus()}`,
        `⏰ 偷菜冷却: ${playerData.getStealCooldownStatus()}`,
        `━━━━━━━━━━━━━━━━━━`,
        `📅 总签到: ${playerData.signIn.totalSignDays || 0} 天`,
        `📈 连续签到: ${playerData.signIn.consecutiveDays || 0} 天`
      ];

      if (playerData.isNewPlayer()) {
        playerInfo.push(``, `🎉 欢迎来到农场世界！`);
        playerInfo.push(`💡 输入 #nc帮助 查看游戏指令`);
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

      // 确保服务已初始化
      await serviceContainer.init();
      const playerService = serviceContainer.getService('playerService');

      const existingPlayer = await playerService.getPlayer(userId);
      if (existingPlayer) {
        e.reply('您已经是注册玩家了！发送 #nc我的信息 查看详情');
        return true;
      }

      const playerData = await playerService.createPlayer(userId, userName);
      
      if (!playerData) {
        e.reply('注册失败，请稍后重试');
        return true;
      }

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

      // 确保服务已初始化
      await serviceContainer.init();
      const playerService = serviceContainer.getService('playerService');

      await playerService.ensurePlayer(userId, e.sender?.card || e.sender?.nickname);

      // 使用签到服务
      const signInResult = await playerService.signInService.signIn(userId);

      await e.reply(signInResult.message);
      return true;

    } catch (error) {
      logger.error('[农场游戏] 签到失败:', error);
      e.reply('签到失败，请稍后重试');
      return true;
    }
  }
}

// {{END MODIFICATIONS}}