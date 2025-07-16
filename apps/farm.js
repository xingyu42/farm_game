import serviceContainer from '../services/index.js'
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
          reg: '^#(nc)?农场$',
          fnc: 'showOtherFarm'
        },
        {
          reg: '^#(nc)?种植\\s+(.+)\\s+(\\d+)$',
          fnc: 'plantCrop'
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
          cron: '0 * * * * *',  // 每分钟执行一次（修复：? 改为 *）
          name: '更新作物状态',
          fnc: () => this.updateCropsStatus()
        }
      ]
    })

    // 初始化配置
    this.config = Config
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
      const targetUserId = e.at

      // 增加对 targetUserId 的校验
      if (!targetUserId) {
        e.reply('无法获取到目标用户信息，请确认指令是否正确。')
        return true
      }

      // 确保服务已初始化
      await this._ensureServicesInitialized()

      const playerService = serviceContainer.getService('playerService')

      // 检查目标玩家是否存在（不自动创建）
      const targetPlayerData = await playerService.getDataService().getPlayerFromHash(targetUserId)
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
    const ownerTitle = isOwner ? '我的农场' : `${playerData.name} 的农场`

    // 农场基础信息
    const farmInfo = [
      `🌾 ${ownerTitle}`,
      `━━━━━━━━━━━━━━━━━━`,
      `👤 等级: ${playerData.level} | 💰 金币: ${playerData.gold}`,
      `🏞️ 土地: ${playerData.lands.length}/${playerData.maxLandCount || 24}`,
      `━━━━━━━━━━━━━━━━━━`
    ]

    // 获取作物配置
    const cropsConfig = this.config.crops

    // 显示每块土地的状态
    for (let i = 0; i < playerData.lands.length; i++) {
      const land = playerData.lands[i]
      const landDisplay = this._formatLandStatus(land, cropsConfig)
      farmInfo.push(landDisplay)
    }


    return farmInfo.join('\n')
  }

  /**
   * 格式化土地状态显示
   * 格式：[品质][地号]：[作物名] [健康度] [成熟时间] [负面状态] [可偷窃]
   * @param {Object} land 土地数据
   * @param {Object} cropsConfig 作物配置
   * @returns {string} 土地状态文本
   */
  _formatLandStatus(land, cropsConfig) {
    const landId = land.id
    const quality = land.quality || 'normal'

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
   * 种植作物
   */
  async plantCrop(e) {
    try {
      // 优化：使用更高效的正则匹配，避免重复解析
      const match = e.msg.match(/^#(nc)?种植\s+(.+)\s+(\d+)$/);
      if (!match) {
        await e.reply('❌ 格式错误！使用: #种植 [作物名称] [土地编号]');
        return true;
      }

      const cropName = match[2];
      const landId = match[3];

      // 输入验证增强
      const landIdNum = parseInt(landId);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }

      if (!cropName.trim()) {
        await e.reply('❌ 作物名称不能为空');
        return true;
      }
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
      const result = await plantingService.plantCrop(userId, landIdNum, cropType)

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
      // 优化：使用更高效的正则匹配，避免重复解析
      const match = e.msg.match(/^#(nc)?浇水\s+(\d+)$/);
      if (!match) {
        await e.reply('❌ 格式错误！使用: #浇水 [土地编号]');
        return true;
      }

      const landId = match[2];

      // 输入验证增强
      const landIdNum = parseInt(landId);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }
      const userId = e.user_id

      await this._ensureServicesInitialized()
      const playerService = serviceContainer.getService('playerService')
      const plantingService = serviceContainer.getService('plantingService')

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)

      // 执行浇水
      const result = await plantingService.waterCrop(userId, landIdNum)

      if (result.success) {
        await e.reply(result.message)
      } else {
        await e.reply(result.message)
      }

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
      // 支持两种格式：
      // #施肥 1          -> 自动选择最好的肥料
      // #施肥 1 普通肥料  -> 使用指定肥料
      const match = e.msg.match(/^#(nc)?施肥\s+(\d+)(?:\s+(.+))?$/);
      if (!match) {
        await e.reply('❌ 格式错误！\n使用方法：\n#施肥 [土地编号] - 自动选择最好的肥料\n#施肥 [土地编号] [肥料名称] - 使用指定肥料');
        return true;
      }

      const landId = match[2];
      const fertilizer = match[3];

      // 输入验证增强
      const landIdNum = parseInt(landId);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }

      const userId = e.user_id;

      await this._ensureServicesInitialized();
      const playerService = serviceContainer.getService('playerService');
      const plantingService = serviceContainer.getService('plantingService');

      // 确保玩家已注册
      await playerService.ensurePlayer(userId);

      // 解析肥料类型（如果指定了）
      let fertilizerType = null;
      if (fertilizer) {
        fertilizerType = await this._parseFertilizerType(fertilizer.trim());
        if (!fertilizerType) {
          await e.reply(`❌ 未知的肥料类型："${fertilizer}"\n可用肥料：普通肥料、高级肥料、顶级肥料`);
          return true;
        }
      }

      // 执行施肥
      const result = await plantingService.fertilizeCrop(userId, landIdNum, fertilizerType);

      if (result.success) {
        await e.reply(result.message);
      } else {
        await e.reply(result.message);
      }

      return true;
    } catch (error) {
      logger.error('[农场游戏] 施肥失败:', error);
      e.reply('施肥失败，请稍后重试');
      return true;
    }
  }

  /**
   * 除虫
   */
  async pesticideCrop(e) {
    try {
      // 优化：使用更高效的正则匹配，避免重复解析
      const match = e.msg.match(/^#(nc)?除虫\s+(\d+)$/);
      if (!match) {
        await e.reply('❌ 格式错误！使用: #除虫 [土地编号]');
        return true;
      }

      const landId = match[2];

      // 输入验证增强
      const landIdNum = parseInt(landId);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }
      const userId = e.user_id

      await this._ensureServicesInitialized()
      const playerService = serviceContainer.getService('playerService')
      const plantingService = serviceContainer.getService('plantingService')

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)

      // 执行除虫
      const result = await plantingService.pesticideCrop(userId, landIdNum)

      if (result.success) {
        await e.reply(result.message)
      } else {
        await e.reply(result.message)
      }

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
      // 优化：使用更高效的正则匹配，避免重复解析
      const match = e.msg.match(/^#(nc)?收获\s+(\d+)$/);
      if (!match) {
        await e.reply('❌ 格式错误！使用: #收获 [土地编号]');
        return true;
      }

      const landId = match[2];

      // 输入验证增强
      const landIdNum = parseInt(landId);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }
      const userId = e.user_id

      await this._ensureServicesInitialized()

      const playerService = serviceContainer.getService('playerService')

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)

      // 调用收获服务
      const plantingService = serviceContainer.getService('plantingService')
      const result = await plantingService.harvestCrop(userId, landIdNum)

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
   * 解析作物类型（支持中文名称映射和配置化别名）
   * @param {string} cropName 作物名称
   * @returns {string|null} 作物类型ID
   */
  async _parseCropType(cropName) {
    const cropsConfig = this.config.crops

    // 1. 直接匹配作物ID
    if (cropsConfig[cropName]) {
      return cropName
    }

    // 2. 统一匹配中文名称和配置化别名（仅精确匹配）
    const normalizedCropName = cropName.replace('种子', '')

    for (const [cropId, config] of Object.entries(cropsConfig)) {
      const matchTargets = [config.name, ...(config.aliases || [])]

      for (const target of matchTargets) {
        if (target === cropName || target === normalizedCropName) {
          return cropId
        }
      }
    }

    return null
  }

  /**
   * 解析肥料类型（支持中文名称映射和配置化别名）
   * @param {string} fertilizerName 肥料名称
   * @returns {string|null} 肥料类型ID
   */
  async _parseFertilizerType(fertilizerName) {
    const itemsConfig = this.config.items
    const fertilizersConfig = itemsConfig?.fertilizers || {}

    // 2. 统一匹配中文名称和配置化别名
    const normalizedFertilizerName = fertilizerName.replace('肥料', '')

    for (const [fertilizerId, config] of Object.entries(fertilizersConfig)) {
      // 构建匹配目标数组：名称 + 别名
      const matchTargets = [config.name, ...(config.aliases || [])]

      // 精确匹配
      for (const target of matchTargets) {
        if (target === fertilizerName || target === normalizedFertilizerName) {
          return fertilizerId
        }
      }
    }

    return null
  }
}

// {{END MODIFICATIONS}} 