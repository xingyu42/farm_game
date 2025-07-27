/**
 * 玩家数据序列化工具
 * 负责玩家数据在Redis Hash格式和对象格式之间的转换
 */

import Player from '../../models/Player.js';

class PlayerSerializer {
    constructor(config = null) {
        this.config = config;

        // 定义简单字段（存储为Hash字段）
        this.simpleFields = [
            'name', 'level', 'experience', 'coins', 'landCount', 'maxLandCount',
            'inventoryCapacity', 'inventory_capacity', 'maxInventoryCapacity',
            'createdAt', 'lastUpdated', 'lastActiveTime'
        ];

        // 定义复杂字段（JSON序列化后存储）
        this.complexFields = [
            'lands', 'inventory', 'stats', 'signIn', 'protection', 'stealing', 'statistics'
        ];
    }

    /**
     * 智能序列化玩家数据为Redis Hash格式
     * 统一处理Player实例和普通对象的序列化逻辑，确保数据一致性
     * @param {Object|Player} playerData 玩家数据对象或Player实例
     * @returns {Object} Redis Hash格式的数据对象
     */
    serializeForHash(playerData) {
        if (playerData instanceof Player) {
            // 如果是Player实例，使用其toHashData方法
            return playerData.toHashData();
        } else {
            // 如果是普通对象，使用手动构建逻辑
            const hashData = {};

            // 处理简单字段
            for (const field of this.simpleFields) {
                if (playerData[field] !== undefined) {
                    hashData[field] = playerData[field].toString();
                }
            }

            // 处理复杂字段（JSON序列化）
            for (const field of this.complexFields) {
                if (playerData[field] !== undefined) {
                    hashData[field] = JSON.stringify(playerData[field]);
                }
            }

            return hashData;
        }
    }

    /**
     * 从Redis Hash数据反序列化为玩家对象
     * @param {Object} hashData Redis Hash数据
     * @returns {Player|Object} Player实例或普通对象
     */
    deserializeFromHash(hashData) {
        if (!hashData || Object.keys(hashData).length === 0) {
            return null;
        }

        // 优先尝试使用Player.fromRawData创建Player实例
        try {
            const playerInstance = Player.fromRawData(hashData, this.config);
            return playerInstance;
        } catch (playerError) {
            console.warn(`[PlayerSerializer] Player.fromRawData失败，回退到传统方法: ${playerError.message}`);

            // 回退到原来的数据处理方式
            const playerData = {};

            // 处理简单字段
            for (const field of this.simpleFields) {
                if (hashData[field] !== undefined) {
                    // 数值字段转换
                    if (['level', 'experience', 'coins', 'landCount', 'maxLandCount',
                        'inventoryCapacity', 'inventory_capacity', 'maxInventoryCapacity',
                        'createdAt', 'lastUpdated', 'lastActiveTime'].includes(field)) {
                        playerData[field] = parseInt(hashData[field]);
                    } else {
                        playerData[field] = hashData[field];
                    }
                }
            }

            // 处理复杂字段（JSON反序列化）
            for (const field of this.complexFields) {
                if (hashData[field]) {
                    try {
                        playerData[field] = JSON.parse(hashData[field]);
                    } catch (error) {
                        console.warn(`[PlayerSerializer] 解析复杂字段失败 [${field}]: ${error.message}`);
                        playerData[field] = this._getDefaultComplexField(field);
                    }
                } else {
                    playerData[field] = this._getDefaultComplexField(field);
                }
            }

            // 向后兼容：gold属性
            Object.defineProperty(playerData, 'gold', {
                get: function () { return this.coins; },
                set: function (value) { this.coins = value; }
            });

            return playerData;
        }
    }

    /**
     * 获取复杂字段的默认值
     * @param {string} field 字段名
     * @returns {any} 默认值
     */
    _getDefaultComplexField(field) {
        const landConfig = this.config?.land?.default;

        switch (field) {
            case 'lands':
                return new Array(landConfig.startingLands).fill(null).map((_, i) => ({
                    id: i + 1,
                    crop: null,
                    quality: 'normal',
                    plantTime: null,
                    harvestTime: null,
                    status: 'empty'
                }));
            case 'inventory':
                return {};
            case 'stats':
                return {
                    total_signin_days: 0,
                    total_income: 0,
                    total_expenses: 0,
                    consecutive_signin_days: 0
                };
            case 'signIn':
                return {
                    lastSignDate: null,
                    consecutiveDays: 0,
                    totalSignDays: 0
                };
            case 'protection':
                return {
                    dogFood: {
                        type: null,
                        effectEndTime: 0,
                        defenseBonus: 0
                    },
                    farmProtection: {
                        endTime: 0
                    }
                };
            case 'stealing':
                return {
                    lastStealTime: 0,
                    cooldownEndTime: 0
                };
            case 'statistics':
                return {
                    totalHarvested: 0,
                    totalStolenFrom: 0,
                    totalStolenBy: 0,
                    totalMoneyEarned: 0,
                    totalMoneySpent: 0
                };
            default:
                return {};
        }
    }

    /**
     * 验证玩家数据的完整性
     * @param {Object} playerData 玩家数据
     * @returns {Object} 验证结果
     */
    validatePlayerData(playerData) {
        const errors = [];

        // 检查必需的简单字段
        const requiredSimpleFields = ['level', 'experience', 'coins', 'landCount'];
        for (const field of requiredSimpleFields) {
            if (playerData[field] === undefined || playerData[field] === null) {
                errors.push(`缺少必需字段: ${field}`);
            }
        }

        // 检查必需的复杂字段
        const requiredComplexFields = ['lands', 'inventory', 'signIn', 'protection', 'statistics'];
        for (const field of requiredComplexFields) {
            if (!playerData[field]) {
                errors.push(`缺少必需字段: ${field}`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * 创建新玩家的默认数据
     * @param {string} name 玩家名称
     * @returns {Player} Player实例
     */
    createNewPlayerData(name = '') {
        // 使用Player.createEmpty创建Player实例，确保统一的架构
        return Player.createEmpty(name, this.config);
    }
}

export default PlayerSerializer; 