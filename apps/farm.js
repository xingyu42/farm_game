// {{CHENGQI:
// Action: Added; Timestamp: 2025-01-30; Reason: Shrimp Task ID: #ab881598-451c-498e-9305-7566f7991892, Creating farm management app module for plugin architecture;
// }}
// {{START MODIFICATIONS}}

import { PlayerService } from '../services/PlayerService.js'
import { Config } from '../models/Config.js'

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
          reg: '^#nc我的农场$',
          fnc: 'showMyFarm'
        },
        {
          reg: '^@(.+?) #nc农场$',
          fnc: 'showOtherFarm'
        },
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
    
    // 初始化配置
    this.config = new Config()
  }

  /**
   * 显示我的农场状态
   */
  async showMyFarm(e) {
    try {
      const userId = e.user_id
      const playerService = new PlayerService()
      
      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      const playerData = await playerService.getPlayerData(userId)

      if (!playerData) {
        e.reply('获取农场信息失败，请稍后重试')
        return true
      }

      const farmDisplay = await this._buildFarmDisplay(playerData, true)
      e.reply(farmDisplay)
      return true
    } catch (error) {
      logger.error('[农场游戏] 显示我的农场失败:', error)
      e.reply('查看农场状态失败，请稍后重试')
      return true
    }
  }

  /**
   * 显示他人农场状态
   */
  async showOtherFarm(e) {
    try {
      // 提取被@用户的QQ号
      const atUser = e.at
      if (!atUser || atUser.length === 0) {
        e.reply('请正确@要查看的用户')
        return true
      }
      
      const targetUserId = atUser[0]
      const playerService = new PlayerService()
      
      // 检查目标玩家是否存在
      const targetPlayerData = await playerService.getPlayerData(targetUserId)
      if (!targetPlayerData) {
        e.reply('该用户还没有开始游戏哦~')
        return true
      }

      const farmDisplay = await this._buildFarmDisplay(targetPlayerData, false)
      e.reply(farmDisplay)
      return true
    } catch (error) {
      logger.error('[农场游戏] 显示他人农场失败:', error)
      e.reply('查看农场状态失败，请稍后重试')
      return true
    }
  }

  /**
   * 构建农场状态显示
   * @param {Object} playerData 玩家数据
   * @param {boolean} isOwner 是否为农场主本人
   * @returns {string} 农场状态显示文本
   */
  async _buildFarmDisplay(playerData, isOwner = true) {
    const ownerTitle = isOwner ? '我的农场' : `${playerData.name || '玩家'} 的农场`
    
    // 农场基础信息
    const farmInfo = [
      `🌾 ${ownerTitle}`,
      `━━━━━━━━━━━━━━━━━━`,
      `👤 等级: ${playerData.level} | 💰 金币: ${playerData.gold}`,
      `🏞️ 土地: ${playerData.lands.length}/${playerData.maxLandCount || 24}`,
      `━━━━━━━━━━━━━━━━━━`
    ]

    // 获取作物配置
    const cropsConfig = await this.config.getCropsConfig()
    const landConfig = await this.config.getLandConfig()
    
    // 显示每块土地的状态
    for (let i = 0; i < playerData.lands.length; i++) {
      const land = playerData.lands[i]
      const landDisplay = this._formatLandStatus(land, cropsConfig, landConfig)
      farmInfo.push(landDisplay)
    }

    // 添加保护状态（仅对自己可见）
    if (isOwner) {
      farmInfo.push(`━━━━━━━━━━━━━━━━━━`)
      farmInfo.push(`🛡️ 狗粮保护: ${playerData.getDogFoodStatus()}`)
      farmInfo.push(`⏰ 偷菜冷却: ${playerData.getStealCooldownStatus()}`)
    }

    return farmInfo.join('\n')
  }

  /**
   * 格式化土地状态显示
   * 格式：[品质][地号]：[作物名] [健康度] [成熟时间] [负面状态] [可偷窃]
   * @param {Object} land 土地数据
   * @param {Object} cropsConfig 作物配置
   * @param {Object} landConfig 土地配置
   * @returns {string} 土地状态文本
   */
  _formatLandStatus(land, cropsConfig, landConfig) {
    const landId = land.id
    const quality = land.quality || 'normal'
    const qualityConfig = landConfig.quality?.[quality] || landConfig.quality?.normal
    const qualityName = qualityConfig?.name || '普通土地'
    
    // 品质标识
    const qualityIcon = this._getQualityIcon(quality)
    
    if (!land.crop || land.status === 'empty') {
      return `${qualityIcon}[${landId}]：空闲`
    }

    // 获取作物信息
    const cropConfig = cropsConfig[land.crop]
    const cropName = cropConfig?.name || land.crop
    
    // 健康度
    const health = land.health || 100
    const healthDisplay = health === 100 ? '健康' : `${health}%`
    
    // 成熟时间
    let timeDisplay = ''
    const now = Date.now()
    
    if (land.status === 'mature') {
      timeDisplay = '已成熟'
    } else if (land.harvestTime) {
      const remainingTime = land.harvestTime - now
      if (remainingTime > 0) {
        timeDisplay = this._formatTimeRemaining(remainingTime)
      } else {
        timeDisplay = '已成熟'
      }
    } else {
      timeDisplay = '生长中'
    }
    
    // 负面状态
    const negativeStates = []
    if (land.needsWater) negativeStates.push('缺水')
    if (land.hasPests) negativeStates.push('害虫')
    const negativeDisplay = negativeStates.length > 0 ? `[${negativeStates.join(',')}]` : ''
    
    // 可偷窃状态
    const stealableDisplay = (land.status === 'mature' && land.stealable) ? '[可偷]' : ''
    
    return `${qualityIcon}[${landId}]：${cropName} ${healthDisplay} ${timeDisplay} ${negativeDisplay} ${stealableDisplay}`.trim()
  }

  /**
   * 获取品质图标
   * @param {string} quality 品质类型
   * @returns {string} 品质图标
   */
  _getQualityIcon(quality) {
    const qualityIcons = {
      normal: '🟫',    // 普通土地 - 棕色
      copper: '🟠',    // 铜质土地 - 橙色  
      silver: '⚪',    // 银质土地 - 白色
      gold: '🟡'       // 金质土地 - 黄色
    }
    return qualityIcons[quality] || qualityIcons.normal
  }

  /**
   * 格式化剩余时间显示
   * @param {number} milliseconds 剩余毫秒数
   * @returns {string} 格式化的时间文本
   */
  _formatTimeRemaining(milliseconds) {
    const totalSeconds = Math.ceil(milliseconds / 1000)
    
    if (totalSeconds < 60) {
      return `${totalSeconds}秒`
    } else if (totalSeconds < 3600) {
      const minutes = Math.ceil(totalSeconds / 60)
      return `${minutes}分钟`
    } else {
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.ceil((totalSeconds % 3600) / 60)
      return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
    }
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