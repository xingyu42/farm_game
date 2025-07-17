import serviceContainer from '../services/index.js'
import Config from '../models/Config.js'

/**
 * 偷菜与防御功能模块
 * 处理偷菜、使用狗粮、查看防护状态等功能
 */
export class steal extends plugin {
  constructor() {
    super({
      name: '偷菜与防御',
      dsc: '偷菜、使用狗粮、查看防护状态等功能',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#(nc)?偷菜$',
          fnc: 'stealCrop'
        },
        {
          reg: '^#(nc)?使用狗粮(?:\\s+(.+))?$',
          fnc: 'useDogFood'
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
   * 偷菜功能
   * @param {Object} e 消息事件对象
   */
  async stealCrop(e) {
    try {
      // 1. 提取被@用户的QQ号
      const targetUserId = e.at
      const thiefUserId = e.user_id

      // 2. 确保服务已初始化
      await this._ensureServicesInitialized()

      const playerService = serviceContainer.getService('playerService')
      const stealService = serviceContainer.getService('stealService')

      // 3. 确保偷菜者已注册
      await playerService.ensurePlayer(thiefUserId)

      // 4. 检查目标玩家是否存在（不自动创建）
      const targetPlayerData = await playerService.getDataService().getPlayerFromHash(targetUserId)
      if (!targetPlayerData) {
        e.reply('该用户还没有开始游戏哦~')
        return true
      }

      // 5. 执行偷菜操作
      const result = await stealService.executeSteal(thiefUserId, targetUserId)

      // 6. 构建回复消息
      let replyMessage = this._buildStealResultMessage(result)

      e.reply(replyMessage)
      return true
    } catch (error) {
      logger.error('[偷菜与防御] 偷菜失败:', error)

      // 根据错误类型提供友好的错误信息
      let errorMessage = '偷菜失败，请稍后重试'
      if (error.message.includes('冷却')) {
        errorMessage = error.message
      } else if (error.message.includes('保护')) {
        errorMessage = error.message
      } else if (error.message.includes('不能偷窃自己')) {
        errorMessage = '不能偷窃自己的农场哦~'
      } else if (error.message.includes('没有可偷取')) {
        errorMessage = '该农场暂无可偷取的成熟作物'
      }

      e.reply(errorMessage)
      return true
    }
  }

  /**
   * 使用狗粮功能
   * @param {Object} e 消息事件对象
   */
  async useDogFood(e) {
    try {
      const match = e.msg.match(/^#(nc)?使用狗粮(?:\s+(.+))?$/)
      if (!match) {
        e.reply('❌ 格式错误！使用: #使用狗粮 [狗粮类型]')
        return true
      }

      const dogFoodType = match[2]
      const userId = e.user_id

      await this._ensureServicesInitialized()
      const playerService = serviceContainer.getService('playerService')
      const protectionService = serviceContainer.getService('protectionService')
      const inventoryService = serviceContainer.getService('inventoryService')

      // 确保玩家已注册
      await playerService.ensurePlayer(userId)

      // 解析狗粮类型（如果未指定，自动选择最好的）
      let dogFoodId = null
      if (dogFoodType) {
        dogFoodId = await this._parseDogFoodType(dogFoodType.trim())
        if (!dogFoodId) {
          e.reply(`❌ 未知的狗粮类型："${dogFoodType}"\n可用狗粮：普通狗粮、高级狗粮、优质狗粮`)
          return true
        }
      } else {
        // 自动选择最好的可用狗粮
        dogFoodId = await this._selectBestAvailableDogFood(userId)
        if (!dogFoodId) {
          e.reply('❌ 仓库中没有可用的狗粮，请先购买')
          return true
        }
      }

      // 验证库存
      const hasItem = await inventoryService.hasItem(userId, dogFoodId, 1)
      if (!hasItem) {
        e.reply('❌ 狗粮数量不足，请先购买')
        return true
      }

      // 应用防护效果
      const result = await protectionService.applyDogFood(userId, dogFoodId)

      // 消费物品
      await inventoryService.removeItem(userId, dogFoodId, 1)

      const message = [
        `🛡️ 防护激活成功！`,
        `━━━━━━━━━━━━━━━━━━`,
        `使用物品：${result.itemName}`,
        `防御加成：+${result.defenseBonus}%`,
        `持续时间：${result.durationMinutes}分钟`,
        `━━━━━━━━━━━━━━━━━━`,
        `💡 防护状态可通过 #防护状态 查看`
      ]

      e.reply(message.join('\n'))
      return true
    } catch (error) {
      logger.error('[偷菜与防御] 使用狗粮失败:', error)
      e.reply('使用狗粮失败，请稍后重试')
      return true
    }
  }

  /**
   * 构建偷菜结果消息
   * @param {Object} result 偷菜结果
   * @returns {string} 消息文本
   * @private
   */
  _buildStealResultMessage(result) {
    let message = ''

    if (result.success) {
      message += `🎉 偷菜成功！\n`
      message += `成功率: ${result.successRate}%\n`

      if (result.rewards && result.rewards.length > 0) {
        message += `获得奖励:\n`
        result.rewards.forEach(reward => {
          message += `${reward.cropName} x${reward.quantity}\n`
        })
        message += `总共偷得: ${result.totalStolen} 个作物`
      }
    } else {
      message += `😅 偷菜失败！\n`
      message += `成功率: ${result.successRate}%\n`

      if (result.penalty > 0) {
        message += `被罚款: ${result.penalty} 金币`
      }
    }

    return message
  }

  /**
   * 解析狗粮类型
   * @param {string} dogFoodName 狗粮名称
   * @returns {string|null} 狗粮ID或null
   * @private
   */
  async _parseDogFoodType(dogFoodName) {
    const itemsConfig = this.config?.items?.dogFood || {}

    // 直接匹配ID
    if (itemsConfig[dogFoodName]) {
      return dogFoodName
    }

    // 匹配中文名称
    for (const [dogFoodId, config] of Object.entries(itemsConfig)) {
      if (config.name === dogFoodName ||
        (config.aliases && config.aliases.includes(dogFoodName))) {
        return dogFoodId
      }
    }

    return null
  }

  /**
   * 选择最好的可用狗粮
   * @param {string} userId 用户ID
   * @returns {string|null} 狗粮ID或null
   * @private
   */
  async _selectBestAvailableDogFood(userId) {
    try {
      await this._ensureServicesInitialized()
      const inventoryService = serviceContainer.getService('inventoryService')
      const inventory = await inventoryService.getInventory(userId)

      // 按防御加成排序的狗粮优先级
      const dogFoodPriority = ['deluxe', 'premium', 'normal']

      for (const dogFoodId of dogFoodPriority) {
        if (inventory[dogFoodId] && inventory[dogFoodId].quantity > 0) {
          return dogFoodId
        }
      }

      return null
    } catch (error) {
      logger.error('[偷菜与防御] 选择最好狗粮失败:', error)
      return null
    }
  }




}