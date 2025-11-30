// {{CHENGQI:
// Action: Added; Timestamp: 2025-01-30; Reason: Shrimp Task ID: #ab881598-451c-498e-9305-7566f7991892, Creating file storage utility as per PRD 6.2 structure;
// }}
// {{START MODIFICATIONS}}

/**
 * 文件存储操作工具类
 * 提供统一的文件读写接口，支持JSON和YAML数据持久化
 * 
 * 这是一个文件存储工具类，包含：
 * - 统一的文件读写接口
 * - JSON和YAML数据持久化支持
 * - 目录管理功能
 * - 异步文件操作
 * 
 * 当前状态：完全未使用，创建时间：2025-01-30
 * 建议：可用于配置文件管理、数据备份等场景
 */

import fs from 'node:fs/promises'
import path, { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 注意：logger 是 Miao-Yunzai 框架提供的全局变量，无需导入

/**
 * 文件存储操作工具类
 * 提供统一的文件读写接口，支持JSON和YAML数据持久化
 */
export class FileStorage {
  constructor(baseDir = 'data') {
    // 如果是绝对路径，直接使用；否则相对于项目根目录
    if (path.isAbsolute(baseDir)) {
      this.baseDir = baseDir;
    } else {
      this.baseDir = join(dirname(__dirname), baseDir);
    }
    // 不在构造函数中调用异步init，让测试控制初始化时机
  }

  /**
   * 初始化存储目录
   */
  async init() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true })
    } catch (error) {
      logger.error(`[FileStorage] 初始化存储目录失败 ${this.baseDir}:`, error)
      // 保留原始错误堆栈跟踪
      throw new Error(`FileStorage initialization failed: ${error.message}`, { cause: error })
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
        logger.info(`[FileStorage] 文件不存在，返回默认值: ${filename}`)
        return defaultValue
      }
      logger.error(`[FileStorage] 读取文件失败 ${filename}:`, error)
      // 对于JSON解析错误，抛出异常而不是返回默认值，保留原始堆栈
      if (error instanceof SyntaxError) {
        throw new Error(`JSON parse error in file ${filename}: ${error.message}`, { cause: error })
      }
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
      const jsonData = JSON.stringify(data, null, 2)
      await fs.writeFile(filePath, jsonData, 'utf8')
      return true
    } catch (error) {
      logger.error(`[FileStorage] 写入文件失败 ${filename}:`, error)
      // 对于关键操作失败，抛出异常而不是静默返回false
      throw new Error(`Failed to write file ${filename}: ${error.message}`, { cause: error })
    }
  }

  /**
   * 读取YAML文件
   * @param {string} filename 文件名
   * @param {any} defaultValue 默认值
   * @returns {Promise<any>}
   */
  async readYAML(filename, defaultValue = null) {
    try {
      const filePath = join(this.baseDir, filename)
      const data = await fs.readFile(filePath, 'utf8')
      return yaml.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info(`[FileStorage] YAML文件不存在，返回默认值: ${filename}`)
        return defaultValue
      }
      logger.error(`[FileStorage] 读取YAML文件失败 ${filename}:`, error)
      // 对于YAML解析错误，抛出异常而不是返回默认值，保留原始堆栈
      if (error.name === 'YAMLParseError') {
        throw new Error(`YAML parse error in file ${filename}: ${error.message}`, { cause: error })
      }
      return defaultValue
    }
  }

  /**
   * 写入YAML文件
   * @param {string} filename 文件名
   * @param {any} data 数据
   * @returns {Promise<boolean>}
   */
  async writeYAML(filename, data) {
    try {
      const filePath = join(this.baseDir, filename)
      const yamlData = yaml.stringify(data, {
        indent: 2,
        lineWidth: 0,
        minContentWidth: 0
      })
      await fs.writeFile(filePath, yamlData, 'utf8')
      return true
    } catch (error) {
      logger.error(`[FileStorage] 写入YAML文件失败 ${filename}:`, error)
      // 对于关键操作失败，抛出异常而不是静默返回false
      throw new Error(`Failed to write YAML file ${filename}: ${error.message}`, { cause: error })
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
   * 重命名文件
   * @param {string} oldFilename 原文件名
   * @param {string} newFilename 新文件名
   * @returns {Promise<boolean>}
   */
  async rename(oldFilename, newFilename) {
    try {
      const oldPath = join(this.baseDir, oldFilename)
      const newPath = join(this.baseDir, newFilename)
      await fs.rename(oldPath, newPath)
      return true
    } catch (error) {
      logger.error(`[FileStorage] 重命名文件失败 ${oldFilename} -> ${newFilename}:`, error)
      throw new Error(`Failed to rename file ${oldFilename} to ${newFilename}: ${error.message}`, { cause: error })
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