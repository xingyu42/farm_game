import lodash from 'lodash'
import { Data, Puppeteer } from '../models/services.js'

/**
 * 农场游戏帮助系统 (Miao-Yunzai 插件)
 * 提供全面的游戏命令帮助和使用指南
 * 帮助系统命令处理器，使用图片渲染
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
          reg: '^#(nc|农场)帮助$',
          fnc: 'showHelp'
        }
      ]
    });
  }

  /**
   * 加载并合并帮助配置
   */
  async _prepareHelpData() {
    const { diyCfg, sysCfg   } = await Data.importConfig('help')
    const helpConfig = lodash.defaults(
      diyCfg.helpCfg || {},
      sysCfg.helpCfg || {}
    )
    const helpList = diyCfg.helpList || sysCfg.helpList

    const helpGroup = []
    for (const group of helpList) {
      if (group.auth && group.auth === 'master' && !this.e.isMaster) {
        continue
      }
      for (const help of group.list) {
        const icon = help.icon * 1
        if (!icon) {
          help.css = 'display:none'
        } else {
          const x = (icon - 1) % 10
          const y = (icon - x - 1) / 10
          help.css = `background-position:-${x * 50}px -${y * 50}px`
        }
      }
      helpGroup.push(group)
    }
    return { helpConfig, helpGroup }
  }

  /**
   * 显示帮助页面
   * @param {Object} e Miao-Yunzai事件对象
   */
  async showHelp(e) {
    try {
      const { helpConfig, helpGroup } = await this._prepareHelpData()

      const result = await Puppeteer.render('help/index', {
        helpCfg: helpConfig,
        helpGroup,
        colCount: helpConfig.columnCount || 3,
        isMaster: e.isMaster,
        style: helpConfig.style || {}
      }, {
        e,
        scale: 2.0
      })

      if (!result) {
        await e.reply('❌ 生成帮助图片失败，请稍后再试');
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`[农场帮助] 显示帮助失败: ${error.message}`);
      await e.reply('❌ 获取帮助信息失败，请稍后再试');
      return true;
    }
  }

}
