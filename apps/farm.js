// {{CHENGQI:
// Action: Modified; Timestamp: 2025-06-30; Reason: Shrimp Task ID: #5cc38447, unifying service access pattern using serviceContainer;
// }}
// {{START MODIFICATIONS}}

import serviceContainer from '../services/index.js'
// {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 02:32:22 +08:00; Reason: Shrimp Task ID: #3adecc60, fixing Config import to use default import instead of named import; Principle_Applied: ModuleSystem-Standardization;}}
import Config from '../models/Config.js'

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
          reg: '^#(nc)?我的农场$',
          fnc: 'showMyFarm'
        },
        {
          reg: '^@(.+?) #(nc)?农场$',
          fnc: 'showOtherFarm'
        },
        {
          reg: '^#(nc)?(农场|信息|我的信息)$',
          fnc: 'showFarmInfo'
        },
        {
          reg: '^#(nc)?种植\\s+(\\d+)\\s+(.+)$',
          fnc: 'plantCrop'
        },
        {
          reg: '^#(nc)?种植\\s+(.+)\\s+(\\d+)$',
          fnc: 'plantCropReverse'
        },
        {
          reg: '^#(nc)?浇水\\s+(\\d+)$',
          fnc: 'waterCrop'
        },
        {
          reg: '^#(nc)?施肥\\s+(\\d+)$',
          fnc: 'fertilizeCrop'
        },
        {
          reg: '^#(nc)?除虫\\s+(\\d+)$',
          fnc: 'pesticideCrop'
        },
        {
          reg: '^#(nc)?收获\\s+(\\d+)$',
          fnc: 'harvestCrop'
        },
        {
          reg: '^#(nc)?收获$',
          fnc: 'harvestAllCrops'
        }
      ],
      // 添加定时任务，每分钟检查作物状态
      task: [
        {
          cron: '0 * * * * ?',  // 每分钟执行一次
          name: '更新作物状态',
          fnc: () => this.updateCropsStatus()
        }
      ]
    })
    
    // 初始化配置
    this.config = new Config()
  }

  /**
   * 确保服务容器已初始化
   */
  async _ensureServicesInitialized() {
    await serviceContainer.init()
  }

  /**
   * 显示我的农场状态
   */
  async showMyFarm(e) {
    try {
      const userId = e.user_id
      
      // 确保服务已初始化
      await this._ensureServicesInitialized()
      
      const playerService = serviceContainer.getService('playerService')
      
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
      
      // 确保服务已初始化
      await this._ensureServicesInitialized()
      
      const playerService = serviceContainer.getService('playerService')
      
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
      const playerService = serviceContainer.getService('playerService')
      
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
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:22:24 +08:00; Reason: Shrimp Task ID: #7ea4d09e, fixing regex capture group index error due to optional (nc)? group; Principle_Applied: RegexPattern-IndexCorrection;}}
      const [, , landId, cropName] = e.msg.match(/^#(nc)?种植\s+(\d+)\s+(.+)$/)
      const userId = e.user_id
      
      await this._ensureServicesInitialized()
      
      const playerService = serviceContainer.getService('playerService')
      
      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // 解析作物类型（支持中文名称）
      const cropType = await this._parseCropType(cropName)
      if (!cropType) {
        e.reply(`未知的作物类型: ${cropName}，请检查名称是否正确`)
        return true
      }
      
      // 调用种植服务
      const plantingService = serviceContainer.getService('plantingService')
      const result = await plantingService.plantCrop(userId, parseInt(landId), cropType)
      
      e.reply(result.message)
      return true
    } catch (error) {
      logger.error('[农场游戏] 种植作物失败:', error)
      e.reply('种植失败，请稍后重试')
      return true
    }
  }

  /**
   * 种植作物（反向参数顺序）
   */
  async plantCropReverse(e) {
    try {
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:22:24 +08:00; Reason: Shrimp Task ID: #7ea4d09e, fixing regex capture group index error due to optional (nc)? group; Principle_Applied: RegexPattern-IndexCorrection;}}
      const [, , cropName, landId] = e.msg.match(/^#(nc)?种植\s+(.+)\s+(\d+)$/)
      const userId = e.user_id
      
      await this._ensureServicesInitialized()
      
      const playerService = serviceContainer.getService('playerService')
      
      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // 解析作物类型（支持中文名称）
      const cropType = await this._parseCropType(cropName)
      if (!cropType) {
        e.reply(`未知的作物类型: ${cropName}，请检查名称是否正确`)
        return true
      }
      
      // 调用种植服务
      const plantingService = serviceContainer.getService('plantingService')
      const result = await plantingService.plantCrop(userId, parseInt(landId), cropType)
      
      e.reply(result.message)
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
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:22:24 +08:00; Reason: Shrimp Task ID: #7ea4d09e, fixing regex capture group index error due to optional (nc)? group; Principle_Applied: RegexPattern-IndexCorrection;}}
      const [, , landId] = e.msg.match(/^#(nc)?浇水\s+(\d+)$/)
      const userId = e.user_id
      
      await this._ensureServicesInitialized()
      const playerService = serviceContainer.getService('playerService')

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
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:22:24 +08:00; Reason: Shrimp Task ID: #7ea4d09e, fixing regex capture group index error due to optional (nc)? group; Principle_Applied: RegexPattern-IndexCorrection;}}
      const [, , landId] = e.msg.match(/^#(nc)?施肥\s+(\d+)$/)
      const userId = e.user_id
      
      await this._ensureServicesInitialized()
      const playerService = serviceContainer.getService('playerService')

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
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:22:24 +08:00; Reason: Shrimp Task ID: #7ea4d09e, fixing regex capture group index error due to optional (nc)? group; Principle_Applied: RegexPattern-IndexCorrection;}}
      const [, , landId] = e.msg.match(/^#(nc)?除虫\s+(\d+)$/)
      const userId = e.user_id
      
      await this._ensureServicesInitialized()
      const playerService = serviceContainer.getService('playerService')

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
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 13:22:24 +08:00; Reason: Shrimp Task ID: #7ea4d09e, fixing regex capture group index error due to optional (nc)? group; Principle_Applied: RegexPattern-IndexCorrection;}}
      const [, , landId] = e.msg.match(/^#(nc)?收获\s+(\d+)$/)
      const userId = e.user_id
      
      await this._ensureServicesInitialized()
      
      const playerService = serviceContainer.getService('playerService')
      
      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // 调用收获服务
      const plantingService = serviceContainer.getService('plantingService')
      const result = await plantingService.harvestCrop(userId, parseInt(landId))
      
      e.reply(result.message)
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
      
      await this._ensureServicesInitialized()
      
      const playerService = serviceContainer.getService('playerService')
      
      // 确保玩家已注册
      await playerService.ensurePlayer(userId)
      
      // 调用收获服务（不指定landId表示收获全部）
      const plantingService = serviceContainer.getService('plantingService')
      const result = await plantingService.harvestCrop(userId)
      
      e.reply(result.message)
      return true
    } catch (error) {
      logger.error('[农场游戏] 收获全部失败:', error)
      e.reply('收获全部失败，请稍后重试')
      return true
    }
  }

  /**
   * 定时更新作物状态
   */
  async updateCropsStatus() {
    try {
      await this._ensureServicesInitialized()
      const plantingService = serviceContainer.getService('plantingService')
      await plantingService.updateAllCropsStatus()
    } catch (error) {
      logger.error('[农场游戏] 更新作物状态失败:', error)
    }
  }

  /**
   * 解析作物类型（支持中文名称映射）
   * @param {string} cropName 作物名称
   * @returns {string|null} 作物类型ID
   */
  async _parseCropType(cropName) {
    const cropsConfig = await this.config.getCropsConfig()
    
    // 直接匹配作物ID
    if (cropsConfig[cropName]) {
      return cropName
    }
    
    // 匹配中文名称
    for (const [cropId, config] of Object.entries(cropsConfig)) {
      if (config.name === cropName || 
          config.name === cropName.replace('种子', '') ||
          cropName.includes(config.name)) {
        return cropId
      }
    }
    
    // 特殊处理常见别名
    const aliasMap = {
      '胡萝卜': 'carrot',
      '萝卜': 'carrot', 
      '西红柿': 'tomato',
      '番茄': 'tomato',
      '小麦': 'wheat',
      '麦子': 'wheat'
    }
    
    return aliasMap[cropName] || null
  }
}

// {{END MODIFICATIONS}} 