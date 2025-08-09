/**
 * 数据备份服务
 * 定期备份YAML文件中的玩家数据到JSON文件
 * 支持自动清理旧备份文件，确保存储空间可控
 */

import { FileStorage } from '../../utils/fileStorage.js';
import { PlayerYamlStorage } from '../../utils/playerYamlStorage.js';

class DataBackupService {
    constructor(redisClient, config, playerService = null) {
        this.redis = redisClient;
        this.config = config;
        this.playerService = playerService;
        // 创建专门用于备份的 FileStorage 实例
        this.backupStorage = new FileStorage('data/backups');
        // 创建玩家YAML存储实例
        this.playerYamlStorage = new PlayerYamlStorage();

        // 备份定时器
        this.backupTimer = null;

        // 服务状态
        this.isRunning = false;

        // 从配置获取备份设置
        this.backupConfig = {
            interval: config.backup.interval,
            maxBackups: config.backup.maxBackups,
            filePrefix: config.backup.filePrefix,
            enabled: config.backup.enabled,
            startDelay: config.backup.startDelay,
            compress: config.backup.compress,
            retryCount: config.backup.retryCount,
            retryInterval: config.backup.retryInterval
        };
    }

    /**
     * 启动备份服务
     */
    async start() {
        if (this.isRunning) {
            logger.warn('[DataBackupService] 备份服务已在运行中');
            return;
        }

        if (!this.backupConfig.enabled) {
            logger.info('[DataBackupService] 备份服务已禁用');
            return;
        }

        // 确保备份目录已创建
        try {
            await this.backupStorage.init();
        } catch (error) {
            logger.error(`[DataBackupService] 初始化备份目录失败: ${error.message}`);
            // 初始化失败则直接返回，避免后续反复报错
            return;
        }

        logger.info(`[DataBackupService] 启动备份服务，间隔: ${this.backupConfig.interval}ms`);

        this.isRunning = true;

        // 延迟启动首次备份
        setTimeout(() => {
            if (this.isRunning) {
                this._scheduleNextBackup();
            }
        }, this.backupConfig.startDelay);
    }

    /**
     * 停止备份服务
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }

        logger.info('[DataBackupService] 停止备份服务');

        if (this.backupTimer) {
            clearTimeout(this.backupTimer);
            this.backupTimer = null;
        }

        this.isRunning = false;
    }

    /**
     * 手动执行一次备份
     * @returns {Object} 备份结果
     */
    async executeBackup() {
        const startTime = Date.now();
        let retryCount = 0;

        while (retryCount <= this.backupConfig.retryCount) {
            try {
                logger.info(`[DataBackupService] 开始执行备份 (尝试 ${retryCount + 1}/${this.backupConfig.retryCount + 1})`);

                // 1. 获取所有玩家数据
                const playerData = await this._getAllPlayerData();

                if (Object.keys(playerData).length === 0) {
                    logger.warn('[DataBackupService] 没有找到玩家数据，跳过备份');
                    return { success: true, playerCount: 0, message: '无数据需要备份' };
                }

                // 2. 生成备份文件名
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `${this.backupConfig.filePrefix}_${timestamp}.json`;

                // 3. 准备备份数据
                const backupData = {
                    timestamp: new Date().toISOString(),
                    playerCount: Object.keys(playerData).length,
                    backupVersion: '1.0',
                    data: playerData
                };

                // 4. 写入备份文件
                // 保障目录存在（双保险）
                await this.backupStorage.init();
                await this.backupStorage.writeJSON(filename, backupData);

                // 5. 清理旧备份
                await this._cleanupOldBackups();

                const duration = Date.now() - startTime;
                logger.info(`[DataBackupService] 备份完成: ${filename}, 玩家数: ${Object.keys(playerData).length}, 耗时: ${duration}ms`);

                return {
                    success: true,
                    filename,
                    playerCount: Object.keys(playerData).length,
                    duration
                };

            } catch (error) {
                retryCount++;
                logger.error(`[DataBackupService] 备份失败 (尝试 ${retryCount}/${this.backupConfig.retryCount + 1}): ${error.message}`);

                if (retryCount > this.backupConfig.retryCount) {
                    throw error;
                }

                // 等待重试间隔
                await this._sleep(this.backupConfig.retryInterval);
            }
        }
    }

    /**
     * 获取备份历史
     * @returns {Array} 备份文件列表
     */
    async getBackupHistory() {
        try {
            const files = await this.backupStorage.listFiles(`${this.backupConfig.filePrefix}.*\\.json$`);

            // 按时间戳排序（最新的在前）
            const backupFiles = files
                .filter(file => file.startsWith(this.backupConfig.filePrefix))
                .map(file => {
                    const timestampMatch = file.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/);
                    const timestamp = timestampMatch ? timestampMatch[1].replace(/-/g, ':').replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z') : null;

                    return {
                        filename: file,
                        timestamp: timestamp ? new Date(timestamp) : null
                    };
                })
                .filter(item => item.timestamp)
                .sort((a, b) => b.timestamp - a.timestamp);

            return backupFiles;
        } catch (error) {
            logger.error(`[DataBackupService] 获取备份历史失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 恢复备份数据（仅读取，不自动应用）
     * @param {string} filename 备份文件名
     * @returns {Object} 备份数据
     */
    async restoreBackup(filename) {
        try {
            const backupData = await this.backupStorage.readJSON(filename);

            if (!backupData || !backupData.data) {
                throw new Error('备份文件格式无效');
            }

            logger.info(`[DataBackupService] 读取备份文件: ${filename}, 玩家数: ${backupData.playerCount}`);

            return backupData;
        } catch (error) {
            logger.error(`[DataBackupService] 恢复备份失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 私有方法：调度下次备份
     * @private
     */
    _scheduleNextBackup() {
        if (!this.isRunning) {
            return;
        }

        this.backupTimer = setTimeout(async () => {
            try {
                await this.executeBackup();
            } catch (error) {
                logger.error(`[DataBackupService] 定时备份执行失败: ${error.message}`);
            }

            // 调度下次备份
            this._scheduleNextBackup();
        }, this.backupConfig.interval);
    }

    /**
     * 私有方法：获取所有玩家数据
     * @returns {Object} 玩家数据对象
     * @private
     */
    async _getAllPlayerData() {
        try {
            // 获取所有玩家ID列表
            const playerIds = await this.playerYamlStorage.listAllPlayers();

            if (!playerIds || playerIds.length === 0) {
                return {};
            }

            const playerData = {};

            // 批量获取玩家数据
            for (const userId of playerIds) {
                try {
                    const yamlData = await this.playerYamlStorage.readPlayer(userId);

                    if (yamlData && Object.keys(yamlData).length > 0) {
                        // 备份完整的玩家数据
                        playerData[userId] = yamlData;
                    }
                } catch (error) {
                    logger.warn(`[DataBackupService] 获取玩家数据失败 [${userId}]: ${error.message}`);
                }
            }

            return playerData;
        } catch (error) {
            logger.error(`[DataBackupService] 获取所有玩家数据失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 私有方法：清理旧备份文件
     * @private
     */
    async _cleanupOldBackups() {
        try {
            const backupHistory = await this.getBackupHistory();

            if (backupHistory.length <= this.backupConfig.maxBackups) {
                return; // 不需要清理
            }

            // 删除超出数量限制的旧备份
            const filesToDelete = backupHistory.slice(this.backupConfig.maxBackups);

            for (const backup of filesToDelete) {
                try {
                    await this.backupStorage.deleteFile(backup.filename);
                    logger.info(`[DataBackupService] 删除旧备份: ${backup.filename}`);
                } catch (error) {
                    logger.warn(`[DataBackupService] 删除旧备份失败 [${backup.filename}]: ${error.message}`);
                }
            }

            logger.info(`[DataBackupService] 清理完成，删除了 ${filesToDelete.length} 个旧备份文件`);
        } catch (error) {
            logger.error(`[DataBackupService] 清理旧备份失败: ${error.message}`);
        }
    }

    /**
     * 私有方法：延迟执行
     * @param {number} ms 毫秒数
     * @returns {Promise} Promise对象
     * @private
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 获取服务状态
     * @returns {Object} 服务状态信息
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            config: this.backupConfig,
            nextBackupTime: this.backupTimer ? new Date(Date.now() + this.backupConfig.interval) : null
        };
    }
}

export default DataBackupService; 