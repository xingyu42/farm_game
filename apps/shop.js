/**
 * 商店功能命令处理器 (Miao-Yunzai 插件)
 * 处理玩家商店相关指令：查看商店、购买、出售、市场价格等
 */

// {{CHENGQI:
// Action: Created; Timestamp: 2025-06-30T12:22:31+08:00; Reason: Shrimp Task ID: #faf85478, implementing shop commands for T5;
// }}

import serviceContainer from '../services/index.js';
import { Puppeteer } from '../models/services.js';

export class ShopCommands extends plugin {
  constructor() {
    super({
      name: '农场商店',
      dsc: '农场游戏商店功能',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#(nc)?商店$',
          fnc: 'viewShop'
        },
        {
          reg: '^#(nc)?市场$',
          fnc: 'viewMarket'
        },
        {
          reg: '^#(nc)?购买(.+?)(\\d+)?$',
          fnc: 'buyItem'
        },
        {
          reg: '^#(nc)?出售全部$',
          fnc: 'sellAllCrops'
        },
        {
          reg: '^#(nc)?出售(.+?)(\\d+)?$',
          fnc: 'sellItem'
        },
        {
          reg: '^#(nc)?查看(.+)$',
          fnc: 'viewItemDetail'
        }
      ]
    });

    // 初始化服务
    this._initServices();
  }

  /**
   * 初始化服务容器中的所有服务
   * 集中管理服务依赖，提高代码可维护性
   */
  _initServices() {
    this.shopService = serviceContainer.getService('shopService');
    this.playerService = serviceContainer.getService('playerService');
    this.marketService = serviceContainer.getService('marketService');
  }

  /**
   * 查看商店
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewShop(e) {
    try {
      const userId = e.user_id.toString();

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')
      const playerData = await this.playerService.getPlayer(userId);

      // 获取商店商品
      const shopItems = await this.shopService.getShopItems();

      if (shopItems.length === 0) {
        await e.reply('🏪 商店暂时没有商品可供购买');
        return true;
      }

      // 构建渲染数据
      const renderData = this._buildShopRenderData(shopItems, playerData);

      // 使用 Puppeteer 渲染图片（Vue客户端渲染）
      const result = await Puppeteer.renderVue('shop/index', renderData, { e, scale: 2.0 });

      if (!result) {
        await e.reply('❌ 生成商店图片失败，请稍后再试');
        return false;
      }

      return true;

    } catch (error) {
      logger.error(`[ShopCommands] 查看商店失败: ${error.message}`);
      await e.reply('❌ 查看商店失败，请稍后再试');
      return true;
    }
  }

  /**
   * 构建商店渲染数据
   * @param {Array} shopItems 商店商品列表
   * @param {Object} playerData 玩家数据
   * @returns {Object} 渲染数据
   * @private
   */
  _buildShopRenderData(shopItems, playerData) {
    const categories = shopItems.map(cat => {
      const categoryKeyMap = {
        '种子': 'seeds', '肥料': 'fertilizer', '杀虫剂': 'pesticide',
        '防御': 'defense', '工具': 'tools', '材料': 'materials', '作物': 'crops'
      };
      const key = categoryKeyMap[cat.category] || 'unknown';

      const items = cat.items.map(item => {
        return {
          ...item,
          icon: this.shopService.config.getItemIcon(item.id),
          isLocked: playerData.level < (item.requiredLevel || 1)
        };
      });

      return {
        name: cat.category,
        key,
        items
      };
    });

    return {
      playerCoins: playerData.coins,
      playerLevel: playerData.level,
      categories
    };
  }

  /**
   * 查看市场价格（图片化）
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewMarket(e) {
    try {
      const userId = e.user_id.toString();

      // 获取玩家数据（用于显示金币）
      let playerCoins = 0;
      if (await this.playerService.isPlayer(userId)) {
        const playerData = await this.playerService.getPlayer(userId);
        playerCoins = playerData.coins || 0;
      }

      // 获取市场渲染数据
      const renderData = await this.marketService.getMarketRenderData(10);

      if (renderData.totalItems === 0) {
        await e.reply('📈 市场暂时没有动态价格商品\n💡 动态价格功能可能未启用或没有配置动态价格商品');
        return true;
      }

      // 获取更新时间
      const now = new Date();
      const updateTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      // 构建完整渲染数据
      const fullRenderData = {
        playerCoins,
        totalItems: renderData.totalItems,
        updateTime,
        topVolatileItems: renderData.topVolatileItems,
        otherItems: renderData.otherItems
      };

      // 使用 Puppeteer 渲染图片（Vue 客户端渲染）
      const result = await Puppeteer.renderVue('market/index', fullRenderData, { e, scale: 2.0 });

      if (!result) {
        await e.reply('❌ 生成市场图片失败，请稍后再试');
        return false;
      }

      return true;

    } catch (error) {
      logger.error(`[ShopCommands] 查看市场失败: ${error.message}`);
      await e.reply('❌ 查看市场失败，请稍后再试');
      return true;
    }
  }

  /**
   * 购买物品
   * @param {Object} e Miao-Yunzai事件对象
   */
  async buyItem(e) {
    try {
      const userId = e.user_id.toString();
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 14:36:57 +08:00; Reason: Shrimp Task ID: #db7410e1, upgrading to numbered capture groups for consistency with rule patterns; Principle_Applied: RegexPattern-Modernization;}}
      const match = e.msg.match(/^#(nc)?购买(.+?)(\d+)?$/);

      if (!match) {
        await e.reply('❌ 格式错误！使用: #nc购买[物品名][数量]');
        return true;
      }

      const itemName = match[2].trim();
      const quantity = parseInt(match[3]) || 1;

      if (quantity <= 0) {
        await e.reply('❌ 购买数量必须大于0');
        return true;
      }

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 执行购买
      const result = await this.shopService.buyItem(userId, itemName, quantity);

      if (result.success) {
        await e.reply(`✅ ${result.message}\n💰 剩余金币: ${result.remainingCoins}\n🎒 仓库使用: ${result.inventoryUsage}`);
      } else {
        await e.reply(`❌ ${result.message}`);
      }

      return true;

    } catch (error) {
      logger.error(`[ShopCommands] 购买物品失败: ${error.message}`);
      await e.reply('❌ 购买失败，请稍后再试');
      return true;
    }
  }

  /**
   * 出售物品
   * @param {Object} e Miao-Yunzai事件对象
   */
  async sellItem(e) {
    try {
      const userId = e.user_id.toString();
      // {{CHENGQI: Action: Modified; Timestamp: 2025-07-01 14:36:57 +08:00; Reason: Shrimp Task ID: #db7410e1, upgrading to numbered capture groups for consistency with rule patterns; Principle_Applied: RegexPattern-Modernization;}}
      const match = e.msg.match(/^#(nc)?出售(.+?)(\d+)?$/);

      if (!match) {
        await e.reply('❌ 格式错误！使用: #nc出售[物品名][数量]');
        return true;
      }

      const itemName = match[2].trim();
      const quantity = parseInt(match[3]) || 1;

      if (quantity <= 0) {
        await e.reply('❌ 出售数量必须大于0');
        return true;
      }

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 执行出售
      const result = await this.shopService.sellItem(userId, itemName, quantity);

      if (result.success) {
        const remainingText = result.remainingItems > 0 ? `\n📦 剩余数量: ${result.remainingItems}` : '';
        await e.reply(`✅ ${result.message}${remainingText}\n💰 当前金币: ${result.remainingCoins}`);
      } else {
        await e.reply(`❌ ${result.message}`);
      }

      return true;

    } catch (error) {
      logger.error(`[ShopCommands] 出售物品失败: ${error.message}`);
      await e.reply('❌ 出售失败，请稍后再试');
      return true;
    }
  }

  /**
   * 出售全部作物
   * @param {Object} e Miao-Yunzai事件对象
   */
  async sellAllCrops(e) {
    try {
      const userId = e.user_id.toString();

      // 确保玩家存在
      if (!(await this.playerService.isPlayer(userId))) return e.reply('您未注册，请先"#nc注册"')

      // 执行批量出售
      const result = await this.shopService.sellAllCrops(userId);

      if (result.success) {
        let message = `✅ ${result.message}\n`;
        message += '📦 出售详情:\n';

        // 使用 soldDetails 而不是 items
        for (const item of result.soldDetails) {
          message += `   ${item.itemName} x${item.quantity} = ${item.totalValue}金币\n`;
        }

        message += `💰 总收入: ${result.totalValue}金币`;

        await e.reply(message);
      } else {
        await e.reply(`❌ ${result.message}`);
      }

      return true;

    } catch (error) {
      logger.error(`[ShopCommands] 批量出售失败: ${error.message}`);
      await e.reply('❌ 批量出售失败，请稍后再试');
      return true;
    }
  }

  /**
   * 查看物品详情
   * @param {Object} e Miao-Yunzai事件对象
   */
  async viewItemDetail(e) {
    try {
      const match = e.msg.match(/^#(nc)?查看(.+)$/);
      if (!match) {
        await e.reply('❌ 格式错误！使用: #nc查看[物品名]');
        return true;
      }

      const itemName = match[2].trim();
      const itemResolver = this.shopService.itemResolver;

      // 查找物品ID
      const itemId = itemResolver.findItemByName(itemName);
      if (!itemId) {
        await e.reply(`❌ 找不到物品「${itemName}」，请检查名称是否正确`);
        return true;
      }

      // 获取物品完整配置
      const itemConfig = itemResolver.findItemById(itemId);
      if (!itemConfig) {
        await e.reply(`❌ 物品「${itemName}」配置异常`);
        return true;
      }

      // 构建渲染数据
      const renderData = this._buildItemDetailRenderData(itemId, itemConfig);

      // 渲染图片（Vue 客户端渲染）
      const result = await Puppeteer.renderVue('item-detail/index', renderData, { e, scale: 2.0 });

      if (!result) {
        await e.reply('❌ 生成物品详情图片失败，请稍后再试');
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`[ShopCommands] 查看物品详情失败: ${error.message}`);
      await e.reply('❌ 查看物品详情失败，请稍后再试');
      return true;
    }
  }

  /**
   * 构建物品详情渲染数据
   * @param {string} itemId 物品ID
   * @param {Object} itemConfig 物品配置
   * @returns {Object} 渲染数据
   * @private
   */
  _buildItemDetailRenderData(itemId, itemConfig) {
    const categoryNameMap = {
      seeds: '种子', fertilizer: '肥料', pesticide: '杀虫剂',
      defense: '防御', tools: '工具', materials: '材料', crops: '作物'
    };

    // 基础物品数据
    const item = {
      icon: this.shopService.config.getItemIcon(itemId),
      name: itemConfig.name,
      category: itemConfig.category,
      categoryName: categoryNameMap[itemConfig.category] || itemConfig.category,
      description: itemConfig.description || '暂无描述',
      price: itemConfig.price ?? 0,
      requiredLevel: itemConfig.requiredLevel ?? 1,
      maxStack: itemConfig.maxStack ?? 99,
      effects: []
    };

    // 根据物品类型构建效果列表
    this._buildItemEffects(item, itemConfig);

    // 构建关联作物信息（仅种子）
    let linkedCrop = null;
    if (itemConfig.category === 'seeds') {
      linkedCrop = this._buildLinkedCropInfo(itemId);
    }

    return { item, linkedCrop };
  }

  /**
   * 构建物品效果列表（配置驱动）
   * @param {Object} item 物品渲染数据
   * @param {Object} itemConfig 物品配置
   * @private
   */
  _buildItemEffects(item, itemConfig) {
    const mappings = this.shopService.config.items?.effectMappings;
    if (!mappings) return;

    for (const [path, mapping] of Object.entries(mappings)) {
      const value = this._getValueByPath(itemConfig, path);
      if (value === undefined || value === null) continue;

      const formatted = this._formatEffectValue(value, mapping);
      if (formatted !== null) {
        item.effects.push({ label: mapping.label, value: formatted });
      }
    }
  }

  /**
   * 根据路径获取对象值
   * @param {Object} obj 对象
   * @param {string} path 路径 (如 "effect.speedBonus")
   * @returns {*} 值
   * @private
   */
  _getValueByPath(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  /**
   * 格式化效果值
   * @param {*} value 原始值
   * @param {Object} mapping 映射配置
   * @returns {string|null} 格式化后的字符串
   * @private
   */
  _formatEffectValue(value, mapping) {
    const { format, trueValue } = mapping;

    switch (format) {
      case 'percent':
        return `${Math.round(value * 100)}%`;
      case 'percent_raw':
        return `${value}%`;
      case 'plus_percent':
        return `+${value}%`;
      case 'minus_percent':
        return `-${value}%`;
      case 'plus':
        return `+${value}`;
      case 'minutes':
        return `${value}分钟`;
      case 'time_seconds':
        return this._formatGrowTime(value);
      case 'number':
        return `${value}`;
      case 'xp':
        return `${value} XP`;
      case 'boolean':
        return value ? (trueValue || '是') : null;
      default:
        return `${value}`;
    }
  }

  /**
   * 构建关联作物信息（种子专用）
   * @param {string} seedId 种子ID
   * @returns {Object|null} 作物信息
   * @private
   */
  _buildLinkedCropInfo(seedId) {
    // 种子ID格式: xxx_seed -> 作物ID: xxx
    const cropId = seedId.replace(/_seed$/, '');
    const cropsConfig = this.shopService.config.crops;

    if (!cropsConfig || !cropsConfig[cropId]) return null;

    const crop = cropsConfig[cropId];
    return {
      icon: crop.icon || '🌱',
      name: crop.name,
      growTime: this._formatGrowTime(crop.growTime),
      baseYield: crop.baseYield,
      experience: crop.experience,
      description: crop.description || ''
    };
  }

  /**
   * 格式化生长时间
   * @param {number} seconds 秒数
   * @returns {string} 格式化字符串
   * @private
   */
  _formatGrowTime(seconds) {
    if (!seconds) return '未知';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0 && minutes > 0) return `${hours}时${minutes}分`;
    if (hours > 0) return `${hours}小时`;
    return `${minutes}分钟`;
  }
}