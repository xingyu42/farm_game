/**
 * 种植数据持久化服务
 * 负责作物相关的Redis操作、数据序列化/反序列化等底层数据操作
 * 参考 PlayerDataService 的设计模式，专门处理种植模块的数据访问
 */

import { PlantingUtils } from './PlantingUtils.js';

class PlantingDataService {
    constructor(redisClient, config, _logger = null, playerDataService = null) {
        this.redis = redisClient;
        this.config = config;
        this.serializer = new PlantingUtils(config);
        this.playerDataService = playerDataService;
    }

    /**
     * 获取玩家的作物数据
     * @param {string} userId 用户ID
     * @returns {Object|null} 作物数据或null
     */
    async getCropData(userId) {
        try {
            if (!this.playerDataService) {
                throw new Error('PlayerDataService not initialized');
            }

            // 通过PlayerDataService获取玩家数据
            const playerData = await this.playerDataService.getPlayer(userId);
            if (!playerData) {
                return null;
            }

            // 构建作物数据对象
            const cropData = {
                lands: playerData.lands || [],
                lastUpdated: playerData.lastUpdated || null
            };

            return cropData;
        } catch (error) {
            logger.error(`[PlantingDataService] 获取作物数据失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取特定土地的作物数据
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @returns {Object|null} 土地作物数据或null
     */
    async getLandCropData(userId, landId) {
        try {
            const cropData = await this.getCropData(userId);
            if (!cropData || !cropData.lands) {
                return null;
            }


            const landIndex = landId - 1;
            if (landIndex < 0 || landIndex >= cropData.lands.length) {
                return null;
            }

            return cropData.lands[landIndex];
        } catch (error) {
            logger.error(`[PlantingDataService] 获取土地作物数据失败 [${userId}][${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 更新土地作物数据
     * @param {string} userId 用户ID
     * @param {number} landId 土地编号
     * @param {Object} landData 土地数据
     */
    async updateLandCropData(userId, landId, landData) {
        try {
            if (!this.playerDataService) {
                throw new Error('PlayerDataService not initialized');
            }

            // 通过PlayerDataService获取玩家数据
            const playerData = await this.playerDataService.getPlayer(userId);
            if (!playerData) {
                throw new Error('玩家不存在');
            }

            // 获取当前土地数据
            let lands = playerData.lands || [];

            // 确保土地数组足够大
            const landIndex = landId - 1;
            while (lands.length <= landIndex) {
                lands.push({
                    id: lands.length + 1,
                    crop: null,
                    quality: 'normal',
                    plantTime: null,
                    harvestTime: null,
                    status: 'empty'
                });
            }

            // 更新指定土地
            lands[landIndex] = { ...lands[landIndex], ...landData, id: landId };

            // 保存更新后的数据
            const updates = {
                lands: lands,
                lastUpdated: Date.now()
            };

            await this.playerDataService.updateFields(userId, updates);
        } catch (error) {
            logger.error(`[PlantingDataService] 更新土地作物数据失败 [${userId}][${landId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 批量更新土地作物数据
     * @param {string} userId 用户ID
     * @param {Object} landUpdates 土地更新映射 {landId: landData}
     */
    async updateMultipleLands(userId, landUpdates) {
        try {
            if (!this.playerDataService) {
                throw new Error('PlayerDataService not initialized');
            }

            // 通过PlayerDataService获取玩家数据
            const playerData = await this.playerDataService.getPlayer(userId);
            if (!playerData) {
                throw new Error('玩家不存在');
            }

            // 获取当前土地数据
            let lands = playerData.lands || [];

            // 批量更新土地
            for (const [landId, landData] of Object.entries(landUpdates)) {
                const landIndex = parseInt(landId) - 1;

                // 确保土地数组足够大
                while (lands.length <= landIndex) {
                    lands.push({
                        id: lands.length + 1,
                        crop: null,
                        quality: 'normal',
                        plantTime: null,
                        harvestTime: null,
                        status: 'empty'
                    });
                }

                lands[landIndex] = { ...lands[landIndex], ...landData, id: parseInt(landId) };
            }

            // 保存更新后的数据
            const updates = {
                lands: lands,
                lastUpdated: Date.now()
            };

            await this.playerDataService.updateFields(userId, updates);
        } catch (error) {
            logger.error(`[PlantingDataService] 批量更新土地数据失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 使用事务执行操作 (兼容性方法)
     * @param {string} userId 用户ID
     * @param {Function} operation 操作函数，接收(dataService, userId)参数
     * @returns {any} 操作结果
     */
    async executeWithTransaction(userId, operation) {
        try {
            if (!this.playerDataService) {
                throw new Error('PlayerDataService not initialized');
            }

            // 使用PlayerDataService的锁机制来确保数据一致性
            return await this.playerDataService.executeWithTransaction(userId, operation);
        } catch (error) {
            logger.error(`[PlantingDataService] 事务执行失败 [${userId}]: ${error.message}`);
            throw error;
        }
    }

    /**
     * 检查玩家是否存在
     * @param {string} userId 用户ID
     * @returns {boolean} 是否存在
     */
    async playerExists(userId) {
        try {
            if (!this.playerDataService) {
                throw new Error('PlayerDataService not initialized');
            }

            // 通过PlayerDataService检查玩家是否存在
            const player = await this.playerDataService.getPlayer(userId);
            return !!player;
        } catch (error) {
            logger.error(`[PlantingDataService] 检查玩家存在失败 [${userId}]: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取序列化器实例（供其他服务使用）
     * @returns {PlantingUtils} 序列化器实例
     */
    getSerializer() {
        return this.serializer;
    }

    /**
     * 验证作物数据
     * @param {Object} cropData 作物数据
     * @returns {Object} 验证结果
     */
    validateCropData(cropData) {
        return this.serializer.validateCropData(cropData);
    }


}

export default PlantingDataService; 