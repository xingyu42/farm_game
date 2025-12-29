/**
 * @fileoverview 农场主排行榜指令 - #农场主排行榜
 *
 * Input:
 * - ../services/index.js - serviceContainer (服务容器)
 * - ../models/services.js - Puppeteer (图片渲染)
 *
 * Output:
 * - ranking (class) - 排行榜指令处理类
 *
 * Pos: 应用层,处理 #农场主排行榜 指令
 *
 * 指令:
 * - #农场主排行榜 / #nc农场主排行榜
 * - #农场主排行榜10 / #农场主排行榜 10（自定义条数1-50）
 */

import { Puppeteer } from '../models/services.js';

export class ranking extends plugin {
  constructor(deps = {}) {
    super({
      name: '农场主排行榜',
      dsc: '综合评分排行榜',
      event: 'message',
      priority: 200,
      rule: [
        { reg: '^#(nc)?农场主排行榜(\\d+)?$', fnc: 'showFarmOwnerRanking' }
      ]
    });

    this.rankingService = deps.rankingService;
  }

  async _ensureServices() {
    if (this.rankingService) return;
    const { default: serviceContainer } = await import('../services/index.js');
    this.rankingService ??= serviceContainer.getService('rankingService');
  }

  _parseLimit(msg) {
    const m = String(msg ?? '').match(/农场主排行榜\s*(\d+)?$/);
    const limit = m && m[1] ? parseInt(m[1], 10) : 10;
    if (!Number.isFinite(limit)) return 10;
    return Math.min(Math.max(limit, 1), 50);
  }

  async showFarmOwnerRanking(e) {
    try {
      await this._ensureServices();

      const userId = e.user_id != null ? String(e.user_id) : null;
      const limit = this._parseLimit(e.msg);

      const data = await this.rankingService.getFarmOwnerRanking({ limit, userId });

      if (!data.list || data.list.length === 0) {
        await e.reply('暂无排行榜数据');
        return true;
      }

      const renderData = {
        ranking: data.list.map(p => ({
          rank: p.rank,
          name: p.name,
          level: p.level,
          landCount: p.landCount,
          qualityCounts: p.qualityCounts,
          coins: p.coins,
          heldValue: p.heldLandRightsValue,
          totalAssets: p.totalAssets,
          score: Math.round(p.score)
        })),
        self: data.self ? {
          rank: data.self.rank,
          name: data.self.name,
          level: data.self.level,
          landCount: data.self.landCount,
          qualityCounts: data.self.qualityCounts,
          coins: data.self.coins,
          heldValue: data.self.heldLandRightsValue,
          totalAssets: data.self.totalAssets,
          score: Math.round(data.self.score)
        } : null,
        selfInList: data.self ? data.list.some(p => p.userId === data.self.userId) : false,
        totalPlayers: data.totalPlayers,
        updatedAt: data.updatedAt
      };

      const result = await Puppeteer.renderVue('ranking/index', renderData, { e, scale: 2.0 });

      if (!result) {
        await e.reply('渲染排行榜失败，请稍后再试');
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`[ranking] showFarmOwnerRanking failed: ${error?.message ?? String(error)}`);
      await e.reply('获取排行榜失败，请稍后再试');
      return true;
    }
  }
}
