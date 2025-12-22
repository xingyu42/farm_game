/**
 * @fileoverview 插件更新应用层 - 插件版本更新和日志查询
 *
 * Input:
 * - ../../other/update.js - Yunzai 框架更新工具
 * - ../../../lib/plugins/plugin.js - Miao-Yunzai 插件基类
 *
 * Output:
 * - WerewolfUpdate (class) - 更新指令处理器,导出给 index.js 动态加载
 *
 * Pos: 应用层维护模块,处理插件更新指令 (#农场更新/#更新日志)
 */

/* eslint-disable import/no-unresolved */
import { update as Update } from '../../other/update.js'

export class WerewolfUpdate extends plugin {
  constructor () {
    super({
      name: '农场更新插件',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '^#*(强制)?(nc|农场)更新$',
          fnc: 'update'
        },
        {
          reg: '^#?(nc|农场)?更新日志$',
          fnc: 'update_log'
        }
      ]
    })
  }

  async update (e = this.e) {
    if (!e.isMaster) return e.reply('你没有权限更新农场插件')
    e.msg = `#${e.msg.includes('强制') ? '强制' : ''}更新farm_game`
    const up = new Update(e)
    up.e = e
    return up.update()
  }

  async update_log () {
    // eslint-disable-next-line new-cap
    let updatePlugin = new Update()
    updatePlugin.e = this.e
    updatePlugin.reply = this.reply

    let pluginName = 'farm_game'
    if (updatePlugin.getPlugin(pluginName)) {
      this.e.reply(await updatePlugin.getLog(pluginName))
    }
    return true
  }
}
