/**
 * 玩家 YAML 存储工具类
 * 用于长周期玩家数据的 YAML 文件读写操作
 * 存储目录：data/players/
 */

import { FileStorage } from './fileStorage.js'

/**
 * 玩家 YAML 存储工具类
 * 专门处理玩家长周期数据的 YAML 持久化
 */
export class PlayerYamlStorage {
    constructor() {
        // 创建专门用于玩家数据的 FileStorage 实例
        this.fileStorage = new FileStorage('data/players')
    }

    /**
     * 读取玩家 YAML 数据
     * @param {string} userId 用户ID
     * @param {Object} defaultValue 默认值，如果文件不存在则返回此值
     * @returns {Promise<Object|null>} 玩家数据对象
     */
    async readPlayer(userId, defaultValue = null) {
        try {
            const filename = `${userId}.yaml`
            return await this.fileStorage.readYAML(filename, defaultValue)
        } catch (error) {
            logger.error(`[PlayerYamlStorage] 读取玩家数据失败 [${userId}]:`, error)
            throw new Error(`Failed to read player YAML data for ${userId}: ${error.message}`, { cause: error })
        }
    }

    /**
     * 写入玩家 YAML 数据
     * @param {string} userId 用户ID
     * @param {Object} data 玩家数据对象
     * @returns {Promise<boolean>} 写入是否成功
     */
    async writePlayer(userId, data) {
        try {
            const filename = `${userId}.yaml`
            return await this.fileStorage.writeYAML(filename, data)
        } catch (error) {
            logger.error(`[PlayerYamlStorage] 写入玩家数据失败 [${userId}]:`, error)
            throw new Error(`Failed to write player YAML data for ${userId}: ${error.message}`, { cause: error })
        }
    }

    /**
     * 检查玩家 YAML 文件是否存在
     * @param {string} userId 用户ID
     * @returns {Promise<boolean>} 文件是否存在
     */
    async playerExists(userId) {
        try {
            const filename = `${userId}.yaml`
            return await this.fileStorage.exists(filename)
        } catch (error) {
            logger.error(`[PlayerYamlStorage] 检查玩家文件存在失败 [${userId}]:`, error)
            return false
        }
    }

    /**
     * 删除玩家 YAML 文件
     * @param {string} userId 用户ID
     * @returns {Promise<boolean>} 删除是否成功
     */
    async deletePlayer(userId) {
        try {
            const filename = `${userId}.yaml`
            return await this.fileStorage.deleteFile(filename)
        } catch (error) {
            logger.error(`[PlayerYamlStorage] 删除玩家文件失败 [${userId}]:`, error)
            return false
        }
    }

    /**
     * 列出所有玩家 YAML 文件
     * @returns {Promise<string[]>} 用户ID列表
     */
    async listAllPlayers() {
        try {
            const files = await this.fileStorage.listFiles('\\.yaml$')
            // 移除 .yaml 扩展名，返回纯用户ID列表
            return files.map(filename => filename.replace(/\.yaml$/, ''))
        } catch (error) {
            logger.error('[PlayerYamlStorage] 列出玩家文件失败:', error)
            return []
        }
    }

    /**
     * 备份玩家 YAML 文件
     * @param {string} userId 用户ID
     * @param {string} backupSuffix 备份后缀，默认为当前时间戳
     * @returns {Promise<boolean>} 备份是否成功
     */
    async backupPlayer(userId, backupSuffix = null) {
        try {
            const filename = `${userId}.yaml`
            const suffix = backupSuffix || `.${Date.now()}.bak`
            return await this.fileStorage.backup(filename, suffix)
        } catch (error) {
            logger.error(`[PlayerYamlStorage] 备份玩家文件失败 [${userId}]:`, error)
            return false
        }
    }
}

// 创建默认实例
export const playerYamlStorage = new PlayerYamlStorage() 