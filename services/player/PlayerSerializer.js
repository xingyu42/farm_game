/**
 * 玩家数据序列化工具
 * 负责玩家数据在YAML格式和对象格式之间的转换
 */

import Player from '../../models/Player.js';

class PlayerSerializer {
    constructor(config) {
        this.config = config;

    }

    /**
     * 序列化玩家数据为YAML格式
     * @param {Object|Player} playerData 玩家数据对象或Player实例
     * @returns {Object} YAML数据对象
     */
    serialize(playerData) {
        if (playerData instanceof Player) {
            // 如果是Player实例，转换为普通对象
            return playerData.toJSON();
        } else {
            // 如果是普通对象，直接返回
            return playerData;
        }
    }

    /**
     * 反序列化YAML数据为Player实例
     * @param {Object} yamlData YAML数据对象
     * @returns {Player|null} Player实例
     */
    deserialize(yamlData) {
        if (!yamlData || Object.keys(yamlData).length === 0) {
            return null;
        }

        // 清理已废弃的遗留字段（stats已被statistics取代）
        if (yamlData.stats) {
            delete yamlData.stats;
        }

        // 使用Player.fromObjectData创建Player实例（适用于YAML数据）
        try {
            const playerInstance = Player.fromObjectData(yamlData, this.config);
            return playerInstance;
        } catch (playerError) {
            logger.error(`[PlayerSerializer] 反序列化YAML数据失败: ${playerError.message}`);
            throw new Error(`玩家数据格式错误，无法反序列化: ${playerError.message}`);
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
                return new Array(landConfig?.startingLands || 3).fill(null).map((_, i) => ({
                    id: i + 1,
                    crop: null,
                    quality: 'normal',
                    plantTime: null,
                    harvestTime: null,
                    status: 'empty'
                }));
            case 'inventory':
                return {};
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
                        effectEndTime: 0
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