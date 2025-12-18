/**
 * 种植工具类
 * 整合种植相关的验证和序列化功能，提供统一的工具接口
 * 合并了 PlantingValidator 和 PlantingSerializer 的功能
 */

import Land from '../../models/Land.js';
import Calculator from '../../utils/calculator.js';
import { CommonUtils } from '../../utils/CommonUtils.js';

class PlantingUtils {
    constructor(config) {
        this.config = config;
    }

    _getInventoryItemQuantity(inventory, itemId) {
        return CommonUtils.getItemQuantity(inventory?.[itemId]);
    }

    // ==================== 验证功能（来自 PlantingValidator）====================

    /**
     * 验证玩家数据存在性
     * @param {Object} playerData 玩家数据
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validatePlayerData(playerData) {
        if (!playerData) {
            return {
                success: false,
                message: '玩家数据不存在'
            };
        }
        return null;
    }

    /**
     * 验证土地编号有效性
     * @param {number} landId 土地编号
     * @param {Array} lands 土地数组
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validateLandId(landId, lands) {
        const landIndex = landId - 1;
        if (landIndex < 0 || landIndex >= lands.length) {
            return {
                success: false,
                message: `土地编号${landId}不存在`
            };
        }
        return null;
    }

    /**
     * 验证土地是否适合种植
     * @param {Object} land 土地对象
     * @param {number} landId 土地编号
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validateLandForPlanting(land, landId) {
        // 复用 Land 模型的验证方法
        const landInstance = new Land(land);
        const validation = landInstance.validate();

        if (!validation.isValid) {
            return {
                success: false,
                message: `第${landId}块土地数据异常: ${validation.errors.join(', ')}`
            };
        }

        // 检查土地是否为空
        if (!landInstance.isEmpty()) {
            return {
                success: false,
                message: `第${landId}块土地已经种植了作物`
            };
        }

        return null;
    }

    /**
     * 验证作物类型有效性
     * @param {string} cropType 作物类型
     * @param {Object} cropsConfig 作物配置
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validateCropType(cropType, cropsConfig) {
        if (!cropType) {
            return {
                success: false,
                message: '作物类型不能为空'
            };
        }

        const cropConfig = cropsConfig[cropType];
        if (!cropConfig) {
            return {
                success: false,
                message: `未知的作物类型: ${cropType}`
            };
        }

        return null;
    }

    /**
     * 验证种植要求（等级、种子等）
     * @param {Object} playerData 玩家数据
     * @param {Object} cropConfig 作物配置
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validatePlantingRequirements(playerData, cropConfig) {
        // 验证等级要求
        if (playerData.level < cropConfig.requiredLevel) {
            return {
                success: false,
                message: `种植${cropConfig.name}需要${cropConfig.requiredLevel}级，当前等级：${playerData.level}`
            };
        }

        // 检查种子数量
        const seedItemId = `${cropConfig.type || 'unknown'}_seed`;
        const seedCount = this._getInventoryItemQuantity(playerData.inventory, seedItemId);
        if (seedCount < 1) {
            return {
                success: false,
                message: `仓库中没有${cropConfig.name}种子`
            };
        }

        return null;
    }

    /**
     * 验证仓库空间
     * @param {Object} playerData 玩家数据
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validateInventorySpace(playerData) {
        const currentInventoryCount = Calculator.getTotalItems(playerData.inventory);

        if (currentInventoryCount >= playerData.inventory_capacity) {
            return {
                success: false,
                message: '仓库已满，无法收获作物'
            };
        }

        return null;
    }

    /**
     * 验证土地基础状态（是否有作物、是否成熟）
     * @param {Object} land 土地对象
     * @param {number} landId 土地编号
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validateLandBasicStatus(land, landId) {
        if (!land.crop || land.status === 'empty') {
            return {
                success: false,
                message: `第${landId}块土地没有种植作物`
            };
        }

        if (land.status === 'mature') {
            return {
                success: false,
                message: `第${landId}块土地的作物已经成熟，请先收获`
            };
        }

        return null;
    }

    /**
     * 验证特定护理条件
     * @param {Object} land 土地对象
     * @param {number} landId 土地编号
     * @param {string} careType 护理类型：'water', 'fertilize', 'pesticide'
     * @returns {Object|null} 验证失败时返回错误对象，成功时返回null
     */
    validateCareCondition(land, landId, careType) {
        switch (careType) {
            case 'water':
                if (!land.needsWater) {
                    return {
                        success: false,
                        message: `第${landId}块土地的作物不需要浇水`
                    };
                }
                break;

            case 'pesticide':
                if (!land.hasPests) {
                    return {
                        success: false,
                        message: `第${landId}块土地的作物没有虫害`
                    };
                }
                break;

            case 'fertilize':
                // 施肥没有特殊条件限制，任何生长中的作物都可以施肥
                break;

            default:
                return {
                    success: false,
                    message: '未知的护理类型'
                };
        }

        return null;
    }

    /**
     * 执行完整的护理前验证
     * @param {Object} playerData 玩家数据
     * @param {number} landId 土地编号
     * @param {string} careType 护理类型
     * @returns {Object} 验证结果 { success: boolean, error?: Object, land?: Object, landIndex?: number }
     */
    validateCareOperation(playerData, landId, careType) {
        // 1. 验证玩家数据
        const playerError = this.validatePlayerData(playerData);
        if (playerError) {
            return { success: false, error: playerError };
        }

        // 2. 验证土地编号
        const landError = this.validateLandId(landId, playerData.lands);
        if (landError) {
            return { success: false, error: landError };
        }

        const landIndex = landId - 1;
        const land = playerData.lands[landIndex];

        // 3. 验证土地基础状态
        const statusError = this.validateLandBasicStatus(land, landId);
        if (statusError) {
            return { success: false, error: statusError };
        }

        // 4. 验证特定护理条件
        const conditionError = this.validateCareCondition(land, landId, careType);
        if (conditionError) {
            return { success: false, error: conditionError };
        }

        return { success: true, land, landIndex };
    }

    /**
     * 验证作物是否可以收获
     * @param {Object} land 土地对象
     * @param {number} currentTime 当前时间戳
     * @returns {boolean} 是否可以收获
     */
    canHarvest(land, currentTime = Date.now()) {
        const landInstance = new Land(land);
        return landInstance.isReady(currentTime);
    }

    /**
     * 验证肥料可用性
     * @param {Object} inventory 玩家库存
     * @param {string} fertilizerType 肥料类型（可选）
     * @returns {Object} 验证结果
     */
    validateFertilizerAvailability(inventory, fertilizerType = null) {
        if (fertilizerType) {
            // 验证指定肥料
            if (this._getInventoryItemQuantity(inventory, fertilizerType) <= 0) {
                return {
                    success: false,
                    message: `仓库中没有${fertilizerType}`,
                    availableFertilizers: this._getAvailableFertilizers(inventory)
                };
            }
        } else {
            // 检查是否有任何可用肥料
            const availableFertilizer = this._selectBestFertilizer(inventory);
            if (!availableFertilizer) {
                return {
                    success: false,
                    message: '仓库中没有肥料'
                };
            }
        }

        return { success: true };
    }

    /**
     * 自动选择最好的肥料
     * @param {Object} inventory 玩家库存
     * @returns {string|null} 选中的肥料ID
     * @private
     */
    _selectBestFertilizer(inventory) {
        const availableFertilizers = ['fertilizer_deluxe', 'fertilizer_premium', 'fertilizer_normal'];

        for (const fertilizer of availableFertilizers) {
            if (this._getInventoryItemQuantity(inventory, fertilizer) > 0) {
                return fertilizer;
            }
        }

        return null;
    }

    /**
     * 获取可用肥料列表（用于错误提示）
     * @param {Object} inventory 玩家库存
     * @returns {Array<string>} 可用肥料名称列表
     * @private
     */
    _getAvailableFertilizers(inventory) {
        const itemsConfig = this.config?.items;
        const fertilizersConfig = itemsConfig?.fertilizers || {};
        const available = [];

        for (const [fertilizerId, config] of Object.entries(fertilizersConfig)) {
            const quantity = this._getInventoryItemQuantity(inventory, fertilizerId);
            if (quantity > 0) {
                available.push(config.name + '(' + quantity + '个)');
            }
        }

        return available;
    }


    /**
     * 验证作物数据
     * @param {Object} cropData 作物数据
     * @returns {Object} 验证结果
     */
    validateCropData(cropData) {
        if (!cropData) {
            return { success: false, message: '作物数据不能为空' };
        }

        // 验证lands字段
        if (cropData.lands && !Array.isArray(cropData.lands)) {
            return { success: false, message: 'lands字段必须是数组' };
        }

        // 验证每块土地的数据结构
        if (cropData.lands) {
            for (let i = 0; i < cropData.lands.length; i++) {
                const land = cropData.lands[i];
                if (!land || typeof land !== 'object') {
                    return { success: false, message: `第${i + 1}块土地数据格式错误` };
                }

                // 验证必需字段
                const requiredFields = ['id', 'status'];
                for (const field of requiredFields) {
                    if (land[field] === undefined) {
                        return { success: false, message: `第${i + 1}块土地缺少${field}字段` };
                    }
                }

                // 验证状态值
                const validStatuses = ['empty', 'growing', 'mature'];
                if (!validStatuses.includes(land.status)) {
                    return { success: false, message: `第${i + 1}块土地状态无效: ${land.status}` };
                }
            }
        }

        return { success: true, message: '作物数据验证通过' };
    }

    /**
     * 创建空的土地数据
     * @param {number} landId 土地编号
     * @param {string} quality 土地品质
     * @returns {Object} 土地数据
     */
    createEmptyLandData(landId, quality = 'normal') {
        return {
            id: landId,
            crop: null,
            quality: quality,
            plantTime: null,
            harvestTime: null,
            status: 'empty',
            health: 100,
            needsWater: false,
            hasPests: false,
            stealable: false
        };
    }

    /**
     * 创建种植后的土地数据
     * @param {number} landId 土地编号
     * @param {string} cropType 作物类型
     * @param {string} quality 土地品质
     * @param {number} plantTime 种植时间
     * @param {number} harvestTime 收获时间
     * @returns {Object} 土地数据
     */
    createPlantedLandData(landId, cropType, quality = 'normal', plantTime = Date.now(), harvestTime = null) {
        return {
            id: landId,
            crop: cropType,
            quality: quality,
            plantTime: plantTime,
            harvestTime: harvestTime,
            status: 'growing',
            health: 100,
            needsWater: false,
            hasPests: false,
            stealable: false
        };
    }

    /**
     * 格式化土地数据用于显示
     * @param {Object} landData 土地数据
     * @returns {Object} 格式化后的数据
     */
    formatLandDataForDisplay(landData) {
        if (!landData) {
            return null;
        }

        const formatted = { ...landData };

        // 格式化时间字段
        if (formatted.plantTime) {
            formatted.plantTimeFormatted = new Date(formatted.plantTime).toLocaleString();
        }

        if (formatted.harvestTime) {
            formatted.harvestTimeFormatted = new Date(formatted.harvestTime).toLocaleString();
            formatted.timeToHarvest = Math.max(0, formatted.harvestTime - Date.now());
        }

        // 添加状态描述
        const statusDescriptions = {
            empty: '空地',
            growing: '生长中',
            mature: '成熟',

        };
        formatted.statusDescription = statusDescriptions[formatted.status] || formatted.status;

        return formatted;
    }
}

export { PlantingUtils }; 
