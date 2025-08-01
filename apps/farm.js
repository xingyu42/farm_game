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
          reg: '^#(nc)?浇水(\\d+|全部)$',
          fnc: 'waterCrop'
        },
        {
          reg: '^#(nc)?施肥(\\d+|全部)(?:\\s+(.+))?$',
          fnc: 'fertilizeCrop'
        },
        {
          reg: '^#(nc)?除虫(\\d+|全部)$',
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
          cron: '0 0 * * * *',  // 每小时执行一次
          name: '更新作物状态',
          fnc: () => this.updateCropsStatus()
        }
      ]
    })

    // 初始化配置
    this.config = Config

    // 初始化服务
    this._initServices();
  }

  /**
   * 初始化服务容器中的所有服务
   * 集中管理服务依赖，提高代码可维护性
   */
  _initServices() {
    this.playerService = serviceContainer.getService('playerService');
    this.plantingService = serviceContainer.getService('plantingService');
  }

  /**
   * 显示我的农场状态
   */
  async showMyFarm(e) {
    try {
      const userId = e.user_id

      // 确保玩家已注册
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const playerData = await this.playerService.getPlayer(userId)

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

      // 检查目标玩家是否存在
      if (!(await this.playerService.isPlayer(targetUserId))) return e.reply('该用户未注册，请先"#nc注册"')

      const targetPlayerData = await this.playerService.getPlayer(targetUserId)
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
    const cropName = cropConfig.name

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

      // 确保玩家已注册
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 解析作物类型（支持中文名称）
      const cropType = await this._parseCropType(cropName)
      if (!cropType) {
        e.reply(`未知的作物类型: ${cropName}，请检查名称是否正确`)
        return true
      }

      // 调用种植服务
      const result = await this.plantingService.plantCrop(userId, landIdNum, cropType)

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
      const match = e.msg.match(/^#(nc)?浇水(\d+|全部)$/);
      if (!match) {
        await e.reply('❌ 格式错误！使用: #浇水 [土地编号] 或 #浇水 全部');
        return true;
      }

      const landParam = match[2];
      const userId = e.user_id;

      // 确保玩家已注册
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 处理"全部"参数
      if (landParam === '全部') {
        return await this.handleSmartWaterAll(userId, e);
      }

      // 处理单个土地
      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }

      // 执行浇水
      const result = await this.plantingService.waterCrop(userId, landIdNum)

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
      // 支持多种格式：
      // #施肥 1          -> 自动选择最好的肥料
      // #施肥 1 普通肥料  -> 使用指定肥料
      // #施肥 全部       -> 智能施肥所有生长中的作物
      // #施肥 全部 普通肥料 -> 使用指定肥料智能施肥
      const match = e.msg.match(/^#(nc)?施肥(\d+|全部)(?:\s+(.+))?$/);
      if (!match) {
        await e.reply('❌ 格式错误！\n使用方法：\n#施肥 [土地编号] - 自动选择最好的肥料\n#施肥 [土地编号] [肥料名称] - 使用指定肥料\n#施肥 全部 - 智能施肥所有生长中的作物\n#施肥 全部 [肥料名称] - 使用指定肥料智能施肥');
        return true;
      }

      const landParam = match[2];
      const fertilizer = match[3];
      const userId = e.user_id;

      // 确保玩家已注册
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 解析肥料类型（如果指定了）
      let fertilizerType = null;
      if (fertilizer) {
        fertilizerType = await this._parseFertilizerType(fertilizer.trim());
        if (!fertilizerType) {
          await e.reply(`❌ 未知的肥料类型："${fertilizer}"\n可用肥料：普通肥料、高级肥料、顶级肥料`);
          return true;
        }
      }

      // 处理"全部"参数
      if (landParam === '全部') {
        return await this.handleSmartFertilize(userId, e, fertilizerType);
      }

      // 处理单个土地
      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }

      // 执行施肥
      const result = await this.plantingService.fertilizeCrop(userId, landIdNum, fertilizerType);

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
      const match = e.msg.match(/^#(nc)?除虫(\d+|全部)$/);
      if (!match) {
        await e.reply('❌ 格式错误！使用: #除虫 [土地编号] 或 #除虫 全部');
        return true;
      }

      const landParam = match[2];
      const userId = e.user_id;

      // 确保玩家已注册
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 处理"全部"参数
      if (landParam === '全部') {
        return await this.handleSmartPestControl(userId, e);
      }

      // 处理单个土地
      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('❌ 土地编号必须为正整数');
        return true;
      }

      // 执行除虫
      const result = await this.plantingService.treatPests(userId, landIdNum)

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

      // 确保玩家已注册
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 调用收获服务
      const result = await this.plantingService.harvestCrop(userId, landIdNum)

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

      // 确保玩家已注册
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 调用收获服务（不指定landId表示收获全部）
      const result = await this.plantingService.harvestCrop(userId)

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
      await this.plantingService.updateAllCropsStatus()
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
      const matchTargets = [config.name, ...(config.aliases)]

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
    const fertilizersConfig = itemsConfig.fertilizers

    // 2. 统一匹配中文名称和配置化别名
    const normalizedFertilizerName = fertilizerName.replace('肥料', '')

    for (const [fertilizerId, config] of Object.entries(fertilizersConfig)) {
      // 构建匹配目标数组：名称 + 别名
      const matchTargets = [config.name, ...(config.aliases)]

      // 精确匹配
      for (const target of matchTargets) {
        if (target === fertilizerName || target === normalizedFertilizerName) {
          return fertilizerId
        }
      }
    }

    return null
  }

  /**
   * 处理智能浇水全部命令
   * @param {string} userId 用户ID
   * @param {Object} e 消息事件
   * @returns {boolean} 处理结果
   */
  async handleSmartWaterAll(userId, e) {
    try {
      // 1. 获取玩家作物状态
      const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
      if (!cropsStatusResult.success) {
        await e.reply('❌ 获取农场状态失败，请稍后重试');
        return true;
      }

      const cropsStatus = cropsStatusResult.data;

      // 2. 筛选需要浇水的土地
      const waterTargets = cropsStatus.crops
        .filter(crop => crop.needsWater)
        .map(crop => crop.landId);

      // 3. 检查是否有需要浇水的土地
      if (waterTargets.length === 0) {
        await e.reply('🌿 没有需要浇水的作物，您的农场很健康！');
        return true;
      }

      // 4. 执行批量浇水
      let successCount = 0;
      let failCount = 0;
      const results = [];

      for (const landId of waterTargets) {
        try {
          const result = await this.plantingService.waterCrop(userId, landId);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            results.push(`土地${landId}: ${result.message}`);
            }
        } catch (error) {
          failCount++;
          results.push(`土地${landId}: 浇水失败`);
          logger.error(`[农场游戏] 批量浇水失败 [${userId}][${landId}]:`, error);
        }
      }

      // 5. 构建结果消息
      let message = `🌿 智能浇水完成！\n`;
      message += `✅ 成功: ${successCount}块土地\n`;
      if (failCount > 0) {
        message += `❌ 失败: ${failCount}块土地\n`;
        if (results.length > 0) {
          message += `详情:\n${results.slice(0, 3).join('\n')}`;
          if (results.length > 3) {
            message += `\n... 还有${results.length - 3}个`;
          }
        }
      }

      await e.reply(message);
      return true;

    } catch (error) {
      logger.error('[农场游戏] 智能浇水失败:', error);
      await e.reply('❌ 智能浇水失败，请稍后重试');
      return true;
    }
  }

  /**
   * 处理智能除虫全部命令
   * @param {string} userId 用户ID
   * @param {Object} e 消息事件
   * @returns {boolean} 处理结果
   */
  async handleSmartPestControl(userId, e) {
    try {
      // 1. 获取玩家作物状态
      const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
      if (!cropsStatusResult.success) {
        await e.reply('❌ 获取农场状态失败，请稍后重试');
        return true;
      }

      const cropsStatus = cropsStatusResult.data;

      // 2. 筛选有害虫的土地
      const pestTargets = cropsStatus.crops
        .filter(crop => crop.hasPests)
        .map(crop => crop.landId);

      // 3. 检查是否有需要除虫的土地
      if (pestTargets.length === 0) {
        await e.reply('🐛 没有发现害虫，您的作物很健康！');
        return true;
      }

      // 4. 执行批量除虫
      let successCount = 0;
      let failCount = 0;
      const results = [];

      for (const landId of pestTargets) {
        try {
          const result = await this.plantingService.treatPests(userId, landId);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            results.push(`土地${landId}: ${result.message}`);
          }
        } catch (error) {
          failCount++;
          results.push(`土地${landId}: 除虫失败`);
          logger.error(`[农场游戏] 批量除虫失败 [${userId}][${landId}]:`, error);
        }
      }

      // 5. 构建结果消息
      let message = `🐛 智能除虫完成！\n`;
      message += `✅ 成功: ${successCount}块土地\n`;
      if (failCount > 0) {
        message += `❌ 失败: ${failCount}块土地\n`;
        if (results.length > 0) {
          message += `详情:\n${results.slice(0, 3).join('\n')}`;
          if (results.length > 3) {
            message += `\n... 还有${results.length - 3}个`;
          }
        }
      }

      await e.reply(message);
      return true;

    } catch (error) {
      logger.error('[农场游戏] 智能除虫失败:', error);
      await e.reply('❌ 智能除虫失败，请稍后重试');
      return true;
    }
  }

  /**
   * 处理智能施肥全部命令
   * @param {string} userId 用户ID
   * @param {Object} e 消息事件
   * @param {string|null} fertilizerType 指定的肥料类型
   * @returns {boolean} 处理结果
   */
  async handleSmartFertilize(userId, e, fertilizerType = null) {
    try {
      // 1. 获取玩家作物状态
      const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
      if (!cropsStatusResult.success) {
        await e.reply('❌ 获取农场状态失败，请稍后重试');
        return true;
      }

      const cropsStatus = cropsStatusResult.data;

      // 2. 筛选生长中的作物
      const fertilizeTargets = cropsStatus.crops
        .filter(crop => crop.status === 'growing')
        .map(crop => crop.landId);

      // 3. 检查是否有可施肥的作物
      if (fertilizeTargets.length === 0) {
        await e.reply('🌱 没有生长中的作物需要施肥！');
        return true;
      }

      // 4. 执行批量施肥
      let successCount = 0;
      let failCount = 0;
      const results = [];

      for (const landId of fertilizeTargets) {
        try {
          const result = await this.plantingService.fertilizeCrop(userId, landId, fertilizerType);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            results.push(`土地${landId}: ${result.message}`);
          }
        } catch (error) {
          failCount++;
          results.push(`土地${landId}: 施肥失败`);
          logger.error(`[农场游戏] 批量施肥失败 [${userId}][${landId}]:`, error);
        }
      }

      // 5. 构建结果消息
      const fertilizerName = fertilizerType ? '指定肥料' : '自动选择肥料';
      let message = `🌱 智能施肥完成（${fertilizerName}）！\n`;
      message += `✅ 成功: ${successCount}块土地\n`;
      if (failCount > 0) {
        message += `❌ 失败: ${failCount}块土地\n`;
        if (results.length > 0) {
          message += `详情:\n${results.slice(0, 3).join('\n')}`;
          if (results.length > 3) {
            message += `\n... 还有${results.length - 3}个`;
          }
        }
      }

      await e.reply(message);
      return true;

    } catch (error) {
      logger.error('[农场游戏] 智能施肥失败:', error);
      await e.reply('❌ 智能施肥失败，请稍后重试');
      return true;
    }
  }
}

// {{END MODIFICATIONS}}