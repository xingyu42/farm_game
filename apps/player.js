// {{CHENGQI:
// Action: Added; Timestamp: 2025-01-30; Reason: Shrimp Task ID: #1cec7b17-185f-4f50-a90f-d7dbe3ac487a, Creating core player commands and service integration;
// }}
// {{START MODIFICATIONS}}

import { PlayerService } from '../services/PlayerService.js'

/**
 * 玩家系统核心命令处理器
 * 处理玩家注册、信息查询等基础功能
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
    })
  }

  /**
   * 显示玩家信息（核心功能）
   * 首次交互时自动注册玩家
   */
  async showPlayerInfo(e) {
    try {
      const userId = e.user_id
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`
      const playerService = new PlayerService()
      
      // 确保玩家已注册（自动注册机制）
      await playerService.ensurePlayer(userId, userName)
      const playerData = await playerService.getPlayerData(userId)

      if (!playerData) {
        e.reply('获取玩家信息失败，请稍后重试')
        return true
      }

      // 获取升级所需经验
      const levelInfo = await playerService.getLevelInfo(playerData.level)
      const experienceToNext = levelInfo ? levelInfo.experienceRequired : 'Max'

      // 构建玩家信息消息
      const playerInfo = [
        `🌾 ${playerData.name || userName} 的农场`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 等级: Lv.${playerData.level}`,
        `✨ 经验: ${playerData.experience}/${experienceToNext}`,
        `💰 金币: ${playerData.coins.toLocaleString()}`,
        `🏞️ 土地: ${playerData.lands.length}/24 块`,
        `📦 仓库: ${playerData.getInventoryUsage()}/${playerData.inventoryCapacity}`,
        `━━━━━━━━━━━━━━━━━━`,
        `🛡️ 防护状态: ${playerData.getDogFoodStatus()}`,
        `⏰ 偷菜冷却: ${playerData.getStealCooldownStatus()}`,
        `━━━━━━━━━━━━━━━━━━`,
        `📅 总签到: ${playerData.stats.total_signin_days} 天`,
        `📈 累计收入: ${playerData.stats.total_income.toLocaleString()} 金币`,
        `📉 累计支出: ${playerData.stats.total_expenses.toLocaleString()} 金币`
      ]

      // 如果是新玩家，添加欢迎信息
      if (playerData.experience === 0 && playerData.level === 1) {
        playerInfo.push(``, `🎉 欢迎来到农场世界！`)
        playerInfo.push(`💡 输入 #nc帮助 查看游戏指令`)
      }

      e.reply(playerInfo.join('\n'))
      return true
    } catch (error) {
      logger.error('[农场游戏] 显示玩家信息失败:', error)
      e.reply('查看玩家信息失败，请稍后重试')
      return true
    }
  }

  /**
   * 手动注册玩家
   * 虽然有自动注册机制，但提供显式注册选项
   */
  async registerPlayer(e) {
    try {
      const userId = e.user_id
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`
      const playerService = new PlayerService()
      
      // 检查玩家是否已存在
      const existingPlayer = await playerService.getPlayerData(userId)
      if (existingPlayer) {
        e.reply('您已经是注册玩家了！发送 #nc我的信息 查看详情')
        return true
      }

      // 创建新玩家
      const playerData = await playerService.createPlayer(userId, userName)
      
      if (!playerData) {
        e.reply('注册失败，请稍后重试')
        return true
      }

      const welcomeMsg = [
        `🎉 欢迎 ${userName} 加入农场世界！`,
        `━━━━━━━━━━━━━━━━━━`,
        `🎁 初始资源已到账：`,
        `💰 金币: ${playerData.coins} 枚`,
        `🏞️ 土地: ${playerData.lands.length} 块`,
        `📦 仓库容量: ${playerData.inventoryCapacity}`,
        ``,
        `🌾 您已获得初始礼包，请查看仓库！`,
        `💡 发送 #nc我的信息 查看详细信息`,
        `💡 发送 #nc帮助 查看游戏指令`
      ]

      e.reply(welcomeMsg.join('\n'))
      return true
    } catch (error) {
      logger.error('[农场游戏] 注册玩家失败:', error)
      e.reply('注册失败，请稍后重试')
      return true
    }
  }

  /**
   * 每日签到功能
   */
  async dailySignIn(e) {
    try {
      const userId = e.user_id
      const userName = e.sender?.card || e.sender?.nickname || `玩家${userId}`
      const playerService = new PlayerService()
      
      // 确保玩家已注册
      await playerService.ensurePlayer(userId, userName)
      
      // 执行签到
      const signInResult = await playerService.dailySignIn(userId)
      
      if (!signInResult.success) {
        e.reply(signInResult.message || '签到失败，请稍后重试')
        return true
      }

      const reward = signInResult.reward
      const signInMsg = [
        `✅ 签到成功！`,
        `━━━━━━━━━━━━━━━━━━`,
        `🎁 今日奖励：`,
        `💰 金币: +${reward.gold}`,
        `✨ 经验: +${reward.experience}`,
        `━━━━━━━━━━━━━━━━━━`,
        `📅 连续签到: ${signInResult.consecutiveDays} 天`,
        `📊 总签到天数: ${signInResult.totalSignInDays} 天`
      ]

      // 如果有连续签到奖励
      if (signInResult.consecutiveDays > 1 && signInResult.consecutiveDays % 7 === 0) {
        signInMsg.push(`🏆 连续签到${signInResult.consecutiveDays}天，额外奖励已发放！`)
      }

      e.reply(signInMsg.join('\n'))
      return true
    } catch (error) {
      logger.error('[农场游戏] 签到失败:', error)
      e.reply('签到失败，请稍后重试')
      return true
    }
  }
}

// {{END MODIFICATIONS}} 