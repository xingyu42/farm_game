/**
 * @fileoverview 土地收益权应用层 - 出售/购买/分红/赎回/转售
 *
 * 指令（统一使用 #nc，兼容无前缀）：
 * - #nc出售土地 <价格> [分红率%]
 * - #nc土地市场 / #nc购买土地 <序号>
 * - #nc我的挂牌 / #nc取消出售 <序号>
 * - #nc我的持有 / #nc转售土地 <序号> / #nc取消转售 <序号>
 * - #nc转售市场 / #nc购买转售 <序号>
 * - #nc我的售出 / #nc赎回土地 <序号>
 */

import { Puppeteer } from '../models/services.js';

export class LandTradeCommands extends plugin {
  constructor(deps = {}) {
    super({
      name: '土地收益权',
      dsc: '土地收益权买卖与分红',
      event: 'message',
      priority: 100,
      rule: [
        { reg: '^#(nc)?出售土地\\s+(\\d+)(\\s+\\d+)?$', fnc: 'listLand' },
        { reg: '^#(nc)?取消出售(\\d+)$', fnc: 'cancelListing' },
        { reg: '^#(nc)?土地市场$', fnc: 'viewMarket' },
        { reg: '^#(nc)?购买土地(\\d+)$', fnc: 'buyLand' },
        { reg: '^#(nc)?我的挂牌$', fnc: 'myListings' },
        { reg: '^#(nc)?我的持有$', fnc: 'myHoldings' },
        { reg: '^#(nc)?我的售出$', fnc: 'mySold' },
        { reg: '^#(nc)?赎回土地(\\d+)$', fnc: 'redeemLand' },
        { reg: '^#(nc)?转售土地(\\d+)$', fnc: 'listResale' },
        { reg: '^#(nc)?取消转售(\\d+)$', fnc: 'cancelResale' },
        { reg: '^#(nc)?转售市场$', fnc: 'viewResaleMarket' },
        { reg: '^#(nc)?购买转售(\\d+)$', fnc: 'buyResale' }
      ]
    });

    this.landTradeService = deps.landTradeService;
    this.playerService = deps.playerService;
  }

  async _ensureServices() {
    if (this.landTradeService && this.playerService) return;
    const { default: serviceContainer } = await import('../services/index.js');
    this.landTradeService ??= serviceContainer.getService('landTradeService');
    this.playerService ??= serviceContainer.getService('playerService');
  }

  async _validatePlayer(e, userId) {
    if (!(await this.playerService.isPlayer(userId))) {
      await e.reply('您未注册，请先"#nc注册"');
      return false;
    }
    return true;
  }

  _limitList(list, limit = 10) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, Math.max(0, limit));
  }

  async _render(e, data) {
    const result = await Puppeteer.renderVue('land_trade/index', data, { e, scale: 2.0 });
    if (!result) {
      await e.reply('渲染失败，请稍后再试');
    }
    return result;
  }

  async listLand(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const match = e.msg.match(/^#(?:nc)?出售土地\s+(\d+)(?:\s+(\d+))?$/);
      if (!match) {
        await e.reply('用法：#nc出售土地 <价格> [分红率%]\n示例：#nc出售土地 50000 35');
        return true;
      }

      const price = parseInt(match[1], 10);
      const rate = match[2] ? parseInt(match[2], 10) : null;

      const result = await this.landTradeService.listLand(userId, price, rate);
      await e.reply(result?.message ?? 'ERROR');
      return true;
    } catch (error) {
      logger.error(`[LandTradeCommands] listLand failed: ${error.message}`);
      await e.reply('❌ 挂牌失败，请稍后再试');
      return true;
    }
  }

  async cancelListing(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const match = e.msg.match(/^#(?:nc)?取消出售(\d+)$/);
      const no = match ? parseInt(match[1], 10) : NaN;
      if (!Number.isInteger(no) || no <= 0) {
        await e.reply('用法：#nc取消出售 <我的挂牌序号>');
        return true;
      }

      const result = await this.landTradeService.cancelListing(userId, no);
      await e.reply(result?.message ?? 'ERROR');
      return true;
    } catch (error) {
      logger.error(`[LandTradeCommands] cancelListing failed: ${error.message}`);
      await e.reply('❌ 取消失败，请稍后再试');
      return true;
    }
  }

  async viewMarket(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();

      const listings = await this.landTradeService.getMarketListings();
      const player = await this.playerService.getPlayer(userId).catch(() => null);
      const playerCoins = player?.coins ?? 0;

      if (!listings || listings.length === 0) {
        return this._render(e, {
          playerCoins,
          currentTab: 'market',
          marketList: [],
          marketTotal: 0
        });
      }

      const show = this._limitList(listings, 10);
      const ownerIds = [...new Set(show.map(l => l.ownerId))];
      const owners = new Map();
      for (const oid of ownerIds) {
        const p = await this.playerService.getPlayer(oid).catch(() => null);
        if (p) owners.set(oid, p);
      }

      const marketList = show.map((l, i) => ({
        actionNo: i + 1,
        landId: l.landId,
        dividendRate: l.dividendRate,
        ownerName: owners.get(l.ownerId)?.name || l.ownerId,
        price: l.price
      }));

      return this._render(e, {
        playerCoins,
        currentTab: 'market',
        marketList,
        marketTotal: listings.length
      });
    } catch (error) {
      logger.error(`[LandTradeCommands] viewMarket failed: ${error.message}`);
      await e.reply('❌ 获取土地市场失败，请稍后再试');
      return true;
    }
  }

  async buyLand(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const match = e.msg.match(/^#(?:nc)?购买土地(\d+)$/);
      const no = match ? parseInt(match[1], 10) : NaN;
      if (!Number.isInteger(no) || no <= 0) {
        await e.reply('用法：#nc购买土地 <土地市场序号>');
        return true;
      }

      const result = await this.landTradeService.buyLand(userId, no);
      await e.reply(result?.message ?? 'ERROR');
      return true;
    } catch (error) {
      logger.error(`[LandTradeCommands] buyLand failed: ${error.message}`);
      await e.reply('❌ 购买失败，请稍后再试');
      return true;
    }
  }

  async myListings(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const list = await this.landTradeService.getMyListings(userId);
      const player = await this.playerService.getPlayer(userId).catch(() => null);
      const playerCoins = player?.coins ?? 0;

      const show = this._limitList(list || [], 15);
      const myListings = show.map((l, i) => ({
        actionNo: i + 1,
        landId: l.landId,
        dividendRate: l.dividendRate,
        price: l.price
      }));

      return this._render(e, {
        playerCoins,
        currentTab: 'listings',
        myListings,
        listingsTotal: list?.length ?? 0
      });
    } catch (error) {
      logger.error(`[LandTradeCommands] myListings failed: ${error.message}`);
      await e.reply('❌ 获取我的挂牌失败，请稍后再试');
      return true;
    }
  }

  async myHoldings(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const holdings = await this.landTradeService.getMyHoldings(userId);
      const player = await this.playerService.getPlayer(userId).catch(() => null);
      const playerCoins = player?.coins ?? 0;

      const show = this._limitList(holdings || [], 15);
      const myHoldings = [];

      for (let i = 0; i < show.length; i++) {
        const h = show[i];
        const owner = await this.playerService.getPlayer(h.ownerId).catch(() => null);
        const ownerName = owner?.name || h.ownerId;
        const land = owner?.lands?.find(l => Number(l?.id) === Number(h.landId));
        const sold = land?.trade?.sold;
        const resale = sold?.resale;

        myHoldings.push({
          actionNo: i + 1,
          landId: h.landId,
          dividendRate: sold?.dividendRate ?? '-',
          ownerName,
          totalDividend: sold?.totalDividend ?? 0,
          resaleStatus: resale?.isListed ? 'listed' : 'holding'
        });
      }

      return this._render(e, {
        playerCoins,
        currentTab: 'holdings',
        myHoldings,
        holdingsTotal: holdings?.length ?? 0
      });
    } catch (error) {
      logger.error(`[LandTradeCommands] myHoldings failed: ${error.message}`);
      await e.reply('❌ 获取我的持有失败，请稍后再试');
      return true;
    }
  }

  async mySold(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const list = await this.landTradeService.getMySoldLands(userId);
      const player = await this.playerService.getPlayer(userId).catch(() => null);
      const playerCoins = player?.coins ?? 0;

      const show = this._limitList(list || [], 15);
      const mySold = [];

      for (let i = 0; i < show.length; i++) {
        const s = show[i];
        const holder = await this.playerService.getPlayer(s.holderId).catch(() => null);
        const holderName = holder?.name || s.holderId;
        mySold.push({
          actionNo: i + 1,
          landId: s.landId,
          dividendRate: s.dividendRate,
          holderName,
          originalPrice: s.price
        });
      }

      return this._render(e, {
        playerCoins,
        currentTab: 'sold',
        mySold,
        soldTotal: list?.length ?? 0
      });
    } catch (error) {
      logger.error(`[LandTradeCommands] mySold failed: ${error.message}`);
      await e.reply('❌ 获取我的售出失败，请稍后再试');
      return true;
    }
  }

  async redeemLand(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const match = e.msg.match(/^#(?:nc)?赎回土地(\d+)$/);
      const no = match ? parseInt(match[1], 10) : NaN;
      if (!Number.isInteger(no) || no <= 0) {
        await e.reply('用法：#nc赎回土地 <我的售出序号>');
        return true;
      }

      const result = await this.landTradeService.redeemLand(userId, no);
      await e.reply(result?.message ?? 'ERROR');
      return true;
    } catch (error) {
      logger.error(`[LandTradeCommands] redeemLand failed: ${error.message}`);
      await e.reply('❌ 赎回失败，请稍后再试');
      return true;
    }
  }

  async listResale(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const match = e.msg.match(/^#(?:nc)?转售土地(\d+)$/);
      const no = match ? parseInt(match[1], 10) : NaN;
      if (!Number.isInteger(no) || no <= 0) {
        await e.reply('用法：#nc转售土地 <我的持有序号>');
        return true;
      }

      const result = await this.landTradeService.listResale(userId, no);
      await e.reply(result?.message ?? 'ERROR');
      return true;
    } catch (error) {
      logger.error(`[LandTradeCommands] listResale failed: ${error.message}`);
      await e.reply('❌ 转售挂牌失败，请稍后再试');
      return true;
    }
  }

  async cancelResale(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const match = e.msg.match(/^#(?:nc)?取消转售(\d+)$/);
      const no = match ? parseInt(match[1], 10) : NaN;
      if (!Number.isInteger(no) || no <= 0) {
        await e.reply('用法：#nc取消转售 <我的持有序号>');
        return true;
      }

      const result = await this.landTradeService.cancelResale(userId, no);
      await e.reply(result?.message ?? 'ERROR');
      return true;
    } catch (error) {
      logger.error(`[LandTradeCommands] cancelResale failed: ${error.message}`);
      await e.reply('❌ 取消转售失败，请稍后再试');
      return true;
    }
  }

  async viewResaleMarket(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();

      const listings = await this.landTradeService.getResaleMarketListings();
      const player = await this.playerService.getPlayer(userId).catch(() => null);
      const playerCoins = player?.coins ?? 0;

      if (!listings || listings.length === 0) {
        return this._render(e, {
          playerCoins,
          currentTab: 'resale',
          resaleList: [],
          resaleTotal: 0
        });
      }

      const show = this._limitList(listings, 10);
      const userIds = [...new Set(show.flatMap(l => [l.ownerId, l.holderId]))];
      const users = new Map();
      for (const uid of userIds) {
        const p = await this.playerService.getPlayer(uid).catch(() => null);
        if (p) users.set(uid, p);
      }

      const resaleList = show.map((l, i) => ({
        actionNo: i + 1,
        landId: l.landId,
        dividendRate: l.dividendRate,
        sellerName: users.get(l.holderId)?.name || l.holderId,
        price: l.price
      }));

      return this._render(e, {
        playerCoins,
        currentTab: 'resale',
        resaleList,
        resaleTotal: listings.length
      });
    } catch (error) {
      logger.error(`[LandTradeCommands] viewResaleMarket failed: ${error.message}`);
      await e.reply('❌ 获取转售市场失败，请稍后再试');
      return true;
    }
  }

  async buyResale(e) {
    try {
      await this._ensureServices();
      const userId = e.user_id.toString();
      if (!(await this._validatePlayer(e, userId))) return true;

      const match = e.msg.match(/^#(?:nc)?购买转售(\d+)$/);
      const no = match ? parseInt(match[1], 10) : NaN;
      if (!Number.isInteger(no) || no <= 0) {
        await e.reply('用法：#nc购买转售 <转售市场序号>');
        return true;
      }

      const result = await this.landTradeService.buyResale(userId, no);
      await e.reply(result?.message ?? 'ERROR');
      return true;
    } catch (error) {
      logger.error(`[LandTradeCommands] buyResale failed: ${error.message}`);
      await e.reply('❌ 购买转售失败，请稍后再试');
      return true;
    }
  }
}
