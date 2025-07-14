// apps/admin.js
import plugin from '../../../lib/plugins/plugin.js';
import serviceContainer from '../services/index.js';

export class adminApp extends plugin {
  constructor() {
    super({
      name: '农场管理',
      dsc: '农场游戏管理指令',
      event: 'message',
      priority: 400,
      rule: [
        {
          reg: '^#nc管理\s*(重置玩家|添加金币|添加经验|设置土地品质|统计|经济分析|重载配置|备份)(.*)$',
          fnc: 'handleAdmin'
        }
      ]
    });
  }

  async handleAdmin(e) {
    if (!e.isMaster) {
      await e.reply('抱歉，只有机器人主人才有权限执行此操作。');
      return true;
    }

    // 确保服务已初始化并获取服务实例
    await serviceContainer.init();
    const adminService = serviceContainer.getService('adminService');
    const statisticsService = serviceContainer.getService('statisticsService');

    const command = e.msg.replace(/#nc管理\s*/, '').trim();
    const [action, ...args] = command.split(/\s+/);
    
    switch (action) {
      case '重置玩家':
        await this.resetPlayer(e, args, adminService);
        break;
      case '添加金币':
      case '添加经验':
        await this.addResource(e, action, args, adminService);
        break;
      case '设置土地品质':
        await this.setLandQuality(e, args, adminService);
        break;
      case '统计':
      case '经济分析':
        await this.getStats(e, statisticsService);
        break;
      case '重载配置':
        await this.reloadConfig(e, adminService);
        break;
      case '备份':
        await e.reply('备份功能正在开发中...');
        break;
      default:
        await e.reply('未知的管理指令。');
        break;
    }
    return true;
  }

  async resetPlayer(e, args, adminService) {
    const targetId = e.at || (args[0] ? args[0].replace('@', '') : null);
    if (!targetId) {
      await e.reply('请指定要重置的玩家，例如：#nc管理 重置玩家 @张三');
      return;
    }
    const result = await adminService.resetPlayer(targetId);
    await e.reply(result.message);
  }

  async addResource(e, action, args, adminService) {
    const targetId = e.at;
    const amount = parseInt(args[0], 10);

    if (!targetId || isNaN(amount)) {
      await e.reply(`指令格式错误，请使用：#nc管理 ${action} @玩家 <数量>`);
      return;
    }

    const serviceMethod = action === '添加金币' ? 'addCoins' : 'addExperience';
    const result = await adminService[serviceMethod](targetId, amount);
    await e.reply(result.message);
  }

  async setLandQuality(e, args, adminService) {
    const targetId = e.at;
    const [landIdStr, quality] = args;
    const landId = parseInt(landIdStr, 10);

    if (!targetId || isNaN(landId) || !quality) {
      await e.reply('指令格式错误，请使用：#nc管理 设置土地品质 @玩家 <地号> <品质>');
      return;
    }
    const result = await adminService.setLandQuality(targetId, landId, quality);
    await e.reply(result.message);
  }

  async getStats(e, statisticsService) {
    await e.reply('正在生成经济分析报告，请稍候...');
    const stats = await statisticsService.getEconomyStatus();
    
    let message = `--- 农场经济分析报告 ---\n`;
    message += `数据来源: ${stats.fromCache ? '缓存' : '实时计算'}\n`;
    message += `更新时间: ${new Date(stats.updatedAt).toLocaleString()}\n`;
    message += `总玩家数: ${stats.totalPlayers}\n`;
    message += `总金币流通量: ${stats.totalCoins}\n`;
    message += `人均金币: ${stats.averageCoins}\n`;
    message += `总土地数: ${stats.totalLandCount}\n`;
    message += `人均土地: ${stats.averageLandCount}\n\n`;
    message += `--- 等级分布 ---\n`;

    const sortedLevels = Object.keys(stats.levelDistribution).sort((a, b) => parseInt(a) - parseInt(b));
    for (const level of sortedLevels) {
      message += `Lv.${level}: ${stats.levelDistribution[level]}人\n`;
    }

    await e.reply(message);
  }
  
  async reloadConfig(e, adminService) {
      // 使用AdminService的重载配置功能
      const result = await adminService.reloadConfigs();
      await e.reply(result.message);
  }
}
