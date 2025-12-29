/**
 * @fileoverview 农场主排行榜服务 - #农场主排行榜
 *
 * Input:
 * - ../utils/playerYamlStorage.js - PlayerYamlStorage (玩家数据存储)
 * - redisClient - Redis客户端 (分布式锁)
 * - config - 配置对象
 *
 * Output:
 * - RankingService (default) - 排行榜服务类,提供:
 *   - getFarmOwnerRanking: 获取农场主综合排行榜
 *   - rebuildFarmOwnerRanking: 重建排行榜缓存
 *
 * Pos: 服务层,负责农场主综合评分排行榜计算
 *
 * 评分公式:
 * score = landCountWeight*landCount + landQualityBonusWeight*landQualityBonus
 *       + levelWeight*level + assetsLog10Weight*log10(totalAssets+1)
 *
 * 土地品质权重: normal=1.0, red=1.2, black=1.5, gold=2.0
 * landQualityBonus = Σ(qualityWeight - 1.0) 对于每块土地
 */

import { PlayerYamlStorage } from '../utils/playerYamlStorage.js';

const VALID_QUALITIES = ['normal', 'red', 'black', 'gold'];

const DEFAULT_QUALITY_WEIGHTS = Object.freeze({
  normal: 1.0,
  red: 1.2,
  black: 1.5,
  gold: 2.0
});

const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  landCountWeight: 100,
  landQualityBonusWeight: 200,
  levelWeight: 150,
  assetsLog10Weight: 1000
});

function _toInt(value, defaultValue = 0) {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function _toFloat(value, defaultValue = 0) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : defaultValue;
}

export default class RankingService {
  constructor(redisClient, config, options = {}) {
    this.redis = redisClient;
    this.config = config;
    this.playerYamlStorage = new PlayerYamlStorage();
    this.cache = new Map();
    this.cacheTimeoutMs = Number.isFinite(options.cacheTimeoutMs) ? options.cacheTimeoutMs : 60_000;
    this.cacheKey = 'farm_owner_ranking';
  }

  /**
   * 获取农场主排行榜（综合评分）
   * @param {Object} opts
   * @param {number} opts.limit 返回条数上限（默认10，最大50）
   * @param {number} opts.offset 偏移（默认0）
   * @param {string|null} opts.userId 可选，查询该玩家的排名（若不在分页内）
   * @param {boolean} opts.forceRefresh 强制刷新缓存
   * @returns {Promise<Object>}
   */
  async getFarmOwnerRanking(opts = {}) {
    const limit = Math.min(Math.max(_toInt(opts.limit, 10), 1), 50);
    const offset = Math.max(_toInt(opts.offset, 0), 0);
    const userId = opts.userId != null ? String(opts.userId) : null;
    const forceRefresh = Boolean(opts.forceRefresh);

    const cached = this.cache.get(this.cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < this.cacheTimeoutMs) {
      return this._buildRankingResponse(cached.data, { limit, offset, userId, fromCache: true });
    }

    const rebuilt = await this.rebuildFarmOwnerRanking();
    this.cache.set(this.cacheKey, { data: rebuilt, timestamp: Date.now() });
    return this._buildRankingResponse(rebuilt, { limit, offset, userId, fromCache: false });
  }

  /**
   * 重建排行榜（全量扫描）
   * @returns {Promise<Object>} 包含 fullList、元信息、更新时间
   */
  async rebuildFarmOwnerRanking() {
    const playerIds = await this.playerYamlStorage.listAllPlayers();
    const playersRaw = [];

    for (const playerId of playerIds) {
      try {
        const raw = await this.playerYamlStorage.readPlayer(playerId, null);
        if (raw) playersRaw.push({ odUserId: String(playerId), raw });
      } catch (err) {
        logger?.warn?.(`[RankingService] Failed to read player [${playerId}]: ${err?.message || err}`);
      }
    }

    const qualityWeights = this._getQualityWeights();
    const scoreWeights = this._getScoreWeights();
    const holdingsIndex = this._buildHoldingsValueIndex(playersRaw);

    const fullList = playersRaw.map(({ odUserId, raw }) => {
      const landStats = this._computeLandStats(raw, qualityWeights);
      const coins = Math.max(0, _toInt(raw?.coins, 0));
      const level = Math.max(1, _toInt(raw?.level, 1));
      const heldLandRightsValue = holdingsIndex.get(odUserId)?.value ?? 0;
      const heldLandRightsCount = holdingsIndex.get(odUserId)?.count ?? 0;
      const totalAssets = coins + heldLandRightsValue;

      const entry = {
        userId: odUserId,
        name: raw?.name ? String(raw.name) : `玩家${odUserId}`,
        level,
        coins,
        landCount: landStats.landCount,
        qualityCounts: landStats.qualityCounts,
        landQualityBonus: landStats.landQualityBonus,
        heldLandRightsValue,
        heldLandRightsCount,
        totalAssets
      };

      const { score, breakdown } = this._computeScore(entry, scoreWeights);
      return { ...entry, score, breakdown };
    });

    fullList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.totalAssets !== a.totalAssets) return b.totalAssets - a.totalAssets;
      if (b.landCount !== a.landCount) return b.landCount - a.landCount;
      if (b.level !== a.level) return b.level - a.level;
      return String(a.userId).localeCompare(String(b.userId));
    });

    return {
      updatedAt: new Date().toISOString(),
      totalPlayers: fullList.length,
      weights: { qualityWeights, scoreWeights },
      fullList
    };
  }

  _buildRankingResponse(rebuilt, { limit, offset, userId, fromCache }) {
    const fullList = Array.isArray(rebuilt?.fullList) ? rebuilt.fullList : [];
    const paged = fullList.slice(offset, offset + limit).map((x, i) => ({
      ...x,
      rank: offset + i + 1
    }));

    let self = null;
    if (userId) {
      const idx = fullList.findIndex(x => String(x.userId) === String(userId));
      if (idx >= 0) self = { ...fullList[idx], rank: idx + 1 };
    }

    return {
      type: 'farm_owner_ranking',
      fromCache,
      updatedAt: rebuilt?.updatedAt ?? new Date().toISOString(),
      totalPlayers: rebuilt?.totalPlayers ?? fullList.length,
      weights: rebuilt?.weights ?? { qualityWeights: DEFAULT_QUALITY_WEIGHTS, scoreWeights: DEFAULT_SCORE_WEIGHTS },
      list: paged,
      self
    };
  }

  _getQualityWeights() {
    const cfg = this.config?.steal?.rewards?.bonusByQuality;
    const weights = { ...DEFAULT_QUALITY_WEIGHTS };
    for (const q of VALID_QUALITIES) {
      if (cfg && Object.prototype.hasOwnProperty.call(cfg, q)) {
        weights[q] = _toFloat(cfg[q], weights[q]);
      }
    }
    return weights;
  }

  _getScoreWeights() {
    const cfg = this.config?.ranking?.scoreWeights;
    const weights = { ...DEFAULT_SCORE_WEIGHTS };
    if (cfg && typeof cfg === 'object') {
      if (cfg.landCountWeight !== undefined) weights.landCountWeight = _toFloat(cfg.landCountWeight, weights.landCountWeight);
      if (cfg.landQualityBonusWeight !== undefined)
        weights.landQualityBonusWeight = _toFloat(cfg.landQualityBonusWeight, weights.landQualityBonusWeight);
      if (cfg.levelWeight !== undefined) weights.levelWeight = _toFloat(cfg.levelWeight, weights.levelWeight);
      if (cfg.assetsLog10Weight !== undefined) weights.assetsLog10Weight = _toFloat(cfg.assetsLog10Weight, weights.assetsLog10Weight);
    }
    return weights;
  }

  /**
   * 构建持有土地权益价值索引
   * 扫描所有玩家土地，统计每个 holderId 持有的权益总价值
   */
  _buildHoldingsValueIndex(playersRaw) {
    const index = new Map();
    for (const { raw } of playersRaw) {
      const lands = Array.isArray(raw?.lands) ? raw.lands : [];
      for (const land of lands) {
        const trade = land?.trade;
        if (!trade || typeof trade !== 'object') continue;
        if (trade.status !== 'sold') continue;
        const holderId = trade?.sold?.holderId ? String(trade.sold.holderId) : null;
        if (!holderId) continue;
        const price = Math.max(0, _toInt(trade?.sold?.price, 0));
        const prev = index.get(holderId) ?? { value: 0, count: 0 };
        index.set(holderId, { value: prev.value + price, count: prev.count + 1 });
      }
    }
    return index;
  }

  _computeLandStats(raw, qualityWeights) {
    const lands = Array.isArray(raw?.lands) ? raw.lands : [];
    const landCountFromYaml = _toInt(raw?.landCount, NaN);
    const landCount = Number.isFinite(landCountFromYaml) && landCountFromYaml >= 0 ? landCountFromYaml : lands.length;

    const qualityCounts = { normal: 0, red: 0, black: 0, gold: 0 };
    let landQualityBonus = 0;

    for (const land of lands) {
      const qRaw = land?.quality ? String(land.quality) : 'normal';
      const q = VALID_QUALITIES.includes(qRaw) ? qRaw : 'normal';
      qualityCounts[q] = (qualityCounts[q] ?? 0) + 1;
      const w = _toFloat(qualityWeights?.[q], 1.0);
      landQualityBonus += Math.max(0, w - 1.0);
    }

    return { landCount, qualityCounts, landQualityBonus };
  }

  _computeScore(entry, scoreWeights) {
    const landCountPoints = scoreWeights.landCountWeight * Math.max(0, _toInt(entry.landCount, 0));
    const landQualityBonusPoints = scoreWeights.landQualityBonusWeight * Math.max(0, _toFloat(entry.landQualityBonus, 0));
    const levelPoints = scoreWeights.levelWeight * Math.max(1, _toInt(entry.level, 1));

    const totalAssets = Math.max(0, _toInt(entry.totalAssets, 0));
    const assetsLog = Math.log10(totalAssets + 1);
    const assetsPoints = scoreWeights.assetsLog10Weight * assetsLog;

    const score = landCountPoints + landQualityBonusPoints + levelPoints + assetsPoints;
    return {
      score,
      breakdown: {
        landCountPoints,
        landQualityBonusPoints,
        levelPoints,
        assetsPoints
      }
    };
  }
}
