/**
 * @fileoverview 农场核心操作应用层 - 种植、浇水、施肥、除虫、收获、铲除
 *
 * Input:
 * - ../services/index.js - ServiceContainer (获取 PlantingService, PlayerService)
 * - ../models/Config.js - 全局配置对象
 * - ../models/services.js - Puppeteer (图片渲染)
 * - ../services/planting/PlantingMessageBuilder.js - 种植消息构建器
 * - ../../../lib/plugins/plugin.js - Miao-Yunzai 插件基类
 *
 * Output:
 * - farm (class) - 农场核心操作指令处理器,导出给 index.js 动态加载
 *
 * Pos: 应用层核心模块,处理农场所有核心操作指令 (#我的农场/#种植/#浇水/#施肥/#除虫/#铲除/#收获)
 */

import serviceContainer from '../services/index.js'
import Config from '../models/Config.js'
import { Puppeteer } from '../models/services.js'
import PlantingMessageBuilder from '../services/planting/PlantingMessageBuilder.js'
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
          reg: '^#(nc)?种植(.*?)(\\d+|全部)$',
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
          reg: '^#(nc)?铲除(\\d+|全部)$',
          fnc: 'shovelCrop'
        },
        {
          reg: '^#(nc)?收获$',
          fnc: 'harvestAllCrops'
        }
      ]
    })

    /**
     * 注意：Miao-Yunzai 当前的 `lib/plugins/plugin.js` 会将传入的 `task` 归一化为对象，
     * 若在 super(...) 里直接传数组会被覆盖，导致 loader 收集不到任务。
     * 因此这里在 super(...) 之后显式设置 `this.task`（支持数组，见 `lib/plugins/loader.js:594`）。
     */
    this.task = [
      {
        cron: '0 * * * * *', // 每分钟的第0秒执行
        name: '更新作物状态',
        fnc: () => this.updateCropsStatus()
      },
      {
        cron: '*/30 * * * * *', // 每30秒执行一次
        name: '处理护理调度',
        fnc: () => this.processCareSchedules()
      }
    ]

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
   * 验证玩家已注册，返回 userId 或 null
   * @param {Object} e 消息事件
   * @returns {Promise<string|null>} 已注册返回 userId，未注册返回 null
   */
  async _requirePlayer(e) {
    const userId = e.user_id;
    if (!(await this.playerService.isPlayer(userId))) {
      await e.reply('您未注册，请先"#nc注册"');
      return null;
    }
    return userId;
  }

  /**
   * 显示我的农场状态
   */
  async showMyFarm(e) {
    try {
      const userId = await this._requirePlayer(e);
      if (!userId) return true;

      const playerData = await this.playerService.getPlayer(userId)

      // 构建渲染数据并渲染图片
      const renderData = this._buildFarmRenderData(playerData, userId, true)
      await Puppeteer.renderVue('farm/index', renderData, { e, scale: 2.0 })
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
      const renderData = this._buildFarmRenderData(targetPlayerData, targetUserId, false)
      await Puppeteer.renderVue('farm/index', renderData, { e, scale: 2.0 })
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
   * @param {string} userId 用户ID
   * @param {boolean} isOwner 是否为农场主本人
   * @param {Object} operationResult 操作结果提示（可选）
   * @returns {Object} 渲染数据
   */
  _buildFarmRenderData(playerData, userId, isOwner = true, operationResult = null) {
    const cropsConfig = this.config.crops
    const now = Date.now()

    // 处理土地数据
    const lands = playerData.lands.map(land => {
      const quality = land.quality || 'normal'
      const isEmpty = !land.crop || land.status === 'empty'

      // 先计算实时成熟状态
      let isMature = land.status === 'mature'
      if (!isEmpty && !isMature && land.harvestTime) {
        isMature = land.harvestTime <= now
      }

      let landData = {
        id: land.id,
        quality,
        isEmpty,
        needsWater: land.needsWater || false,
        hasPests: land.hasPests || false,
        stealable: isMature,
        status: land.status || 'empty'
      }

      if (!isEmpty) {
        const cropConfig = cropsConfig[land.crop]
        landData.cropName = cropConfig?.name || land.crop
        landData.cropIcon = cropConfig?.icon || 'twemoji:seedling'

        // 计算健康度并分级
        // 计算生长进度
        if (isMature) {
          landData.growthPercent = 100
          landData.timeRemaining = '已成熟'
          landData.status = 'mature'
        } else if (land.harvestTime) {
          const remainingTime = land.harvestTime - now

          if (land.plantTime && land.harvestTime > land.plantTime) {
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

    // 计算经验百分比
    const levelReqs = this.config.levels.requirements
    const currentLevelExp = levelReqs[playerData.level]?.experience ?? 0
    const nextLevelExp = levelReqs[playerData.level + 1]?.experience
    const expPercent = nextLevelExp !== undefined
      ? Math.round(Math.min((playerData.experience - currentLevelExp) / (nextLevelExp - currentLevelExp) * 100, 100))
      : 100

    // 提取品质配置的星星颜色（普通土地不显示星星，跳过）
    const qualityColors = {}
    for (const [qualityKey, qualityConfig] of Object.entries(this.config.land.quality)) {
      if (qualityKey !== 'normal' && qualityConfig.color) {
        qualityColors[qualityKey] = qualityConfig.color
      }
    }

    const renderData = {
      isOwner,
      playerName: playerData.name,
      avatarUrl: `https://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640`,
      level: playerData.level,
      gold: playerData.gold,
      expPercent,
      landCount: playerData.lands.length,
      maxLandCount: playerData.maxLandCount || 24,
      lands,
      qualityColors
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
    const renderData = this._buildFarmRenderData(playerData, userId, true, operationResult)
    await Puppeteer.renderVue('farm/index', renderData, { e, scale: 2.0 })
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
   * 种植作物 - 统一处理单块种植和批量种植
   * 命令格式：#种植[作物名][土地号] | #种植[作物名]全部 | #种植全部
   */
  async plantCrop(e) {
    try {
      const match = e.msg.match(/^#(nc)?种植(.*?)(\d+|全部)$/);
      if (!match) {
        await e.reply('格式错误！使用: #种植[作物名][土地号] 或 #种植[作物名]全部');
        return true;
      }

      const cropName = match[2].trim();
      const target = match[3];
      const userId = await this._requirePlayer(e);
      if (!userId) return true;

      // 批量种植分支
      if (target === '全部') {
        const emptyLands = await this.getEmptyLands(userId);
        if (emptyLands.length === 0) {
          return e.reply('所有土地都已种植，没有空闲土地');
        }
        return cropName
          ? await this.plantSpecificCrop(userId, e, emptyLands, cropName)
          : await this.plantWithSmartSelection(userId, e, emptyLands);
      }

      // 单块种植分支
      const landId = parseInt(target);
      if (isNaN(landId) || landId <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }
      if (!cropName) {
        await e.reply('作物名称不能为空');
        return true;
      }

      const cropType = await this._parseCropType(cropName);
      if (!cropType) {
        e.reply(`未知的作物类型: ${cropName}，请检查名称是否正确`);
        return true;
      }

      const result = await this.plantingService.plantCrop(userId, landId, cropType);
      result.success
        ? await this._renderFarmWithResult(e, userId)
        : e.reply(result.message);
      return true;
    } catch (error) {
      logger.error('[农场游戏] 种植失败:', error);
      e.reply('种植失败，请稍后重试');
      return true;
    }
  }

  /**
   * 浇水
   */
  async waterCrop(e) {
    let userId = null;
    try {
      const match = e.msg.match(/^#(nc)?浇水(\d+|全部)$/);
      if (!match) {
        await e.reply('格式错误！使用: #浇水[土地编号] 或 #浇水全部');
        return true;
      }

      const landParam = match[2];
      userId = await this._requirePlayer(e);
      if (!userId) return true;

      if (landParam === '全部') {
        return await this.handleBatchCare(userId, e, 'water');
      }

      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      const result = await this.plantingService.waterCrop(userId, landIdNum)
      if (result.success) {
        const operationResult = PlantingMessageBuilder.buildRenderResult(result, 'water')
        await this._renderFarmWithResult(e, userId, operationResult)
      } else {
        await e.reply(result.message || '浇水失败，请稍后重试')
      }
      return true
    } catch (error) {
      logger.error('[农场游戏] 浇水失败:', error)
      await e.reply('浇水失败，请稍后重试')
      return true
    }
  }

  /**
   * 施肥
   */
  async fertilizeCrop(e) {
    let userId = null;
    try {
      const msg = e.msg.trim()

      // 仅输入 #施肥 时给出使用示例
      if (/^#(nc)?施肥$/i.test(msg)) {
        await e.reply('施肥示例：#施肥3普通肥料（指定地块），#施肥全部高速肥料（批量，可省略肥料名自动选择）');
        return true;
      }

      const match = msg.match(/^#(nc)?施肥(\d+|全部)(.+)?$/);
      if (!match) {
        await e.reply('格式错误！使用: #施肥[土地编号][肥料名可选] 或 #施肥全部[肥料名可选]');
        return true;
      }

      const landParam = match[2];
      const fertilizer = match[3];
      userId = await this._requirePlayer(e);
      if (!userId) return true;

      let fertilizerType = null;
      if (fertilizer) {
        fertilizerType = await this._parseFertilizerType(fertilizer.trim());
        if (!fertilizerType) {
          await e.reply(`未知的肥料类型："${fertilizer}"`);
          return true;
        }
      }

      if (landParam === '全部') {
        return await this.handleBatchCare(userId, e, 'fertilize', fertilizerType);
      }

      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      const result = await this.plantingService.fertilizeCrop(userId, landIdNum, fertilizerType);

      if (result.success) {
        const operationResult = PlantingMessageBuilder.buildRenderResult(result, 'fertilize')
        await this._renderFarmWithResult(e, userId, operationResult)
      } else {
        await e.reply(result.message || '施肥失败，请稍后重试');
      }
      return true;
    } catch (error) {
      logger.error('[农场游戏] 施肥失败:', error);
      await e.reply('施肥失败，请稍后重试');
      return true;
    }
  }

  /**
   * 除虫
   */
  async pesticideCrop(e) {
    let userId = null;
    try {
      const match = e.msg.match(/^#(nc)?除虫(\d+|全部)$/);
      if (!match) {
        await e.reply('格式错误！使用: #除虫[土地编号] 或 #除虫全部');
        return true;
      }

      const landParam = match[2];
      userId = await this._requirePlayer(e);
      if (!userId) return true;

      if (landParam === '全部') {
        return await this.handleBatchCare(userId, e, 'pesticide');
      }

      const landIdNum = parseInt(landParam);
      if (isNaN(landIdNum) || landIdNum <= 0) {
        await e.reply('土地编号必须为正整数');
        return true;
      }

      const result = await this.plantingService.treatPests(userId, landIdNum)

      if (result.success) {
        const operationResult = PlantingMessageBuilder.buildRenderResult(result, 'pesticide')
        await this._renderFarmWithResult(e, userId, operationResult)
      } else {
        await e.reply(result.message || '除虫失败，请稍后重试')
      }
      return true
    } catch (error) {
      logger.error('[农场游戏] 除虫失败:', error)
      await e.reply('除虫失败，请稍后重试')
      return true
    }
  }

  /**
   * 铲除作物（单块/全部）
   * 命令格式：#铲除[土地号] | #铲除全部
   */
  async shovelCrop(e) {
    try {
      const match = e.msg.match(/^#(nc)?铲除(\d+|全部)$/);
      if (!match) {
        await e.reply('格式错误！使用: #铲除[土地编号] 或 #铲除全部');
        return true;
      }

      const landParam = match[2];
      const userId = await this._requirePlayer(e);
      if (!userId) return true;

      let result;
      if (landParam === '全部') {
        result = await this.plantingService.clearCrop(userId);
      } else {
        const landIdNum = parseInt(landParam);
        if (isNaN(landIdNum) || landIdNum <= 0) {
          await e.reply('土地编号必须为正整数');
          return true;
        }
        result = await this.plantingService.clearCrop(userId, landIdNum);
      }

      if (!result?.success) {
        await e.reply(result?.message || '铲除失败，请稍后重试');
        return true;
      }

      const clearedCount = result?.data?.clearedCount ?? 0;
      const clearedLands = result?.data?.clearedLands ?? [];

      const operationResult = clearedCount > 0
        ? {
          type: 'success',
          icon: 'fa6-solid:shovel',
          title: '铲除完成',
          details: [
            `土地: ${clearedCount}块`,
            clearedLands.length ? `编号: ${clearedLands.join('、')}` : '作物已清理'
          ]
        }
        : {
          type: 'info',
          icon: 'lucide:info',
          title: '无需铲除',
          details: ['当前没有可铲除的作物']
        };

      await this._renderFarmWithResult(e, userId, operationResult);
      return true;
    } catch (error) {
      logger.error('[农场游戏] 铲除失败:', error);
      await e.reply('铲除失败，请稍后重试');
      return true;
    }
  }

  /**
   * 收获全部成熟作物
   */
  async harvestAllCrops(e) {
    try {
      const userId = await this._requirePlayer(e);
      if (!userId) return true;

      const result = await this.plantingService.harvestCrop(userId)

      if (result.success) {
        const operationResult = PlantingMessageBuilder.buildHarvestRenderResult(result)
        if (operationResult) {
          await this._renderFarmWithResult(e, userId, operationResult)
        }
        return true
      }

      await e.reply(result.message)
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
   * 处理护理调度（每30秒执行一次）
   * 检查并触发到期的护理需求（缺水/虫害）
   */
  async processCareSchedules() {
    try {
      const cropMonitorService = this.plantingService.cropMonitorService;
      if (!cropMonitorService) {
        logger.warn('[农场游戏] cropMonitorService 不可用，跳过护理调度处理');
        return;
      }

      // 先检查是否有待处理的调度（优化空闲轮询）
      const count = await cropMonitorService.getPendingCareScheduleCount();
      if (count === 0) {
        return; // 没有待处理的调度，静默返回
      }

      // 处理到期的护理调度
      const result = await cropMonitorService.processPendingCareSchedules();
      if (result?.triggeredCount > 0) {
        logger.info(`[农场游戏] 护理调度处理完成: 触发了${result.triggeredCount}个护理事件`);
      }
    } catch (error) {
      logger.error('[农场游戏] 处理护理调度失败:', error);
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
   * 统一的批量护理处理器
   * @param {string} userId 用户ID
   * @param {Object} e 消息事件
   * @param {string} careType 护理类型: 'water' | 'fertilize' | 'pesticide'
   * @param {string} itemType 物品类型（施肥/除虫需要，null时自动选择）
   */
  async handleBatchCare(userId, e, careType, itemType = null) {
    try {
      const cropsStatusResult = await this.plantingService.getPlayerCropsStatus(userId);
      if (!cropsStatusResult.success) {
        await e.reply('获取农场状态失败，请稍后重试');
        return true;
      }

      const filterMap = {
        water: crop => crop.needsWater,
        fertilize: crop => crop.status === 'growing',
        pesticide: crop => crop.hasPests
      };

      const emptyMsgMap = {
        water: '没有需要浇水的作物，您的农场很健康！',
        fertilize: '没有生长中的作物需要施肥！',
        pesticide: '没有发现害虫，您的作物很健康！'
      };

      const crops = cropsStatusResult.data?.crops || [];
      const filteredCrops = crops.filter(filterMap[careType]);

      if (filteredCrops.length === 0) {
        await e.reply(emptyMsgMap[careType]);
        return true;
      }

      // 施肥/除虫时，若未指定物品则通过 canCare 获取最佳可用物品
      let actualItemType = itemType;
      if (!actualItemType && careType !== 'water') {
        const canCareResult = await this.plantingService.canCare(userId, filteredCrops[0].landId, careType);
        if (!canCareResult.success || !canCareResult.requiredItem) {
          const noItemMsg = careType === 'fertilize' ? '没有可用的肥料' : '没有可用的杀虫剂';
          await e.reply(canCareResult.message || noItemMsg);
          return true;
        }
        actualItemType = canCareResult.requiredItem;
      }

      const targets = filteredCrops.map(crop => ({
        landId: crop.landId,
        action: careType,
        itemType: actualItemType
      }));

      const result = await this.plantingService.batchCareCrops(userId, targets);

      if (result.success) {
        const operationResult = PlantingMessageBuilder.buildRenderResult(result, careType)
        await this._renderFarmWithResult(e, userId, operationResult);
      } else {
        await e.reply(result.message || '批量操作失败，请稍后重试');
      }
      return true;
    } catch (error) {
      logger.error(`[农场游戏] 批量${careType}失败:`, error);
      await e.reply('批量操作失败，请稍后重试');
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
    // 收益率 = (作物价格 - 种子价格) / 种子价格
    const profitRatio = (cropConfig.price - seedConfig.price) / seedConfig.price;

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
          profitRatio: (cropConfig.price - seedConfig.price) / seedConfig.price,
          growTimeHours: cropConfig.growTime / 3600
        };
      }
    }

    return bestCrop;
  }

  /**
   * 智能选择作物进行批量种植（种完所有种子）
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

      const sortedCrops = this.getSortedAvailableCrops(seedInventory);

      if (sortedCrops.length === 0) {
        return e.reply('您没有任何种子可以种植！请先到商店购买种子。');
      }

      let remainingLands = [...emptyLands];
      let totalPlanted = 0;

      for (const crop of sortedCrops) {
        if (remainingLands.length === 0) break;

        const plantCount = Math.min(crop.inventory, remainingLands.length);
        const landIds = remainingLands.slice(0, plantCount);
        const results = await this.executeBatchPlanting(userId, landIds, crop.cropType);

        totalPlanted += results.successCount;
        remainingLands = remainingLands.slice(plantCount);
      }

      if (totalPlanted > 0) {
        await this._renderFarmWithResult(e, userId)
      } else {
        await e.reply('智能种植失败，请稍后重试')
      }
      return true;
    } catch (error) {
      logger.error('[农场游戏] 智能种植失败:', error);
      e.reply('智能种植失败，请稍后重试');
      return true;
    }
  }

  /**
   * 获取按评分排序的所有可用作物
   */
  getSortedAvailableCrops(seedInventory) {
    const cropsConfig = this.config.crops;
    const seedsConfig = this.config.items.seeds;
    const crops = [];

    for (const [cropType, cropConfig] of Object.entries(cropsConfig)) {
      const seedId = `${cropType}_seed`;
      const seedConfig = seedsConfig[seedId];
      if (!seedConfig) continue;

      const inventory = seedInventory[seedId] || 0;
      if (inventory <= 0) continue;

      const score = this.calculateCropScore(cropType, cropConfig, seedConfig, inventory);
      crops.push({ seedId, cropType, cropName: cropConfig.name, score, inventory });
    }

    return crops.sort((a, b) => b.score - a.score);
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

      if (results.successCount > 0) {
        await this._renderFarmWithResult(e, userId)
      } else {
        await e.reply('批量种植失败，请稍后重试')
      }
      return true;
    } catch (error) {
      logger.error('[农场游戏] 指定作物种植失败:', error);
      e.reply('指定作物种植失败，请稍后重试');
      return true;
    }
  }

  /**
   * 执行批量种植 - 使用事务API
   * @param {string} userId 用户ID
   * @param {Array} landIds 土地ID列表
   * @param {string} cropType 作物类型
   * @returns {Promise<Object>} 批量操作结果
   */
  async executeBatchPlanting(userId, landIds, cropType) {
    const plantingPlans = landIds.map(landId => ({ landId, cropType }));

    try {
      const result = await this.plantingService.batchPlantCrop(userId, plantingPlans);
      return {
        successCount: result.success ? result.results.length : 0,
        failCount: result.success ? 0 : landIds.length,
        results: result.success ? [] : [result.message]
      };
    } catch (error) {
      logger.error(`[农场游戏] 批量种植异常 [${userId}]:`, error);
      return { successCount: 0, failCount: landIds.length, results: ['系统异常'] };
    }
  }
}
