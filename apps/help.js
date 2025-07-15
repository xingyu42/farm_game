/**
 * 农场游戏帮助系统 (Miao-Yunzai 插件)
 * 提供全面的游戏命令帮助和使用指南
 */



// 使用全局logger，如果不存在则使用console
const logger = global.logger || console;

/**
 * 帮助系统命令处理器
 */
export class HelpCommands extends plugin {
  constructor() {
    super({
      name: '农场帮助',
      dsc: '农场游戏帮助系统',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#nc帮助$',
          fnc: 'showMainHelp'
        },
        {
          reg: '^#nc帮助\\s+(.+)$',
          fnc: 'showCategoryHelp'
        }
      ]
    });

    // 初始化帮助数据
    this.helpData = this._initializeHelpData();
  }

  /**
   * 显示主帮助页面
   * @param {Object} e Miao-Yunzai事件对象
   */
  async showMainHelp(e) {
    try {
      const isAdmin = e.isMaster;
      const helpMessage = this._buildMainHelpMessage(isAdmin);
      
      await e.reply(helpMessage);
      return true;
    } catch (error) {
      logger.error(`[HelpCommands] 显示主帮助失败: ${error.message}`);
      await e.reply('❌ 获取帮助信息失败，请稍后再试');
      return true;
    }
  }

  /**
   * 显示分类帮助页面
   * @param {Object} e Miao-Yunzai事件对象
   */
  async showCategoryHelp(e) {
    try {
      const match = e.msg.match(/^#nc帮助\s+(.+)$/);
      if (!match) {
        await e.reply('❌ 请指定要查看的帮助分类，例如：#nc帮助 农场管理');
        return true;
      }

      const category = match[1].trim();
      const isAdmin = e.isMaster;
      
      const helpMessage = this._buildCategoryHelpMessage(category, isAdmin);
      
      if (!helpMessage) {
        const availableCategories = this._getAvailableCategories(isAdmin);
        await e.reply(`❌ 未找到分类"${category}"\n\n可用分类：${availableCategories.join('、')}`);
        return true;
      }

      await e.reply(helpMessage);
      return true;
    } catch (error) {
      logger.error(`[HelpCommands] 显示分类帮助失败: ${error.message}`);
      await e.reply('❌ 获取帮助信息失败，请稍后再试');
      return true;
    }
  }

  /**
   * 初始化帮助数据
   * @returns {Object} 帮助数据配置
   * @private
   */
  _initializeHelpData() {
    return {
      basic: {
        name: '基础功能',
        icon: '👤',
        description: '玩家注册、信息查看、签到等基础操作',
        permission: 'user',
        commands: [
          {
            cmd: '#nc注册',
            aliases: ['#nc开始游戏', '#nc加入游戏'],
            desc: '注册成为农场玩家，开始游戏',
            params: '无',
            example: '#nc注册'
          },
          {
            cmd: '#nc我的信息',
            aliases: ['#nc信息', '#nc个人信息', '#nc玩家信息'],
            desc: '查看个人农场详细信息',
            params: '无',
            example: '#nc我的信息'
          },
          {
            cmd: '#nc签到',
            aliases: [],
            desc: '每日签到获取金币和经验奖励',
            params: '无',
            example: '#nc签到'
          }
        ]
      },
      farm: {
        name: '农场管理',
        icon: '🌾',
        description: '种植、浇水、施肥、收获等农场核心操作',
        permission: 'user',
        commands: [
          {
            cmd: '#nc我的农场',
            aliases: [],
            desc: '查看自己的农场状态和作物情况',
            params: '无',
            example: '#nc我的农场'
          },
          {
            cmd: '@用户名 #nc农场',
            aliases: [],
            desc: '查看其他玩家的农场状态',
            params: '@用户名',
            example: '@张三 #nc农场'
          },
          {
            cmd: '#nc种植',
            aliases: [],
            desc: '在指定土地种植作物',
            params: '[土地编号] [作物名称] 或 [作物名称] [土地编号]',
            example: '#nc种植 1 小麦'
          },
          {
            cmd: '#nc浇水',
            aliases: [],
            desc: '给指定土地的作物浇水，提升生长速度',
            params: '[土地编号]',
            example: '#nc浇水 1'
          },
          {
            cmd: '#nc施肥',
            aliases: [],
            desc: '给指定土地施肥，提升作物品质',
            params: '[土地编号]',
            example: '#nc施肥 1'
          },
          {
            cmd: '#nc除虫',
            aliases: [],
            desc: '给指定土地除虫，保护作物健康',
            params: '[土地编号]',
            example: '#nc除虫 1'
          },
          {
            cmd: '#nc收获',
            aliases: [],
            desc: '收获指定土地的成熟作物',
            params: '[土地编号]',
            example: '#nc收获 1'
          },
          {
            cmd: '#nc收获全部',
            aliases: [],
            desc: '一键收获所有成熟的作物',
            params: '无',
            example: '#nc收获全部'
          }
        ]
      },
      inventory: {
        name: '仓库管理',
        icon: '🎒',
        description: '查看仓库、物品锁定等仓库管理功能',
        permission: 'user',
        commands: [
          {
            cmd: '#nc仓库',
            aliases: [],
            desc: '查看仓库中的所有物品和容量',
            params: '无',
            example: '#nc仓库'
          },
          {
            cmd: '#nc锁定',
            aliases: [],
            desc: '锁定指定物品，防止误操作出售',
            params: '[物品名称]',
            example: '#nc锁定 小麦'
          },
          {
            cmd: '#nc解锁',
            aliases: [],
            desc: '解锁指定物品，允许出售',
            params: '[物品名称]',
            example: '#nc解锁 小麦'
          },
          {
            cmd: '#nc查看锁定',
            aliases: ['#nc锁定列表'],
            desc: '查看所有已锁定的物品',
            params: '无',
            example: '#nc查看锁定'
          }
        ]
      },
      shop: {
        name: '商店交易',
        icon: '🏪',
        description: '购买物品、出售作物、查看市场价格',
        permission: 'user',
        commands: [
          {
            cmd: '#nc商店',
            aliases: [],
            desc: '查看商店中可购买的物品',
            params: '无',
            example: '#nc商店'
          },
          {
            cmd: '#nc市场',
            aliases: [],
            desc: '查看市场价格信息',
            params: '无',
            example: '#nc市场'
          },
          {
            cmd: '#nc购买',
            aliases: [],
            desc: '购买指定物品',
            params: '[物品名称] [数量(可选)]',
            example: '#nc购买 小麦种子 10'
          },
          {
            cmd: '#nc出售',
            aliases: [],
            desc: '出售指定物品',
            params: '[物品名称] [数量(可选)]',
            example: '#nc出售 小麦 5'
          },
          {
            cmd: '#nc出售全部',
            aliases: [],
            desc: '出售所有可出售的作物',
            params: '无',
            example: '#nc出售全部'
          }
        ]
      },
      land: {
        name: '土地系统',
        icon: '🏞️',
        description: '土地扩张、品质升级、强化等土地管理',
        permission: 'user',
        commands: [
          {
            cmd: '#nc土地扩张',
            aliases: [],
            desc: '扩张新的土地，增加种植面积',
            params: '无',
            example: '#nc土地扩张'
          },
          {
            cmd: '#nc土地信息',
            aliases: [],
            desc: '查看所有土地的详细信息',
            params: '无',
            example: '#nc土地信息'
          },
          {
            cmd: '#nc土地进阶',
            aliases: [],
            desc: '提升指定土地的品质等级',
            params: '[土地编号]',
            example: '#nc土地进阶 1'
          },
          {
            cmd: '#nc土地品质',
            aliases: [],
            desc: '查看指定土地的品质信息',
            params: '[土地编号]',
            example: '#nc土地品质 1'
          },
          {
            cmd: '#nc强化土地',
            aliases: [],
            desc: '强化指定土地，提升产出效果',
            params: '[土地编号]',
            example: '#nc强化土地 1'
          }
        ]
      },
      steal: {
        name: '偷菜防御',
        icon: '🛡️',
        description: '偷菜、防护、狗粮使用等互动功能',
        permission: 'user',
        commands: [
          {
            cmd: '@用户名 #nc偷菜',
            aliases: [],
            desc: '偷取其他玩家农场的成熟作物',
            params: '@用户名',
            example: '@张三 #nc偷菜'
          },
          {
            cmd: '#nc使用狗粮',
            aliases: [],
            desc: '使用狗粮激活农场防护',
            params: '[狗粮类型(可选)]',
            example: '#nc使用狗粮 高级狗粮'
          },
          {
            cmd: '#nc防护状态',
            aliases: [],
            desc: '查看当前农场的防护状态',
            params: '无',
            example: '#nc防护状态'
          },
          {
            cmd: '#nc偷菜状态',
            aliases: [],
            desc: '查看偷菜冷却时间和相关状态',
            params: '无',
            example: '#nc偷菜状态'
          }
        ]
      },
      admin: {
        name: '管理功能',
        icon: '⚙️',
        description: '仅限机器人主人使用的管理命令',
        permission: 'admin',
        commands: [
          {
            cmd: '#nc管理 重置玩家',
            aliases: [],
            desc: '重置指定玩家的游戏数据',
            params: '@用户名',
            example: '#nc管理 重置玩家 @张三'
          },
          {
            cmd: '#nc管理 添加金币',
            aliases: [],
            desc: '给指定玩家添加金币',
            params: '@用户名 [数量]',
            example: '#nc管理 添加金币 @张三 1000'
          },
          {
            cmd: '#nc管理 添加经验',
            aliases: [],
            desc: '给指定玩家添加经验',
            params: '@用户名 [数量]',
            example: '#nc管理 添加经验 @张三 500'
          },
          {
            cmd: '#nc管理 设置土地品质',
            aliases: [],
            desc: '设置指定玩家的土地品质',
            params: '@用户名 [土地编号] [品质]',
            example: '#nc管理 设置土地品质 @张三 1 优质'
          },
          {
            cmd: '#nc管理 统计',
            aliases: ['#nc管理 经济分析'],
            desc: '查看游戏统计和经济分析数据',
            params: '无',
            example: '#nc管理 统计'
          },
          {
            cmd: '#nc管理 重载配置',
            aliases: [],
            desc: '重新加载游戏配置文件',
            params: '无',
            example: '#nc管理 重载配置'
          }
        ]
      }
    };
  }

  /**
   * 构建主帮助消息
   * @param {boolean} isAdmin 是否为管理员
   * @returns {string} 主帮助消息
   * @private
   */
  _buildMainHelpMessage(isAdmin) {
    const separator = '━━━━━━━━━━━━━━━━━━';
    let message = `📚 农场游戏帮助\n${separator}\n`;
    message += `🌾 欢迎来到农场世界！以下是可用的功能分类：\n\n`;

    // 遍历所有分类
    for (const categoryData of Object.values(this.helpData)) {
      // 检查权限
      if (categoryData.permission === 'admin' && !isAdmin) {
        continue;
      }

      message += `${categoryData.icon} ${categoryData.name}\n`;
      message += `   ${categoryData.description}\n`;
      message += `   💡 查看详情：#nc帮助 ${categoryData.name}\n\n`;
    }

    message += `${separator}\n`;
    message += `📖 使用说明：\n`;
    message += `• 发送 #nc帮助 [分类名] 查看具体命令\n`;
    message += `• 参数用 [] 表示，实际使用时不需要输入 []\n`;
    message += `• @用户名 表示需要@具体的用户\n\n`;
    message += `🎮 快速开始：\n`;
    message += `1. 发送 #nc注册 开始游戏\n`;
    message += `2. 发送 #nc我的农场 查看农场\n`;
    message += `3. 发送 #nc商店 购买种子\n`;
    message += `4. 发送 #nc种植 1 小麦 开始种植`;

    return message;
  }

  /**
   * 构建分类帮助消息
   * @param {string} categoryName 分类名称
   * @param {boolean} isAdmin 是否为管理员
   * @returns {string|null} 分类帮助消息，未找到时返回null
   * @private
   */
  _buildCategoryHelpMessage(categoryName, isAdmin) {
    // 查找匹配的分类
    const categoryData = this._findCategoryByName(categoryName);
    if (!categoryData) {
      return null;
    }

    // 检查权限
    if (categoryData.permission === 'admin' && !isAdmin) {
      return null;
    }

    const separator = '━━━━━━━━━━━━━━━━━━';
    let message = `${categoryData.icon} ${categoryData.name} - 帮助\n${separator}\n`;
    message += `📝 ${categoryData.description}\n\n`;

    // 遍历该分类下的所有命令
    for (const command of categoryData.commands) {
      message += `🔸 ${command.cmd}\n`;
      message += `   功能：${command.desc}\n`;
      message += `   参数：${command.params}\n`;
      message += `   示例：${command.example}\n`;

      // 如果有别名，显示别名
      if (command.aliases && command.aliases.length > 0) {
        message += `   别名：${command.aliases.join('、')}\n`;
      }

      message += `\n`;
    }

    message += `${separator}\n`;
    message += `💡 提示：\n`;
    message += `• 参数用 [] 表示，实际使用时不需要输入 []\n`;
    message += `• 发送 #nc帮助 返回主帮助页面`;

    return message;
  }

  /**
   * 根据名称查找分类
   * @param {string} categoryName 分类名称
   * @returns {Object|null} 分类数据，未找到时返回null
   * @private
   */
  _findCategoryByName(categoryName) {
    for (const categoryData of Object.values(this.helpData)) {
      if (categoryData.name === categoryName) {
        return categoryData;
      }
    }
    return null;
  }

  /**
   * 获取可用分类列表
   * @param {boolean} isAdmin 是否为管理员
   * @returns {Array} 可用分类名称数组
   * @private
   */
  _getAvailableCategories(isAdmin) {
    const categories = [];
    for (const categoryData of Object.values(this.helpData)) {
      if (categoryData.permission === 'admin' && !isAdmin) {
        continue;
      }
      categories.push(categoryData.name);
    }
    return categories;
  }
}
