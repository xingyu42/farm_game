/**
 * @fileoverview 土地收益权交易服务 - 挂牌/购买/分红/赎回/转售
 *
 * 核心规则（与 Docs/market/土地收益权系统设计.md 一致）：
 * - 一块地一块地卖，不拆分份额
 * - 挂牌时设置分红率（20%-50%），成交后锁定
 * - 地主出售作物时触发分红：saleAmount / 地主总地数 × 分红率（整数取整，尾差归地主）
 * - 地主可按原价赎回；持有人可按原价转售，手续费直接销毁
 * - 市场为全局共享（跨群），不做分区
 */

import crypto from 'node:crypto';
import { FileStorage } from '../../utils/fileStorage.js';
import { playerYamlStorage } from '../../utils/playerYamlStorage.js';
import EconomyService from './EconomyService.js';

const MARKET_FILENAME = 'land_trade.json';
const MARKET_LOCK_KEY = 'farm_game:land_trade:market:global';

function _now() {
  return Date.now();
}

function _toInt(value) {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num)) return NaN;
  return Math.trunc(num);
}

function _sortByTimeThenId(a, b) {
  const ta = Number(a?.listTime || 0);
  const tb = Number(b?.listTime || 0);
  if (ta !== tb) return ta - tb;
  const ida = String(a?.id || '');
  const idb = String(b?.id || '');
  return ida.localeCompare(idb);
}

export default class LandTradeService {
  constructor(redisClient, config, playerService) {
    this.redis = redisClient;
    this.config = config;
    this.playerService = playerService;
    this.storage = new FileStorage('data/market');
  }

  // =========================
  // Public APIs
  // =========================

  /**
   * 挂牌出售土地（系统自动选地：按 landId 升序选择第一块 owned）
   * @param {string} ownerId
   * @param {number} price 金币（整数）
   * @param {number|string|null} dividendRateInput 分红率（整数百分比 20-50）
   */
  async listLand(ownerId, price, dividendRateInput = null) {
    const priceInt = _toInt(price);
    if (!Number.isInteger(priceInt) || priceInt <= 0) {
      return { success: false, message: '价格必须是大于0的整数金币' };
    }

    const { minPercent, maxPercent, defaultPercent } = this._getDividendRateBounds();
    const dividendPercent = this._normalizePercent(dividendRateInput, { minPercent, maxPercent, defaultPercent });
    if (!dividendPercent.ok) {
      return { success: false, message: dividendPercent.message };
    }

    return await this.redis.withUserLocks([ownerId, MARKET_LOCK_KEY], async () => {
      const owner = await this.playerService.getPlayer(ownerId);
      if (!owner) return { success: false, message: '玩家不存在' };

      const land = this._selectFirstOwnedLand(owner);
      if (!land) {
        return { success: false, message: '没有可出售的土地（需要至少有1块自持且未挂牌/未售出的土地）' };
      }

      const trade = this._ensureTrade(land);
      if (trade.status !== 'owned') {
        return { success: false, message: '该土地当前不可挂牌（已挂牌/已售出）' };
      }

      const listingId = this._generateId('L');
      const listTime = _now();

      trade.status = 'listed';
      trade.listing = {
        id: listingId,
        price: priceInt,
        dividendRate: dividendPercent.value,
        listTime
      };

      // 防御性清理：避免旧字段残留
      trade.sold = null;

      owner.lastUpdated = _now();
      await this.playerService.dataService.savePlayer(ownerId, owner);

      const market = await this._loadMarketData();
      market.listings = Array.isArray(market.listings) ? market.listings : [];
      // 去重：同一(ownerId, landId)只允许一个挂牌
      market.listings = market.listings.filter(l => !(l.ownerId === ownerId && Number(l.landId) === Number(land.id)));
      market.listings.push({
        id: listingId,
        ownerId,
        landId: land.id,
        price: priceInt,
        dividendRate: dividendPercent.value,
        listTime
      });

      await this._saveMarketData(market);

      return {
        success: true,
        message: `挂牌成功：土地${land.id}，价格${priceInt}金币，分红率${dividendPercent.value}%`,
        listingId,
        landId: land.id,
        price: priceInt,
        dividendRate: dividendPercent.value
      };
    }, 'land_trade_list', 30);
  }

  /**
   * 取消挂牌（按“我的挂牌”列表序号）
   */
  async cancelListing(ownerId, marketNo) {
    const no = _toInt(marketNo);
    if (!Number.isInteger(no) || no <= 0) return { success: false, message: '序号必须是正整数' };

    return await this.redis.withUserLocks([ownerId, MARKET_LOCK_KEY], async () => {
      const market = await this._loadMarketData();
      const mine = this._getMyListings(market, ownerId);
      const target = mine[no - 1];
      if (!target) return { success: false, message: '序号无效，请先刷新 #nc我的挂牌' };

      const owner = await this.playerService.getPlayer(ownerId);
      if (!owner) return { success: false, message: '玩家不存在' };

      const land = this._getLandById(owner, target.landId);
      if (!land) return { success: false, message: '土地不存在或数据异常' };

      const trade = this._ensureTrade(land);
      if (trade.status !== 'listed' || trade.listing?.id !== target.id) {
        // 市场索引与玩家数据不一致：以玩家数据为准，提示刷新
        return { success: false, message: '挂牌状态已变化，请先刷新 #nc我的挂牌' };
      }

      trade.status = 'owned';
      trade.listing = null;

      owner.lastUpdated = _now();
      await this.playerService.dataService.savePlayer(ownerId, owner);

      market.listings = (Array.isArray(market.listings) ? market.listings : []).filter(l => l.id !== target.id);
      await this._saveMarketData(market);

      return {
        success: true,
        message: `已取消挂牌：土地${land.id}`,
        listingId: target.id,
        landId: land.id
      };
    }, 'land_trade_cancel', 30);
  }

  /**
   * 购买土地（按“土地市场”序号）
   */
  async buyLand(buyerId, marketNo) {
    const no = _toInt(marketNo);
    if (!Number.isInteger(no) || no <= 0) return { success: false, message: '序号必须是正整数' };

    // 先读取市场快照定位 ownerId（不加锁），事务内二次校验
    const market = await this._loadMarketData();
    const sorted = this._getMarketListings(market);
    const target = sorted[no - 1];
    if (!target) return { success: false, message: '序号无效，请先刷新 #nc土地市场' };

    const ownerId = target.ownerId;
    if (!ownerId) return { success: false, message: '挂牌数据异常，请稍后重试' };
    if (ownerId === buyerId) return { success: false, message: '不能购买自己的土地收益权' };

    return await this.redis.withUserLocks([buyerId, ownerId, MARKET_LOCK_KEY], async () => {
      // 二次校验：确保市场未变化
      const market2 = await this._loadMarketData();
      const sorted2 = this._getMarketListings(market2);
      const target2 = sorted2[no - 1];
      if (!target2 || target2.id !== target.id) {
        return { success: false, message: '市场列表已变化，请先刷新 #nc土地市场' };
      }

      const buyer = await this.playerService.getPlayer(buyerId);
      if (!buyer) return { success: false, message: '买家不存在' };
      const owner = await this.playerService.getPlayer(ownerId);
      if (!owner) return { success: false, message: '地主不存在' };

      const land = this._getLandById(owner, target2.landId);
      if (!land) return { success: false, message: '土地不存在或数据异常' };

      const trade = this._ensureTrade(land);
      if (trade.status !== 'listed' || trade.listing?.id !== target2.id) {
        return { success: false, message: '挂牌已失效，请先刷新 #nc土地市场' };
      }

      const price = _toInt(trade.listing.price);
      if (!Number.isInteger(price) || price <= 0) return { success: false, message: '挂牌价格数据异常' };

      if (buyer.coins < price) {
        return { success: false, message: `金币不足：需要${price}金币，当前${buyer.coins}` };
      }

      // 扣款与转账（严格整数）
      EconomyService.updateCoinsInTransaction(buyer, -price);
      EconomyService.updateCoinsInTransaction(owner, price);

      // 状态变更：listed -> sold
      trade.status = 'sold';
      trade.sold = {
        holderId: buyerId,
        price,
        dividendRate: this._normalizePercent(trade.listing.dividendRate, { minPercent: 0, maxPercent: 100, defaultPercent: 0 }).value,
        soldTime: _now(),
        totalDividend: 0,
        resale: {
          isListed: false,
          id: null,
          listTime: null
        }
      };
      trade.listing = null;

      owner.lastUpdated = _now();
      buyer.lastUpdated = _now();

      await this.playerService.dataService.savePlayer(ownerId, owner);
      await this.playerService.dataService.savePlayer(buyerId, buyer);

      // 更新市场：移除挂牌、写入持有索引
      market2.listings = (Array.isArray(market2.listings) ? market2.listings : []).filter(l => l.id !== target2.id);
      market2.holdingsIndex = typeof market2.holdingsIndex === 'object' && market2.holdingsIndex ? market2.holdingsIndex : {};
      const list = Array.isArray(market2.holdingsIndex[buyerId]) ? market2.holdingsIndex[buyerId] : [];
      const exists = list.some(h => h.ownerId === ownerId && Number(h.landId) === Number(land.id));
      if (!exists) list.push({ ownerId, landId: land.id });
      market2.holdingsIndex[buyerId] = list;

      await this._saveMarketData(market2);

      return {
        success: true,
        message: `购买成功：土地${land.id}（地主:${owner.name || ownerId}），价格${price}金币，分红率${trade.sold.dividendRate}%`,
        listingId: target2.id,
        ownerId,
        landId: land.id,
        price,
        dividendRate: trade.sold.dividendRate
      };
    }, 'land_trade_buy', 30);
  }

  /**
   * 地主赎回土地（按“我的售出”序号）
   */
  async redeemLand(ownerId, soldNo) {
    const no = _toInt(soldNo);
    if (!Number.isInteger(no) || no <= 0) return { success: false, message: '序号必须是正整数' };

    // 先读取地主快照定位 holderId（不加锁），事务内二次校验
    const rawOwner = await playerYamlStorage.readPlayer(ownerId, null).catch(() => null);
    if (!rawOwner) return { success: false, message: '玩家不存在' };

    const soldList = this._getMySoldLands(rawOwner);
    const target = soldList[no - 1];
    if (!target) return { success: false, message: '序号无效，请先刷新 #nc我的售出' };

    const landId = target.landId;
    const holderId = target.holderId;
    if (!holderId) return { success: false, message: '售出数据异常，请先刷新 #nc我的售出' };

    return await this.redis.withUserLocks([ownerId, holderId, MARKET_LOCK_KEY], async () => {
      const owner = await this.playerService.getPlayer(ownerId);
      if (!owner) return { success: false, message: '玩家不存在' };

      const soldList2 = this._getMySoldLands(owner);
      const target2 = soldList2[no - 1];
      if (!target2 || Number(target2.landId) !== Number(landId) || target2.holderId !== holderId) {
        return { success: false, message: '列表已变化，请先刷新 #nc我的售出' };
      }

      const holder = await this.playerService.getPlayer(holderId);
      if (!holder) return { success: false, message: '持有人不存在' };

      const land = this._getLandById(owner, landId);
      if (!land) return { success: false, message: '土地不存在或数据异常' };

      const trade = this._ensureTrade(land);
      if (trade.status !== 'sold' || trade.sold?.holderId !== holderId) {
        return { success: false, message: '售出状态已变化，请先刷新 #nc我的售出' };
      }

      const redeemPrice = _toInt(trade.sold.price);
      if (!Number.isInteger(redeemPrice) || redeemPrice <= 0) {
        return { success: false, message: '赎回价格数据异常' };
      }

      if (owner.coins < redeemPrice) {
        return { success: false, message: `金币不足：需要${redeemPrice}金币，当前${owner.coins}` };
      }

      // 转账
      EconomyService.updateCoinsInTransaction(owner, -redeemPrice);
      EconomyService.updateCoinsInTransaction(holder, redeemPrice);

      // 清理状态
      const resaleId = trade.sold?.resale?.id;
      trade.status = 'owned';
      trade.sold = null;
      trade.listing = null;

      owner.lastUpdated = _now();
      holder.lastUpdated = _now();

      await this.playerService.dataService.savePlayer(ownerId, owner);
      await this.playerService.dataService.savePlayer(holderId, holder);

      const market = await this._loadMarketData();
      // 移除持有索引
      market.holdingsIndex = typeof market.holdingsIndex === 'object' && market.holdingsIndex ? market.holdingsIndex : {};
      const list = Array.isArray(market.holdingsIndex[holderId]) ? market.holdingsIndex[holderId] : [];
      market.holdingsIndex[holderId] = list.filter(h => !(h.ownerId === ownerId && Number(h.landId) === Number(landId)));
      if (market.holdingsIndex[holderId].length === 0) delete market.holdingsIndex[holderId];

      // 若存在转售挂牌，移除
      if (resaleId) {
        market.resaleListings = (Array.isArray(market.resaleListings) ? market.resaleListings : []).filter(r => r.id !== resaleId);
      } else {
        market.resaleListings = (Array.isArray(market.resaleListings) ? market.resaleListings : []).filter(r => !(r.ownerId === ownerId && Number(r.landId) === Number(landId)));
      }

      await this._saveMarketData(market);

      return {
        success: true,
        message: `赎回成功：土地${landId}，支付${redeemPrice}金币给持有人`,
        landId,
        holderId,
        price: redeemPrice
      };
    }, 'land_trade_redeem', 30);
  }

  /**
   * 持有人挂牌转售（按“我的持有”序号）
   */
  async listResale(holderId, holdingNo) {
    const no = _toInt(holdingNo);
    if (!Number.isInteger(no) || no <= 0) return { success: false, message: '序号必须是正整数' };

    // 先读取持有快照定位 ownerId（不加锁），事务内二次校验
    const market = await this._loadMarketData();
    const holdingsSorted = await this._getHoldingsSorted(market, holderId);
    const target = holdingsSorted[no - 1];
    if (!target) return { success: false, message: '序号无效，请先刷新 #nc我的持有' };

    const ownerId = target.ownerId;
    const landId = target.landId;

    return await this.redis.withUserLocks([holderId, ownerId, MARKET_LOCK_KEY], async () => {
      const market2 = await this._loadMarketData();
      const holdingsSorted2 = await this._getHoldingsSorted(market2, holderId);
      const target2 = holdingsSorted2[no - 1];
      if (!target2 || target2.ownerId !== ownerId || Number(target2.landId) !== Number(landId)) {
        return { success: false, message: '列表已变化，请先刷新 #nc我的持有' };
      }

      const owner = await this.playerService.getPlayer(ownerId);
      if (!owner) return { success: false, message: '地主不存在' };

      const land = this._getLandById(owner, landId);
      if (!land) return { success: false, message: '土地不存在或数据异常' };

      const trade = this._ensureTrade(land);
      if (trade.status !== 'sold' || trade.sold?.holderId !== holderId) {
        return { success: false, message: '持有关系已变化，请先刷新 #nc我的持有' };
      }

      if (trade.sold?.resale?.isListed) {
        return { success: false, message: '该土地已在转售市场挂牌' };
      }

      const resaleId = this._generateId('R');
      const listTime = _now();

      trade.sold.resale = {
        isListed: true,
        id: resaleId,
        listTime
      };

      owner.lastUpdated = _now();
      await this.playerService.dataService.savePlayer(ownerId, owner);

      market2.resaleListings = Array.isArray(market2.resaleListings) ? market2.resaleListings : [];
      market2.resaleListings = market2.resaleListings.filter(r => !(r.ownerId === ownerId && Number(r.landId) === Number(landId)));
      market2.resaleListings.push({
        id: resaleId,
        ownerId,
        landId,
        holderId,
        price: _toInt(trade.sold.price),
        dividendRate: this._normalizePercent(trade.sold.dividendRate, { minPercent: 0, maxPercent: 100, defaultPercent: 0 }).value,
        listTime
      });

      await this._saveMarketData(market2);

      return {
        success: true,
        message: `转售挂牌成功：土地${landId}（原价${trade.sold.price}金币，分红率${trade.sold.dividendRate}%）`,
        resaleId,
        ownerId,
        landId,
        price: _toInt(trade.sold.price),
        dividendRate: trade.sold.dividendRate
      };
    }, 'land_trade_resale_list', 30);
  }

  /**
   * 取消转售挂牌（按“我的持有”序号）
   */
  async cancelResale(holderId, holdingNo) {
    const no = _toInt(holdingNo);
    if (!Number.isInteger(no) || no <= 0) return { success: false, message: '序号必须是正整数' };

    const market = await this._loadMarketData();
    const holdingsSorted = await this._getHoldingsSorted(market, holderId);
    const target = holdingsSorted[no - 1];
    if (!target) return { success: false, message: '序号无效，请先刷新 #nc我的持有' };

    const ownerId = target.ownerId;
    const landId = target.landId;

    return await this.redis.withUserLocks([holderId, ownerId, MARKET_LOCK_KEY], async () => {
      const market2 = await this._loadMarketData();
      const holdingsSorted2 = await this._getHoldingsSorted(market2, holderId);
      const target2 = holdingsSorted2[no - 1];
      if (!target2 || target2.ownerId !== ownerId || Number(target2.landId) !== Number(landId)) {
        return { success: false, message: '列表已变化，请先刷新 #nc我的持有' };
      }

      const owner = await this.playerService.getPlayer(ownerId);
      if (!owner) return { success: false, message: '地主不存在' };

      const land = this._getLandById(owner, landId);
      if (!land) return { success: false, message: '土地不存在或数据异常' };

      const trade = this._ensureTrade(land);
      if (trade.status !== 'sold' || trade.sold?.holderId !== holderId) {
        return { success: false, message: '持有关系已变化，请先刷新 #nc我的持有' };
      }

      if (!trade.sold?.resale?.isListed) {
        return { success: false, message: '该土地当前未转售挂牌' };
      }

      const resaleId = trade.sold.resale.id;
      trade.sold.resale = { isListed: false, id: null, listTime: null };

      owner.lastUpdated = _now();
      await this.playerService.dataService.savePlayer(ownerId, owner);

      market2.resaleListings = (Array.isArray(market2.resaleListings) ? market2.resaleListings : []).filter(r => r.id !== resaleId);
      await this._saveMarketData(market2);

      return {
        success: true,
        message: `已取消转售：土地${landId}`,
        resaleId,
        ownerId,
        landId
      };
    }, 'land_trade_resale_cancel', 30);
  }

  /**
   * 购买转售土地（按“转售市场”序号）
   */
  async buyResale(buyerId, resaleMarketNo) {
    const no = _toInt(resaleMarketNo);
    if (!Number.isInteger(no) || no <= 0) return { success: false, message: '序号必须是正整数' };

    // 先读取转售市场快照定位 ownerId/sellerId（不加锁），事务内二次校验
    const market = await this._loadMarketData();
    const sorted = this._getResaleMarketListings(market);
    const target = sorted[no - 1];
    if (!target) return { success: false, message: '序号无效，请先刷新 #nc转售市场' };

    const ownerId = target.ownerId;
    const sellerId = target.holderId;

    if (buyerId === ownerId) return { success: false, message: '地主不能购买自己土地的转售收益权' };
    if (buyerId === sellerId) return { success: false, message: '不能购买自己挂牌的转售' };

    return await this.redis.withUserLocks([buyerId, sellerId, ownerId, MARKET_LOCK_KEY], async () => {
      const market2 = await this._loadMarketData();
      const sorted2 = this._getResaleMarketListings(market2);
      const target2 = sorted2[no - 1];
      if (!target2 || target2.id !== target.id) {
        return { success: false, message: '转售市场列表已变化，请先刷新 #nc转售市场' };
      }

      const buyer = await this.playerService.getPlayer(buyerId);
      if (!buyer) return { success: false, message: '买家不存在' };
      const seller = await this.playerService.getPlayer(sellerId);
      if (!seller) return { success: false, message: '卖家不存在' };
      const owner = await this.playerService.getPlayer(ownerId);
      if (!owner) return { success: false, message: '地主不存在' };

      const land = this._getLandById(owner, target2.landId);
      if (!land) return { success: false, message: '土地不存在或数据异常' };

      const trade = this._ensureTrade(land);
      if (trade.status !== 'sold' || trade.sold?.holderId !== sellerId) {
        return { success: false, message: '该转售已失效，请先刷新 #nc转售市场' };
      }
      if (!trade.sold?.resale?.isListed || trade.sold?.resale?.id !== target2.id) {
        return { success: false, message: '该转售已失效，请先刷新 #nc转售市场' };
      }

      const price = _toInt(trade.sold.price);
      if (!Number.isInteger(price) || price <= 0) return { success: false, message: '转售价格数据异常' };

      if (buyer.coins < price) {
        return { success: false, message: `金币不足：需要${price}金币，当前${buyer.coins}` };
      }

      const feeRate = this._getResaleFeeRate();
      const fee = Math.floor(price * feeRate);
      const sellerIncome = Math.max(0, price - fee);

      EconomyService.updateCoinsInTransaction(buyer, -price);
      EconomyService.updateCoinsInTransaction(seller, sellerIncome);
      // 手续费 fee 直接销毁

      trade.sold.holderId = buyerId;
      trade.sold.resale = { isListed: false, id: null, listTime: null };

      owner.lastUpdated = _now();
      buyer.lastUpdated = _now();
      seller.lastUpdated = _now();

      await this.playerService.dataService.savePlayer(ownerId, owner);
      await this.playerService.dataService.savePlayer(buyerId, buyer);
      await this.playerService.dataService.savePlayer(sellerId, seller);

      // 更新市场索引
      market2.resaleListings = (Array.isArray(market2.resaleListings) ? market2.resaleListings : []).filter(r => r.id !== target2.id);
      market2.holdingsIndex = typeof market2.holdingsIndex === 'object' && market2.holdingsIndex ? market2.holdingsIndex : {};

      // 卖家移除
      const sellerList = Array.isArray(market2.holdingsIndex[sellerId]) ? market2.holdingsIndex[sellerId] : [];
      market2.holdingsIndex[sellerId] = sellerList.filter(h => !(h.ownerId === ownerId && Number(h.landId) === Number(land.id)));
      if (market2.holdingsIndex[sellerId].length === 0) delete market2.holdingsIndex[sellerId];

      // 买家加入
      const buyerList = Array.isArray(market2.holdingsIndex[buyerId]) ? market2.holdingsIndex[buyerId] : [];
      const exists = buyerList.some(h => h.ownerId === ownerId && Number(h.landId) === Number(land.id));
      if (!exists) buyerList.push({ ownerId, landId: land.id });
      market2.holdingsIndex[buyerId] = buyerList;

      await this._saveMarketData(market2);

      return {
        success: true,
        message: `购买转售成功：土地${land.id}，支付${price}金币（手续费${fee}销毁），你将继承分红率${trade.sold.dividendRate}%`,
        resaleId: target2.id,
        ownerId,
        landId: land.id,
        price,
        fee,
        dividendRate: trade.sold.dividendRate
      };
    }, 'land_trade_resale_buy', 30);
  }

  /**
   * 发放分红（地主出售作物时调用）
   * @param {string} ownerId 地主ID
   * @param {number} saleAmount 本次卖作物结算收入（整数金币）
   */
  async distributeDividend(ownerId, saleAmount) {
    const amount = _toInt(saleAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return { success: true, totalDividend: 0, payouts: {}, message: '本次收益为0，不触发分红' };
    }

    return await this._distributeDividendWithRetry(ownerId, amount, 0);
  }

  // ===== 查询 =====

  async getMarketListings() {
    const market = await this._loadMarketData();
    return this._getMarketListings(market);
  }

  async getResaleMarketListings() {
    const market = await this._loadMarketData();
    return this._getResaleMarketListings(market);
  }

  async getMyListings(ownerId) {
    const market = await this._loadMarketData();
    return this._getMyListings(market, ownerId);
  }

  async getMyHoldings(holderId) {
    const market = await this._loadMarketData();
    const holdings = await this._getOrRebuildHoldings(market, holderId);
    // 展示层常用：按 ownerId/landId 稳定排序
    return [...holdings].sort((a, b) => {
      const ao = String(a.ownerId || '');
      const bo = String(b.ownerId || '');
      if (ao !== bo) return ao.localeCompare(bo);
      return Number(a.landId || 0) - Number(b.landId || 0);
    });
  }

  async getMySoldLands(ownerId) {
    const owner = await this.playerService.getPlayer(ownerId);
    if (!owner) return [];
    return this._getMySoldLands(owner);
  }

  // =========================
  // Internal helpers
  // =========================

  _generateId(prefix) {
    return `${prefix}_${_now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  }

  _getDividendRateBounds() {
    const d = this.config?.land_trade?.dividend || {};
    const minPercent = this._normalizePercent(d.min_rate, { minPercent: 0, maxPercent: 100, defaultPercent: 20 }).value ?? 20;
    const maxPercent = this._normalizePercent(d.max_rate, { minPercent: 0, maxPercent: 100, defaultPercent: 50 }).value ?? 50;
    const defaultPercent = this._normalizePercent(d.default_rate, { minPercent, maxPercent, defaultPercent: 30 }).value ?? 30;
    return { minPercent, maxPercent, defaultPercent };
  }

  _getResaleFeeRate() {
    const feeRate = Number(this.config?.land_trade?.resale?.fee_rate ?? 0.05);
    if (!Number.isFinite(feeRate) || feeRate < 0) return 0.05;
    if (feeRate > 1) return Math.max(0, Math.min(1, feeRate / 100));
    return Math.max(0, Math.min(1, feeRate));
  }

  _normalizePercent(input, { minPercent, maxPercent, defaultPercent }) {
    if (input === undefined || input === null || input === '') {
      return { ok: true, value: defaultPercent };
    }

    let raw = input;
    if (typeof raw === 'string') {
      const s = raw.trim().replace('%', '');
      raw = s === '' ? NaN : Number(s);
    }

    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return { ok: false, message: '分红率格式错误（请输入整数百分比，示例：40）' };
    }

    if (!Number.isInteger(raw)) {
      return { ok: false, message: '分红率格式错误（请输入整数百分比，示例：40）' };
    }
    const percent = raw;

    if (percent < minPercent || percent > maxPercent) {
      return { ok: false, message: `分红率必须在 ${minPercent}% - ${maxPercent}% 之间` };
    }

    return { ok: true, value: percent };
  }

  _ensureTrade(land) {
    if (!land || typeof land !== 'object') return { status: 'owned' };
    if (!land.trade || typeof land.trade !== 'object') {
      land.trade = { status: 'owned', listing: null, sold: null };
    }
    if (!land.trade.status) land.trade.status = 'owned';
    if (!Object.prototype.hasOwnProperty.call(land.trade, 'listing')) land.trade.listing = null;
    if (!Object.prototype.hasOwnProperty.call(land.trade, 'sold')) land.trade.sold = null;
    return land.trade;
  }

  _selectFirstOwnedLand(owner) {
    const lands = Array.isArray(owner?.lands) ? owner.lands : [];
    const candidates = lands
      .map(l => ({ land: l, id: Number(l?.id) }))
      .filter(x => Number.isInteger(x.id) && x.id > 0)
      .sort((a, b) => a.id - b.id);

    for (const { land } of candidates) {
      const trade = this._ensureTrade(land);
      if (trade.status === 'owned') {
        return land;
      }
    }
    return null;
  }

  _getLandById(owner, landId) {
    const id = _toInt(landId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const lands = Array.isArray(owner?.lands) ? owner.lands : [];
    return lands.find(l => Number(l?.id) === id) || null;
  }

  _getMarketListings(market) {
    const list = Array.isArray(market?.listings) ? market.listings : [];
    return [...list].sort(_sortByTimeThenId);
  }

  _getResaleMarketListings(market) {
    const list = Array.isArray(market?.resaleListings) ? market.resaleListings : [];
    return [...list].sort(_sortByTimeThenId);
  }

  _getMyListings(market, ownerId) {
    const list = this._getMarketListings(market).filter(l => l.ownerId === ownerId);
    return list;
  }

  _getMySoldLands(owner) {
    const lands = Array.isArray(owner?.lands) ? owner.lands : [];
    const sold = [];
    for (const land of lands) {
      const trade = this._ensureTrade(land);
      if (trade.status === 'sold' && trade.sold?.holderId) {
        sold.push({
          landId: land.id,
          holderId: trade.sold.holderId,
          price: _toInt(trade.sold.price),
          dividendRate: this._normalizePercent(trade.sold.dividendRate, { minPercent: 0, maxPercent: 100, defaultPercent: 0 }).value,
          soldTime: Number(trade.sold.soldTime || 0)
        });
      }
    }
    // 稳定排序：soldTime -> landId
    return sold.sort((a, b) => {
      if (a.soldTime !== b.soldTime) return a.soldTime - b.soldTime;
      return Number(a.landId || 0) - Number(b.landId || 0);
    });
  }

  async _loadMarketData() {
    await this.storage.init();
    const data = await this.storage.readJSON(MARKET_FILENAME, null);
    if (data && typeof data === 'object') {
      return this._normalizeMarketDataShape(data);
    }
    const fresh = this._normalizeMarketDataShape({
      version: 1,
      updatedAt: _now(),
      listings: [],
      resaleListings: [],
      holdingsIndex: {}
    });
    await this._saveMarketData(fresh);
    return fresh;
  }

  _normalizeMarketDataShape(data) {
    const normalized = {
      version: Number(data?.version || 1),
      updatedAt: Number(data?.updatedAt || 0),
      listings: Array.isArray(data?.listings) ? data.listings : [],
      resaleListings: Array.isArray(data?.resaleListings) ? data.resaleListings : [],
      holdingsIndex: typeof data?.holdingsIndex === 'object' && data.holdingsIndex ? data.holdingsIndex : {}
    };
    return normalized;
  }

  async _saveMarketData(data) {
    await this.storage.init();
    const market = this._normalizeMarketDataShape(data);
    market.updatedAt = _now();
    const tempFile = `${MARKET_FILENAME}.tmp.${_now()}`;
    await this.storage.writeJSON(tempFile, market);
    await this.storage.rename(tempFile, MARKET_FILENAME);
  }

  async _getHoldingsSorted(market, holderId) {
    const holdings = await this._getOrRebuildHoldings(market, holderId);
    return [...holdings].sort((a, b) => {
      const ao = String(a?.ownerId || '');
      const bo = String(b?.ownerId || '');
      if (ao !== bo) return ao.localeCompare(bo);
      return Number(a?.landId || 0) - Number(b?.landId || 0);
    });
  }

  async _getOrRebuildHoldings(market, holderId) {
    market.holdingsIndex = typeof market.holdingsIndex === 'object' && market.holdingsIndex ? market.holdingsIndex : {};
    const list = market.holdingsIndex[holderId];
    if (Array.isArray(list)) return list;

    const rebuilt = await this._rebuildHoldingsForUser(holderId);
    return await this.redis.withUserLocks([MARKET_LOCK_KEY], async () => {
      const market2 = await this._loadMarketData();
      market2.holdingsIndex = typeof market2.holdingsIndex === 'object' && market2.holdingsIndex ? market2.holdingsIndex : {};

      // 加锁后二次确认：并发交易可能已创建/更新该持有索引。
      const existing = market2.holdingsIndex[holderId];
      if (Array.isArray(existing)) {
        market.holdingsIndex[holderId] = existing;
        return existing;
      }

      market2.holdingsIndex[holderId] = rebuilt;
      await this._saveMarketData(market2);
      market.holdingsIndex[holderId] = rebuilt;
      return rebuilt;
    }, 'land_trade_holdings_rebuild', 30);
  }

  async _rebuildHoldingsForUser(holderId) {
    const userIds = await playerYamlStorage.listAllPlayers();
    const holdings = [];
    for (const ownerId of userIds) {
      const ownerRaw = await playerYamlStorage.readPlayer(ownerId, null).catch(() => null);
      if (!ownerRaw) continue;
      const lands = Array.isArray(ownerRaw.lands) ? ownerRaw.lands : [];
      for (const land of lands) {
        const trade = this._ensureTrade(land);
        if (trade.status === 'sold' && trade.sold?.holderId === holderId) {
          holdings.push({ ownerId, landId: land.id });
        }
      }
    }
    return holdings.sort((a, b) => {
      const ao = String(a.ownerId || '');
      const bo = String(b.ownerId || '');
      if (ao !== bo) return ao.localeCompare(bo);
      return Number(a.landId || 0) - Number(b.landId || 0);
    });
  }

  async _distributeDividendWithRetry(ownerId, saleAmount, attempt = 0) {
    const rawOwner = await playerYamlStorage.readPlayer(ownerId, null).catch(() => null);
    if (!rawOwner) return { success: false, message: '玩家不存在' };

    const holderIdSet = new Set();
    const lands = Array.isArray(rawOwner.lands) ? rawOwner.lands : [];
    for (const land of lands) {
      const trade = land?.trade;
      if (trade?.status === 'sold' && trade?.sold?.holderId) {
        holderIdSet.add(trade.sold.holderId);
      }
    }

    if (holderIdSet.size === 0) {
      return { success: true, totalDividend: 0, payouts: {}, message: '本次无可分红地块' };
    }

    const holderIds = [...holderIdSet];

    try {
      return await this.redis.withUserLocks([ownerId, ...holderIds], async () => {
        const owner = await this.playerService.getPlayer(ownerId);
        if (!owner) return { success: false, message: '玩家不存在' };

        const calc = this._calcDividendPlan(owner, saleAmount);
        const targetHolderIds = Object.keys(calc.payouts);
        if (targetHolderIds.length === 0 || calc.totalDividend <= 0) {
          return { success: true, totalDividend: 0, payouts: {}, message: '本次无可分红地块' };
        }

        // 若持有人集合发生变化，释放锁后重试（避免在持锁状态下扩锁导致死锁）
        const missing = targetHolderIds.filter(id => !holderIdSet.has(id));
        if (missing.length > 0) {
          const err = new Error('LAND_TRADE_DIVIDEND_LOCKSET_CHANGED');
          err._landTradeRetry = true;
          throw err;
        }

        // 余额检查：正常情况下 saleAmount 已先入账，totalDividend 不应超出
        if (owner.coins < calc.totalDividend) {
          return { success: false, message: '分红失败：地主金币不足（请联系管理员检查结算顺序）' };
        }

        // 先扣地主，避免异常导致凭空增发；随后逐个给持有人加钱
        EconomyService.updateCoinsInTransaction(owner, -calc.totalDividend);

        // 写回累计分红
        for (const update of calc.landDividendUpdates) {
          const land = this._getLandById(owner, update.landId);
          if (!land) continue;
          const trade = this._ensureTrade(land);
          if (trade.status !== 'sold' || !trade.sold) continue;
          trade.sold.totalDividend = _toInt(trade.sold.totalDividend || 0) + update.amount;
        }

        owner.lastUpdated = _now();
        await this.playerService.dataService.savePlayer(ownerId, owner);

        for (const hid of targetHolderIds) {
          const payout = _toInt(calc.payouts[hid]);
          if (!Number.isInteger(payout) || payout <= 0) continue;
          const holder = await this.playerService.getPlayer(hid);
          if (!holder) {
            throw new Error(`分红失败：持有人不存在（${hid}）`);
          }
          EconomyService.updateCoinsInTransaction(holder, payout);
          holder.lastUpdated = _now();
          await this.playerService.dataService.savePlayer(hid, holder);
        }

        return {
          success: true,
          totalDividend: calc.totalDividend,
          payouts: calc.payouts,
          message: `本次分红总额${calc.totalDividend}金币，持有人${targetHolderIds.length}人`
        };
      }, 'land_trade_dividend', 30);
    } catch (error) {
      if (error?._landTradeRetry && attempt < 2) {
        return await this._distributeDividendWithRetry(ownerId, saleAmount, attempt + 1);
      }
      return { success: false, message: `分红失败: ${error.message}` };
    }
  }

  _calcDividendPlan(owner, saleAmount) {
    const landCount = Number(owner?.landCount || (Array.isArray(owner?.lands) ? owner.lands.length : 0));
    if (!Number.isInteger(landCount) || landCount <= 0) {
      return { totalDividend: 0, payouts: {}, landDividendUpdates: [] };
    }

    const basePerLand = Math.floor(saleAmount / landCount);
    if (basePerLand <= 0) {
      return { totalDividend: 0, payouts: {}, landDividendUpdates: [] };
    }

    const payouts = {};
    const landDividendUpdates = [];

    const lands = Array.isArray(owner?.lands) ? owner.lands : [];
    for (const land of lands) {
      const trade = this._ensureTrade(land);
      if (trade.status !== 'sold' || !trade.sold?.holderId) continue;

      const holderId = trade.sold.holderId;
      const ratePercent = this._normalizePercent(trade.sold.dividendRate, { minPercent: 0, maxPercent: 100, defaultPercent: 0 }).value || 0;
      if (ratePercent <= 0) continue;

      const dividend = Math.floor((basePerLand * ratePercent) / 100);
      if (dividend <= 0) continue;

      payouts[holderId] = (payouts[holderId] || 0) + dividend;
      landDividendUpdates.push({ landId: land.id, amount: dividend });
    }

    const totalDividend = Object.values(payouts).reduce((sum, v) => sum + (Number(v) || 0), 0);
    return { totalDividend, payouts, landDividendUpdates };
  }
}
