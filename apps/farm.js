import serviceContainer from '../services/index.js'
import Config from '../models/Config.js'
import { Puppeteer } from '../models/services.js'


// Quality config
const QUALITY_CONFIG = {
  normal: { icon: '🟫', name: '普通' },
  copper: { icon: '🟠', name: '红土' },
  silver: { icon: '⚪', name: '黑土' },
  gold: { icon: '🟡', name: '金土' }
}

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
          reg: '^#(nc)?种植全部(?:(.+))?$',
          fnc: 'plantAll'
        },
        {
          reg: '^#(nc)?种植(.+?)(\\d+)$',
          fnc: 'plantCrop'
        },
        {
          reg: '^#(nc)?浇水(\\d+|全部)$',
          fnc: 'waterCrop'
        },
        {
          reg: '^#(nc)?施肥(\\d+|全部)(.+)?$',
          fnc: 'fertilizeCrop'
        },
        {
          reg: '^#(nc)?除虫(\\d+|全部)$',
          fnc: 'pesticideCrop'
        },
        {
          reg: '^#(nc)?收获(\\d+)$',
          fnc: 'harvestCrop'
        },
        {
          reg: '^#(nc)?收获$',
          fnc: 'harvestAllCrops'
        }
      ],
      // 添加定时任务，检查作物状态
      task: [
        {
          cron: '0 0 * * * *',  // 每分钟执行一次
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
    this.inventoryService = serviceContainer.getService('inventoryService');
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

      // 构建渲染数据并渲染图片
      const renderData = this._buildFarmRenderData(playerData, true)
      await Puppeteer.render('farm/index', renderData, { e, scale: 2.0 })
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

      // 构建渲染数据并渲染图片
      const renderData = this._buildFarmRenderData(targetPlayerData, false)
      await Puppeteer.render('farm/index', renderData, { e, scale: 2.0 })
      return true
    } catch (error) {
      logger.error('[农场游戏] 显示他人农场失败:', error)
      e.reply('查看农场状态失败，请稍后重试')
      return true
    }
  }

  /**
   * 构建农场渲染数据（用于图片渲染）
   * @param {Object} playerData 玩家数据
   * @param {boolean} isOwner 是否为农场主本人
   * @param {Object} operationResult 操作结果提示（可选）
   * @returns {Object} 渲染数据
   */
  _buildFarmRenderData(playerData, isOwner = true, operationResult = null) {
    const cropsConfig = this.config.crops
    const now = Date.now()

    // 处理土地数据
    const lands = playerData.lands.map(land => {
      const quality = land.quality || 'normal'
      const qualityInfo = QUALITY_CONFIG[quality] || QUALITY_CONFIG.normal
      const isEmpty = !land.crop || land.status === 'empty'

      let landData = {
        id: land.id,
        quality,
        qualityIcon: qualityInfo.icon,
        qualityName: qualityInfo.name,
        isEmpty,
        needsWater: land.needsWater || false,
        hasPests: land.hasPests || false,
        stealable: land.status === 'mature' && land.stealable,
        status: land.status || 'empty'
      }

      if (!isEmpty) {
        const cropConfig = cropsConfig[land.crop]
        landData.cropName = cropConfig?.name || land.crop
        landData.cropIcon = this.config.getItemIcon(land.crop)

        // 计算生长进度
        if (land.status === 'mature') {
          landData.growthPercent = 100
          landData.timeRemaining = '已成熟'
        } else if (land.harvestTime) {
          const remainingTime = land.harvestTime - now

          if (remainingTime <= 0) {
            landData.growthPercent = 100
            landData.timeRemaining = '已成熟'
            landData.status = 'mature'
          } else if (land.plantTime && land.harvestTime > land.plantTime) {
            const totalTime = land.harvestTime - land.plantTime
            const elapsedTime = now - land.plantTime
            const rawPercent = Math.round((elapsedTime / totalTime) * 100)
            landData.growthPercent = Math.max(0, Math.min(99, rawPercent))
            landData.timeRemaining = this._formatTimeRemaining(remainingTime)
          } else {
            landData.growthPercent = 0
            landData.timeRemaining = this._formatTimeRemaining(remainingTime)
          }
        } else {
          landData.growthPercent = 0
          landData.timeRemaining = '生长中'
        }
      }

      return landData
    })

    const renderData = {
      isOwner,
      playerName: playerData.name,
      level: playerData.level,
      gold: playerData.gold,
      landCount: playerData.lands.length,
      maxLandCount: playerData.maxLandCount || 24,
      lands
    }

    if (operationResult) {
      renderData.operationResult = operationResult
    }

    return renderData
  }

  /**
   * 渲染农场图片并附带操作结果
   * @param {Object} e 消息事件
   * @param {string} userId 用户ID
   * @param {Object} operationResult 操作结果
   */
  async _renderFarmWithResult(e, userId, operationResult) {
    const playerData = await this.playerService.getPlayer(userId)
    const renderData = this._buildFarmRenderData(playerData, true, operationResult)
    await Puppeteer.render('farm/index', renderData, { e, scale: 2.0 })
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
      const match = e.msg.match(/^#(nc)?种植(.+)(\d+)$/);
      if (!match) {
        await e.reply('格式错误！使用: #种植[作物名称][土地编号]');
        return true;
      }

      const cropName = match[2];
      const landId = match[3];
      const landIdNum = parseInt(landId);

      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      if (!cropName.trim()) {
        await e.reply('作物名称不能为空');
        return true;
      }

      const userId = e.user_id
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const cropType = await this._parseCropType(cropName)
      if (!cropType) {
        e.reply(`未知的作物类型: ${cropName}，请检查名称是否正确`)
        return true
      }

      const result = await this.plantingService.plantCrop(userId, landIdNum, cropType)

      if (result.success) {
        const cropConfig = this.config.crops[cropType]
        await this._renderFarmWithResult(e, userId, {
          type: 'success',
          icon: '🌱',
          title: '种植成功',
          details: [`${cropConfig?.name || cropName} → #${landIdNum}`]
        })
      } else {
        e.reply(result.message)
      }
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
      const match = e.msg.match(/^#(nc)?浇水(\d+|全部)$/);
      if (!match) {
        await e.reply('格式错误！使用: #浇水[土地编号] 或 #浇水全部');
        return true;
      }

      const landParam = match[2];
      const userId = e.user_id;

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      if (landParam === '全部') {
        return await this.handleSmartWaterAll(userId, e);
      }

      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      const result = await this.plantingService.waterCrop(userId, landIdNum)

      if (result.success) {
        await this._renderFarmWithResult(e, userId, {
          type: 'success',
          icon: '💧',
          title: '浇水成功',
          details: [`#${landIdNum}号土地已浇水`]
        })
      } else {
        e.reply(result.message)
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
      const match = e.msg.match(/^#(nc)?施肥(\d+|全部)(.+)?$/);
      if (!match) {
        await e.reply('格式错误！使用: #施肥[土地编号] 或 #施肥全部');
        return true;
      }

      const landParam = match[2];
      const fertilizer = match[3];
      const userId = e.user_id;

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      let fertilizerType = null;
      if (fertilizer) {
        fertilizerType = await this._parseFertilizerType(fertilizer.trim());
        if (!fertilizerType) {
          await e.reply(`未知的肥料类型："${fertilizer}"`);
          return true;
        }
      }

      if (landParam === '全部') {
        return await this.handleSmartFertilize(userId, e, fertilizerType);
      }

      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      const result = await this.plantingService.fertilizeCrop(userId, landIdNum, fertilizerType);

      if (result.success) {
        await this._renderFarmWithResult(e, userId, {
          type: 'success',
          icon: '🧪',
          title: '施肥成功',
          details: [`#${landIdNum}号土地已施肥`]
        })
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
      const match = e.msg.match(/^#(nc)?除虫(\d+|全部)$/);
      if (!match) {
        await e.reply('格式错误！使用: #除虫[土地编号] 或 #除虫全部');
        return true;
      }

      const landParam = match[2];
      const userId = e.user_id;

      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      if (landParam === '全部') {
        return await this.handleSmartPestControl(userId, e);
      }

      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      const result = await this.plantingService.treatPests(userId, landIdNum)

      if (result.success) {
        await this._renderFarmWithResult(e, userId, {
          type: 'success',
          icon: '🐛',
          title: '除虫成功',
          details: [`#${landIdNum}号土地已除虫`]
        })
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
   * 种植全部作物 - 统一入口方法
   */
  async plantAll(e) {
    try {
      // 解析命令参数
      const match = e.msg.match(/^#(nc)?种植全部(?:(.+))?$/);
      if (!match) {
        await e.reply('❌ 格式错误！\n使用方法：\n#种植全部 - 智能自动种植\n#种植全部[作物名称] - 指定作物种植');
        return true;
      }

      const cropName = match[2]; // 可选的作物名称
      const userId = e.user_id;

      // 验证玩家注册状态
      if (!(await this.playerService.isPlayer(userId))) {
        return e.reply('您未注册，请先"#nc注册"');
      }

      // 获取空闲土地
      let emptyLands;
      try {
        emptyLands = await this.getEmptyLands(userId);
      } catch (error) {
        logger.error('[农场游戏] 获取空闲土地失败:', error);
        return e.reply('获取农场状态失败，请稍后重试');
      }

      // 检查是否有空闲土地
      if (emptyLands.length === 0) {
        return e.reply('🌾 所有土地都已种植，没有空闲土地可用！');
      }

      // 根据参数路由到不同的处理逻辑
      if (cropName) {
        // 指定作物批量种植
        return await this.plantSpecificCrop(userId, e, emptyLands, cropName);
      } else {
        // 智能选择作物批量种植
        return await this.plantWithSmartSelection(userId, e, emptyLands);
      }

    } catch (error) {
      logger.error('[农场游戏] 批量种植失败:', error);
      e.reply('批量种植失败，请稍后重试');
      return true;
    }
  }

  /**
   * 收获作物
   */
  async harvestCrop(e) {
    try {
      const match = e.msg.match(/^#(nc)?收获(\d+)$/);
      if (!match) {
        await e.reply('格式错误！使用: #收获[土地编号]');
        return true;
      }

      const landId = match[2];
      const landIdNum = parseInt(landId);

      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      const userId = e.user_id
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const result = await this.plantingService.harvestCrop(userId, landIdNum)

      if (result.success) {
        const details = []
        if (result.data?.cropName) details.push(`作物: ${result.data.cropName}`)
        if (result.data?.quantity) details.push(`数量: ${result.data.quantity}`)
        if (result.data?.gold) details.push(`金币: +${result.data.gold}`)
        if (result.data?.exp) details.push(`经验: +${result.data.exp}`)

        await this._renderFarmWithResult(e, userId, {
          type: 'success',
          icon: '🎉',
          title: '收获成功',
          details: details.length > 0 ? details : [`#${landIdNum}号土地已收获`]
        })
      } else {
        e.reply(result.message)
      }
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
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      const result = await this.plantingService.harvestCrop(userId)

      if (result.success) {
        const details = []
        if (result.data?.totalCount) details.push(`收获: ${result.data.totalCount}块土地`)
        if (result.data?.totalGold) details.push(`金币: +${result.data.totalGold}`)
        if (result.data?.totalExp) details.push(`经验: +${result.data.totalExp}`)

        await this._renderFarmWithResult(e, userId, {
          type: 'success',
          icon: '🎊',
          title: '批量收获完成',
          details: details.length > 0 ? details : ['所有成熟作物已收获']
        })
      } else {
        e.reply(result.message)
      }
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
      const matchTargets = [config.name]

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
      const matchTargets = [config.name]

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
   */
  async handleSmartWaterAll(userId, e) {
    try {
      const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
      if (!cropsStatusResult.success) {
        await e.reply('获取农场状态失败，请稍后重试');
        return true;
      }

      const waterTargets = cropsStatusResult.data.crops
        .filter(crop => crop.needsWater)
        .map(crop => crop.landId);

      if (waterTargets.length === 0) {
        await e.reply('没有需要浇水的作物，您的农场很健康！');
        return true;
      }

      let successCount = 0;
      for (const landId of waterTargets) {
        try {
          const result = await this.plantingService.waterCrop(userId, landId);
          if (result.success) successCount++;
        } catch (error) {
          logger.error(`[农场游戏] 批量浇水失败 [${userId}][${landId}]:`, error);
        }
      }

      const details = [`成功: ${successCount}块土地`]
      if (successCount < waterTargets.length) {
        details.push(`失败: ${waterTargets.length - successCount}块`)
      }

      await this._renderFarmWithResult(e, userId, {
        type: successCount > 0 ? 'success' : 'warning',
        icon: '💧',
        title: '批量浇水完成',
        details
      })
      return true;
    } catch (error) {
      logger.error('[农场游戏] 智能浇水失败:', error);
      await e.reply('智能浇水失败，请稍后重试');
      return true;
    }
  }

  /**
   * 处理智能除虫全部命令
   */
  async handleSmartPestControl(userId, e) {
    try {
      const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
      if (!cropsStatusResult.success) {
        await e.reply('获取农场状态失败，请稍后重试');
        return true;
      }

      const pestTargets = cropsStatusResult.data.crops
        .filter(crop => crop.hasPests)
        .map(crop => crop.landId);

      if (pestTargets.length === 0) {
        await e.reply('没有发现害虫，您的作物很健康！');
        return true;
      }

      let successCount = 0;
      for (const landId of pestTargets) {
        try {
          const result = await this.plantingService.treatPests(userId, landId);
          if (result.success) successCount++;
        } catch (error) {
          logger.error(`[农场游戏] 批量除虫失败 [${userId}][${landId}]:`, error);
        }
      }

      const details = [`成功: ${successCount}块土地`]
      if (successCount < pestTargets.length) {
        details.push(`失败: ${pestTargets.length - successCount}块`)
      }

      await this._renderFarmWithResult(e, userId, {
        type: successCount > 0 ? 'success' : 'warning',
        icon: '🐛',
        title: '批量除虫完成',
        details
      })
      return true;
    } catch (error) {
      logger.error('[农场游戏] 智能除虫失败:', error);
      await e.reply('智能除虫失败，请稍后重试');
      return true;
    }
  }

  /**
   * 处理智能施肥全部命令
   */
  async handleSmartFertilize(userId, e, fertilizerType = null) {
    try {
      const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
      if (!cropsStatusResult.success) {
        await e.reply('获取农场状态失败，请稍后重试');
        return true;
      }

      const fertilizeTargets = cropsStatusResult.data.crops
        .filter(crop => crop.status === 'growing')
        .map(crop => crop.landId);

      if (fertilizeTargets.length === 0) {
        await e.reply('没有生长中的作物需要施肥！');
        return true;
      }

      let successCount = 0;
      for (const landId of fertilizeTargets) {
        try {
          const result = await this.plantingService.fertilizeCrop(userId, landId, fertilizerType);
          if (result.success) successCount++;
        } catch (error) {
          logger.error(`[农场游戏] 批量施肥失败 [${userId}][${landId}]:`, error);
        }
      }

      const details = [`成功: ${successCount}块土地`]
      if (successCount < fertilizeTargets.length) {
        details.push(`失败: ${fertilizeTargets.length - successCount}块`)
      }

      await this._renderFarmWithResult(e, userId, {
        type: successCount > 0 ? 'success' : 'warning',
        icon: '🧪',
        title: '批量施肥完成',
        details
      })
      return true;
    } catch (error) {
      logger.error('[农场游戏] 智能施肥失败:', error);
      await e.reply('智能施肥失败，请稍后重试');
      return true;
    }
  }

  /**
   * 获取空闲土地列表
   * @param {string} userId 用户ID
   * @returns {Promise<Array>} 空闲土地ID数组
   */
  async getEmptyLands(userId) {
    const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
    if (!cropsStatusResult.success) {
      throw new Error('获取作物状态失败');
    }

    const cropsStatus = cropsStatusResult.data;

    // 使用 crops 数组过滤空地（现在包含所有土地信息）
    const emptyLands = cropsStatus.crops
      .filter(crop => crop.status === 'empty')
      .map(crop => crop.landId);

    return emptyLands;
  }

  /**
   * 计算作物评分
   * @param {string} cropType 作物类型
   * @param {Object} cropConfig 作物配置
   * @param {Object} seedConfig 种子配置
   * @param {number} inventory 库存数量
   * @returns {number} 作物评分
   */
  calculateCropScore(cropType, cropConfig, seedConfig, inventory) {
    // 收益率 = (售价 - 种子价格) / 种子价格
    const profitRatio = (cropConfig.sellPrice - seedConfig.price) / seedConfig.price;

    // 生长时间转换为小时
    const growTimeHours = cropConfig.growTime / 3600;

    // 时间效率 = 收益率 / 生长时间（小时）
    const timeEfficiency = profitRatio / growTimeHours;

    // 库存权重：库存数量越多，评分加成越高，但有上限
    const inventoryWeight = Math.min(inventory / 10, 1.5);

    return timeEfficiency * inventoryWeight;
  }

  /**
   * 智能作物选择算法
   * @param {Object} seedInventory 种子库存对象
   * @returns {Object|null} 选中的作物信息
   */
  selectOptimalCrop(seedInventory) {
    const cropsConfig = this.config.crops;
    const seedsConfig = this.config.items.seeds;

    let bestCrop = null;
    let bestScore = -1;

    // 遍历所有作物类型
    for (const [cropType, cropConfig] of Object.entries(cropsConfig)) {
      // 查找对应的种子配置
      const seedId = `${cropType}_seed`;
      const seedConfig = seedsConfig[seedId];

      if (!seedConfig) continue;

      // 检查库存
      const inventory = seedInventory[seedId] || 0;
      if (inventory <= 0) continue;

      // 计算评分
      const score = this.calculateCropScore(cropType, cropConfig, seedConfig, inventory);

      if (score > bestScore) {
        bestScore = score;
        bestCrop = {
          seedId,
          cropType,
          cropName: cropConfig.name,
          score,
          inventory,
          profitRatio: (cropConfig.sellPrice - seedConfig.price) / seedConfig.price,
          growTimeHours: cropConfig.growTime / 3600
        };
      }
    }

    return bestCrop;
  }

  /**
   * 智能选择作物进行批量种植
   */
  async plantWithSmartSelection(userId, e, emptyLands) {
    try {
      const inventory = await this.inventoryService.getInventory(userId);
      const seedInventory = {};

      for (const [itemId, item] of Object.entries(inventory.items)) {
        if (itemId.endsWith('_seed')) {
          seedInventory[itemId] = item.quantity;
        }
      }

      const selectedCrop = this.selectOptimalCrop(seedInventory);

      if (!selectedCrop) {
        return e.reply('您没有任何种子可以种植！请先到商店购买种子。');
      }

      const plantCount = Math.min(selectedCrop.inventory, emptyLands.length);
      const landIds = emptyLands.slice(0, plantCount);
      const results = await this.executeBatchPlanting(userId, landIds, selectedCrop.cropType);

      const details = [`作物: ${selectedCrop.cropName}`, `成功: ${results.successCount}块土地`]
      if (results.failCount > 0) details.push(`失败: ${results.failCount}块`)
      if (plantCount < emptyLands.length) details.push(`剩余空地: ${emptyLands.length - plantCount}块`)

      await this._renderFarmWithResult(e, userId, {
        type: results.successCount > 0 ? 'success' : 'warning',
        icon: '🌱',
        title: '智能种植完成',
        details
      })
      return true;
    } catch (error) {
      logger.error('[农场游戏] 智能种植失败:', error);
      e.reply('智能种植失败，请稍后重试');
      return true;
    }
  }

  /**
   * 指定作物批量种植
   */
  async plantSpecificCrop(userId, e, emptyLands, cropName) {
    try {
      const cropType = await this._parseCropType(cropName);
      if (!cropType) {
        return e.reply(`未知的作物类型："${cropName}"，请检查名称是否正确`);
      }

      const seedId = `${cropType}_seed`;
      const inventory = await this.inventoryService.getInventory(userId);
      const seedItem = inventory.items[seedId];

      if (!seedItem || seedItem.quantity <= 0) {
        return e.reply(`您没有${cropName}的种子！请先到商店购买。`);
      }

      const plantCount = Math.min(seedItem.quantity, emptyLands.length);
      const landIds = emptyLands.slice(0, plantCount);
      const results = await this.executeBatchPlanting(userId, landIds, cropType);

      const cropConfig = this.config.crops[cropType]
      const details = [`作物: ${cropConfig?.name || cropName}`, `成功: ${results.successCount}块土地`]
      if (results.failCount > 0) details.push(`失败: ${results.failCount}块`)
      if (plantCount < emptyLands.length) details.push(`剩余空地: ${emptyLands.length - plantCount}块`)

      await this._renderFarmWithResult(e, userId, {
        type: results.successCount > 0 ? 'success' : 'warning',
        icon: '🌾',
        title: '批量种植完成',
        details
      })
      return true;
    } catch (error) {
      logger.error('[农场游戏] 指定作物种植失败:', error);
      e.reply('指定作物种植失败，请稍后重试');
      return true;
    }
  }

  /**
   * 执行批量种植
   * @param {string} userId 用户ID
   * @param {Array} landIds 土地ID列表
   * @param {string} cropType 作物类型
   * @returns {Promise<Object>} 批量操作结果
   */
  async executeBatchPlanting(userId, landIds, cropType) {
    const results = {
      successCount: 0,
      failCount: 0,
      results: []
    };

    // 遍历土地列表，逐个调用现有的种植方法
    for (const landId of landIds) {
      try {
        const result = await this.plantingService.plantCrop(userId, landId, cropType);
        if (result.success) {
          results.successCount++;
        } else {
          results.failCount++;
          results.results.push(`土地${landId}: ${result.message}`);
        }
      } catch (error) {
        results.failCount++;
        results.results.push(`土地${landId}: 种植失败`);
        logger.error(`[农场游戏] 批量种植失败 [${userId}][${landId}]:`, error);
      }
    }

    return results;
  }
}