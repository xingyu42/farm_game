// {{CHENGQI:
// Action: Added; Timestamp: 2025-01-30; Reason: Shrimp Task ID: #ab881598-451c-498e-9305-7566f7991892, Creating farm management app module for plugin architecture;
// }}
// {{START MODIFICATIONS}}

import { PlayerService } from '../services/PlayerService.js'

/**
 * 农场管理功能模块
 * 处理种植、收获、农场信息查看等核心农场操作
 */
export class farm extends plugin {
  constructor() {
    super({
      name: '农场管理',
      dsc: '农场种植、收获等核心功能',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#nc(农场|信息|我的信息)$',
          fnc: 'showFarmInfo'
        },
        {
          reg: '^#nc种植\\s+(\\d+)\\s+(.+)$',
          fnc: 'plantCrop'
        },
        {
          reg: '^#nc浇水\\s+(\\d+)$',
          fnc: 'waterCrop'
        },
        {
          reg: '^#nc施肥\\s+(\\d+)$',
          fnc: 'fertilizeCrop'
        },
        {
          reg: '^#nc除虫\\s+(\\d+)$',
          fnc: 'pesticideCrop'
        },
        {
          reg: '^#nc收获\\s+(\\d+)$',
          fnc: 'harvestCrop'
        },
        {
          reg: '^#nc收获全部$',
          fnc: 'harvestAllCrops'
        }
      ]
    })
  }

  /**
   * 显示农场信息
   */
  async showFarmInfo(e) {
    try {
      const userId = e.user_id
      const playerService = new PlayerService()
      
      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      const playerData = await playerService.getPlayerData(userId)

      if (!playerData) {
        e.reply('获取玩家信息失败，请稍后重试')
        return true
      }

      // 构建农场信息消息
      const farmInfo = [
        `🌾 ${playerData.name || '农场主'} 的农场`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 等级: ${playerData.level} (${playerData.experience}/${playerData.experienceToNext})`,
        `💰 金币: ${playerData.gold}`,
        `🏞️ 土地: ${playerData.lands.length}/24`,
        `📦 仓库: ${playerData.getInventoryUsage()}/${playerData.inventory_capacity}`,
        `━━━━━━━━━━━━━━━━━━`,
        `🛡️ 狗粮保护: ${playerData.getDogFoodStatus()}`,
        `⏰ 偷菜冷却: ${playerData.getStealCooldownStatus()}`
      ]

      e.reply(farmInfo.join('\n'))
      return true
    } catch (error) {
      logger.error('[农场游戏] 显示农场信息失败:', error)
      e.reply('查看农场信息失败，请稍后重试')
      return true
    }
  }

  /**
   * 种植作物
   */
  async plantCrop(e) {
    try {
      const [, landId, cropName] = e.msg.match(/^#nc种植\s+(\d+)\s+(.+)$/)
      const userId = e.user_id
      const playerService = new PlayerService()

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // TODO: 实现种植逻辑
      // 这里需要调用种植服务，但由于种植服务还未完成，先返回提示
      e.reply(`种植功能开发中，将在第${landId}块土地种植${cropName}`)
      return true
    } catch (error) {
      logger.error('[农场游戏] 种植作物失败:', error)
      e.reply('种植失败，请稍后重试')
      return true
    }
  }

  /**
   * 浇水
   */
  async waterCrop(e) {
    try {
      const [, landId] = e.msg.match(/^#nc浇水\s+(\d+)$/)
      const userId = e.user_id
      const playerService = new PlayerService()

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // TODO: 实现浇水逻辑
      e.reply(`浇水功能开发中，将为第${landId}块土地浇水`)
      return true
    } catch (error) {
      logger.error('[农场游戏] 浇水失败:', error)
      e.reply('浇水失败，请稍后重试')
      return true
    }
  }

  /**
   * 施肥
   */
  async fertilizeCrop(e) {
    try {
      const [, landId] = e.msg.match(/^#nc施肥\s+(\d+)$/)
      const userId = e.user_id
      const playerService = new PlayerService()

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // TODO: 实现施肥逻辑
      e.reply(`施肥功能开发中，将为第${landId}块土地施肥`)
      return true
    } catch (error) {
      logger.error('[农场游戏] 施肥失败:', error)
      e.reply('施肥失败，请稍后重试')
      return true
    }
  }

  /**
   * 除虫
   */
  async pesticideCrop(e) {
    try {
      const [, landId] = e.msg.match(/^#nc除虫\s+(\d+)$/)
      const userId = e.user_id
      const playerService = new PlayerService()

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // TODO: 实现除虫逻辑
      e.reply(`除虫功能开发中，将为第${landId}块土地除虫`)
      return true
    } catch (error) {
      logger.error('[农场游戏] 除虫失败:', error)
      e.reply('除虫失败，请稍后重试')
      return true
    }
  }

  /**
   * 收获作物
   */
  async harvestCrop(e) {
    try {
      const [, landId] = e.msg.match(/^#nc收获\s+(\d+)$/)
      const userId = e.user_id
      const playerService = new PlayerService()

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // TODO: 实现收获逻辑
      e.reply(`收获功能开发中，将收获第${landId}块土地的作物`)
      return true
    } catch (error) {
      logger.error('[农场游戏] 收获作物失败:', error)
      e.reply('收获失败，请稍后重试')
      return true
    }
  }

  /**
   * 收获全部成熟作物
   */
  async harvestAllCrops(e) {
    try {
      const userId = e.user_id
      const playerService = new PlayerService()

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // TODO: 实现收获全部逻辑
      e.reply('收获全部功能开发中，将收获所有成熟的作物')
      return true
    } catch (error) {
      logger.error('[农场游戏] 收获全部失败:', error)
      e.reply('收获全部失败，请稍后重试')
      return true
    }
  }
}

// {{END MODIFICATIONS}} 