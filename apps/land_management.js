/**
 * @fileoverview 土地管理应用层 - 土地扩张、品质升级
 *
 * Input:
 * - ../services/index.js - ServiceContainer (获取 LandService, PlayerService)
 * - ../../../lib/plugins/plugin.js - Miao-Yunzai 插件基类
 *
 * Output:
 * - LandManagementCommands (class) - 土地管理指令处理器,导出给 index.js 动态加载
 *
 * Pos: 应用层土地模块,处理土地操作指令 (#土地扩张/#土地升级)
 */

export class LandManagementCommands extends plugin {
  constructor(deps = {}) {
    super({
      name: "农场土地管理",
      dsc: "农场游戏土地扩张和管理功能",
      event: "message",
      priority: 100,
      rule: [
        { reg: "^#(nc)?土地扩张$", fnc: "expandLand" },
        { reg: "^#(nc)?土地升级.*$", fnc: "upgradeLandQuality" }
      ]
    });

    // allow dependency injection for tests
    this.landService = deps.landService;
    this.playerService = deps.playerService;
  }

  async _ensureServices() {
    if (this.landService && this.playerService) return;

    const { default: serviceContainer } = await import("../services/index.js");
    this.landService ??= serviceContainer.getService("landService");
    this.playerService ??= serviceContainer.getService("playerService");
  }

  /**
   * 验证玩家是否已注册
   * @param {Object} e 事件对象
   * @param {string} userId 用户ID
   * @returns {Promise<boolean>} true=已注册, false=未注册（已回复用户）
   */
  async _validatePlayer(e, userId) {
    if (!(await this.playerService.isPlayer(userId))) {
      await e.reply("您未注册，请先\"#nc注册\"");
      return false;
    }
    return true;
  }

  async expandLand(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();

      if (!(await this._validatePlayer(e, userId))) return true;

      const result = await this.landService.expandLand(userId);
      if (result?.success) {
        const message = [
          String(result.message),
          "土地：" + result.landNumber,
          "花费：" + result.costGold,
          "剩余金币：" + result.remainingCoins
        ].join("\n");
        await e.reply(message);
      } else {
        await e.reply(result?.message ?? "ERROR");
      }

      return true;
    } catch (error) {
      logger.error("[LandManagementCommands] expandLand failed: " + error.message);
      await e.reply("ERROR");
      return true;
    }
  }

  async upgradeLandQuality(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();

      const match = e.msg.match(/^#(?:nc)?土地升级\s*(.*)$/);
      const qualityName = match?.[1]?.trim();

      if (!qualityName) {
        await e.reply("用法：#土地升级<品质名>\n例如：#土地升级红土地");
        return true;
      }

      if (!(await this._validatePlayer(e, userId))) return true;

      // 调用服务层方法（封装了所有业务逻辑）
      const result = await this.landService.upgradeLandByQualityName(userId, qualityName);
      await e.reply(result?.message ?? "ERROR");
      return true;
    } catch (error) {
      logger.error("[LandManagementCommands] upgradeLandQuality failed: " + error.message);
      await e.reply("ERROR");
      return true;
    }
  }
}
