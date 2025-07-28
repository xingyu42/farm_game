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
          reg: '^#nc管理\\s*(重置玩家|添加金币|添加经验|设置土地品质|统计|经济分析|重载配置|备份)(.*)$',
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
    const globalStatsService = serviceContainer.getService('globalStatsService');

    const command = e.msg.replace(/#nc管理\\s*/, '').trim();
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
        await this.getStats(e, globalStatsService);
        break;
      case '重载配置':
        await this.reloadConfig(e, adminService);
        break;
      case '备份':
        await this.handleBackup(e, args);
        break;
      default:
        await e.reply('未知的管理指令。');
        break;
    }
    return true;
  }

  async resetPlayer(e, args, adminService) {
    const targetId = e.at;
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

  async getStats(e, globalStatsService) {
    await e.reply('正在生成经济分析报告，请稍候...');
    const stats = await globalStatsService.getEconomyStatus();

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

  async handleBackup(e, args) {
    const dataBackupService = serviceContainer.getService('dataBackupService');
    const subCommand = args[0] || 'execute';

    try {
      switch (subCommand) {
        case 'execute':
        case '执行':
          await e.reply('开始执行数据备份，请稍候...');
          {
            const backupResult = await dataBackupService.executeBackup();

            if (backupResult.success) {
              let message = `✅ 备份完成\n`;
              message += `文件名: ${backupResult.filename}\n`;
              message += `玩家数: ${backupResult.playerCount}\n`;
              message += `耗时: ${backupResult.duration}ms`;
              await e.reply(message);
            } else {
              await e.reply(`❌ 备份失败: ${backupResult.message || '未知错误'}`);
            }
            break;
          }

        case 'status':
        case '状态':
          {
            const status = dataBackupService.getStatus();
            let statusMessage = `📊 备份服务状态\n`;
            statusMessage += `运行状态: ${status.isRunning ? '✅ 运行中' : '❌ 已停止'}\n`;
            statusMessage += `备份间隔: ${Math.round(status.config.interval / 1000 / 60)}分钟\n`;
            statusMessage += `保留备份数: ${status.config.maxBackups}份\n`;

            if (status.nextBackupTime) {
              statusMessage += `下次备份: ${status.nextBackupTime.toLocaleString()}`;
            }

            await e.reply(statusMessage);
            break;
          }

        case 'history':
        case '历史':
          {
            const history = await dataBackupService.getBackupHistory();

            if (history.length === 0) {
              await e.reply('📋 暂无备份历史记录');
              return;
            }

            let historyMessage = `📋 备份历史记录 (最近${Math.min(history.length, 5)}份)\n`;
            const recentHistory = history.slice(0, 5);

            for (let i = 0; i < recentHistory.length; i++) {
              const backup = recentHistory[i];
              historyMessage += `${i + 1}. ${backup.filename}\n`;
              historyMessage += `   时间: ${backup.timestamp.toLocaleString()}\n`;
            }

            await e.reply(historyMessage);
            break;
          }

        default:
          {
            let helpMessage = `🔧 备份管理指令帮助\n\n`;
            helpMessage += `#nc管理 备份 [execute|执行] - 立即执行备份\n`;
            helpMessage += `#nc管理 备份 [status|状态] - 查看备份服务状态\n`;
            helpMessage += `#nc管理 备份 [history|历史] - 查看备份历史记录\n`;

            await e.reply(helpMessage);
            break;
          }
      }
    } catch (error) {
      logger.error(`[AdminApp] 备份操作失败: ${error.message}`);
      await e.reply(`❌ 备份操作失败: ${error.message}`);
    }
  }
}
