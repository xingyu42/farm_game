// {{CHENGQI:
// Action: Added; Timestamp: 2025-01-30; Reason: Shrimp Task ID: #ab881598-451c-498e-9305-7566f7991892, Creating file storage utility as per PRD 6.2 structure;
// }}
// {{START MODIFICATIONS}}

import fs from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 文件存储操作工具类
 * 提供统一的文件读写接口，支持JSON数据持久化
 */
export class FileStorage {
  constructor(baseDir = 'data') {
    this.baseDir = join(dirname(__dirname), baseDir)
    this.init()
  }

  /**
   * 初始化存储目录
   */
  async init() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true })
    } catch (error) {
      logger.error('[FileStorage] 初始化存储目录失败:', error)
    }
  }

  /**
   * 读取JSON文件
   * @param {string} filename 文件名
   * @param {any} defaultValue 默认值
   * @returns {Promise<any>}
   */
  async readJSON(filename, defaultValue = null) {
    try {
      const filePath = join(this.baseDir, filename)
      const data = await fs.readFile(filePath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return defaultValue
      }
      logger.error(`[FileStorage] 读取文件失败 ${filename}:`, error)
      return defaultValue
    }
  }

  /**
   * 写入JSON文件
   * @param {string} filename 文件名
   * @param {any} data 数据
   * @returns {Promise<boolean>}
   */
  async writeJSON(filename, data) {
    try {
      const filePath = join(this.baseDir, filename)
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
      return true
    } catch (error) {
      logger.error(`[FileStorage] 写入文件失败 ${filename}:`, error)
      return false
    }
  }

  /**
   * 删除文件
   * @param {string} filename 文件名
   * @returns {Promise<boolean>}
   */
  async deleteFile(filename) {
    try {
      const filePath = join(this.baseDir, filename)
      await fs.unlink(filePath)
      return true
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true // 文件不存在，视为删除成功
      }
      logger.error(`[FileStorage] 删除文件失败 ${filename}:`, error)
      return false
    }
  }

  /**
   * 检查文件是否存在
   * @param {string} filename 文件名
   * @returns {Promise<boolean>}
   */
  async exists(filename) {
    try {
      const filePath = join(this.baseDir, filename)
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取文件列表
   * @param {string} pattern 文件模式 (可选)
   * @returns {Promise<string[]>}
   */
  async listFiles(pattern = null) {
    try {
      const files = await fs.readdir(this.baseDir)
      if (pattern) {
        const regex = new RegExp(pattern)
        return files.filter(file => regex.test(file))
      }
      return files
    } catch (error) {
      logger.error('[FileStorage] 获取文件列表失败:', error)
      return []
    }
  }

  /**
   * 备份文件
   * @param {string} filename 原文件名
   * @param {string} backupSuffix 备份后缀
   * @returns {Promise<boolean>}
   */
  async backup(filename, backupSuffix = '.bak') {
    try {
      const sourcePath = join(this.baseDir, filename)
      const backupPath = join(this.baseDir, filename + backupSuffix)
      
      const data = await fs.readFile(sourcePath)
      await fs.writeFile(backupPath, data)
      return true
    } catch (error) {
      logger.error(`[FileStorage] 备份文件失败 ${filename}:`, error)
      return false
    }
  }
}

// 创建默认实例
export const fileStorage = new FileStorage()

// {{END MODIFICATIONS}} 