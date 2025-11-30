import puppeteer from 'puppeteer'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import Renderer from '../../../lib/renderer/loader.js'
import { _path, PLUGIN_NAME } from '../models/constants.js'

const renderer = Renderer.getRenderer()

/**
 *  Puppeteer 管理器
 * 负责浏览器实例管理和渲染功能
 */
class Puppeteer {
  constructor(logger) {
    this.browser = null
    this.lock = false
    this.shoting = []
    this.logger = logger
    /** 截图数达到时重启浏览器 避免生成速度越来越慢 */
    this.restartNum = 100
    /** 截图次数 */
    this.renderNum = 0
    /** 重启锁，防止竞态条件 */
    this.restartLock = false
    this.config = {
      executablePath: '',
      puppeteerWS: '',
      headless: 'new',
      args: [
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--no-zygote',
        '--font-render-hinting=medium',
        '--disable-application-cache',
        '--disable-dev-shm-usage', // 禁用/dev/shm使用
        '--disable-extensions', // 禁用扩展
        '--disable-infobars', // 禁用信息栏
        '--disable-notifications', // 禁用通知
        '--disable-offline-load-stale-cache', // 禁用离线加载过期缓存
        '--dns-prefetch-disable', // 禁用DNS预取
        '--enable-features=NetworkService', // 启用网络服务特性
        '--enable-automation' // 启用自动化
      ]
    }
  }

  /**
   * 初始化浏览器实例
   * @returns {Promise<boolean|object>} 浏览器实例或失败状态
   */
  async browserInit() {
    if (this.browser) return this.browser
    if (this.lock) return false
    this.lock = true

    const maxRetries = 3
    let retryCount = 0

    this.logger.mark('[农场游戏] Puppeteer 启动中...')

    while (retryCount < maxRetries) {
      try {
        // 尝试连接已存在的浏览器实例
        const browserURL = 'http://127.0.0.1:51777'
        this.browser = await puppeteer.connect({
          browserURL,
          timeout: 10000 // 10秒超时
        })
        break
      } catch (connectError) {
        this.logger.debug(`连接现有浏览器失败 (尝试 ${retryCount + 1}/${maxRetries}): ${connectError.message}`)

        // 连接失败，启动新的浏览器实例
        this.browser = await puppeteer.launch({
          ...this.config,
          timeout: 30000 // 30秒启动超时
        })
        break

      }
    }

    this.lock = false

    if (!this.browser) {
      this.logger.error('[农场游戏] Puppeteer 启动失败，已达到最大重试次数')
      // 优雅降级：返回一个模拟对象，避免后续调用出错
      return this._createFallbackBrowser()
    }

    this.logger.mark('[农场游戏] Puppeteer 启动成功')

    /** 监听Chromium实例是否断开 */
    this.browser.on('disconnected', () => {
      this.logger.info('[农场游戏] Chromium实例关闭或崩溃！')
      this.browser = null
    })

    // 监听错误事件
    this.browser.on('error', (error) => {
      this.logger.error('[农场游戏] 浏览器错误:', error)
    })

    return this.browser
  }

  /**
   * 创建降级浏览器对象，当真实浏览器启动失败时使用
   * @private
   */
  _createFallbackBrowser() {
    this.logger.warn('[农场游戏] 使用降级模式，部分功能可能不可用')
    return {
      newPage: async () => {
        this.logger.warn('[农场游戏] 降级模式：无法创建页面')
        return false
      },
      close: async () => {
        this.logger.debug('[农场游戏] 降级模式：关闭操作已忽略')
      },
      on: () => {
        // 空实现，避免事件监听器报错
      }
    }
  }

  /**
   * 创建新页面
   * @returns {Promise<Page>} 页面实例
   */
  async newPage() {
    if (!(await this.browserInit())) {
      return false
    }
    return await this.browser.newPage().catch((err) => {
      this.logger.error('[农场游戏] 创建页面失败：' + err)
      return false
    })
  }

  /**
   * 关闭页面
   * @param {Page} page 页面实例
   */
  async closePage(page) {
    if (page && typeof page.close === 'function') {
      try {
        // 先移除页面事件监听器，防止内存泄漏
        if (typeof page.removeAllListeners === 'function') {
          page.removeAllListeners()
        }

        // 关闭页面
        await page.close()
        this.renderNum += 1

        // 检查是否需要重启浏览器
        this.restart()
      } catch (err) {
        this.logger.error('[农场游戏] 页面关闭出错：' + err)

        // 页面关闭失败时，强制标记为已关闭
        try {
          if (page.isClosed && !page.isClosed()) {
            this.logger.warn('[农场游戏] 页面关闭失败，但继续处理')
          }
        } catch (checkError) {
          this.logger.debug('[农场游戏] 无法检查页面状态:', checkError.message)
        }

        this.renderNum += 1
        this.restart()
      }
    }
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      try {
        // 获取所有页面并关闭
        const pages = await this.browser.pages()
        for (const page of pages) {
          try {
            if (!page.isClosed()) {
              await page.close()
            }
          } catch (pageError) {
            this.logger.debug('[农场游戏] 关闭页面时出错:', pageError.message)
          }
        }

        // 移除浏览器事件监听器
        if (typeof this.browser.removeAllListeners === 'function') {
          this.browser.removeAllListeners()
        }

        // 关闭浏览器
        await this.browser.close()
        this.logger.info('[农场游戏] 浏览器已正常关闭')
      } catch (err) {
        this.logger.error('[农场游戏] 浏览器关闭出错：' + err)

        // 强制断开连接
        try {
          if (typeof this.browser.disconnect === 'function') {
            this.browser.disconnect()
          }
        } catch (disconnectError) {
          this.logger.debug('[农场游戏] 断开浏览器连接时出错:', disconnectError.message)
        }
      } finally {
        this.browser = null
        this.renderNum = 0 // 重置渲染计数
      }
    }
  }

  /**
   * 重启浏览器（当截图次数达到阈值时）
   */
  restart() {
    /** 截图超过重启数时，自动关闭重启浏览器，避免生成速度越来越慢 */
    if (this.renderNum % this.restartNum === 0) {
      if (this.shoting.length <= 0 && !this.restartLock) {
        this.restartLock = true // 设置重启锁

        setTimeout(async () => {
          try {
            this.logger.mark('[农场游戏] Puppeteer 开始重启...')
            await this.close()
            this.logger.mark('[农场游戏] Puppeteer 重启完成')
          } catch (error) {
            this.logger.error('[农场游戏] Puppeteer 重启失败:', error)
          } finally {
            this.restartLock = false // 释放重启锁
          }
        }, 100)
      }
    }
  }

  /**
   * 渲染HTML模板
   * @param {string} tplPath 模板路径，相对于plugin resources目录
   * @param {Object} data 渲染数据
   * @param {Object} cfg 渲染配置
   * @returns {Promise<string|boolean>} base64 截图或false
   */
  async render(tplPath, data = {}, cfg = {}, userId) {
    this.shoting.push(true)
    try {
      // 处理传入的path
      tplPath = tplPath.replace(/.html$/, '')
      let paths = _.filter(tplPath.split('/'), (p) => !!p)
      tplPath = paths.join('/')
      let { e, scale = 1.6 } = cfg

      // 创建临时目录
      const tempDir = path.join(_path, 'temp', 'html', PLUGIN_NAME, tplPath)
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      // 计算资源路径
      let pluResPath = `../../../${_.repeat('../', paths.length)}plugins/${PLUGIN_NAME}/resources/`

      // 渲染数据
      data = {
        sys: {
          scale
        },
        _plugin: PLUGIN_NAME,
        _htmlPath: tplPath,
        pluResPath,
        tplFile: `./plugins/${PLUGIN_NAME}/resources/${tplPath}.html`,
        saveId: data.saveId || data.save_id || paths[paths.length - 1],

        // 截图参数
        imgType: 'png',
        quality: 100, // 图片质量
        omitBackground: false,
        pageGotoParams: {
          waitUntil: 'networkidle0'
        },

        ...data
      }

      // 处理beforeRender回调
      if (cfg.beforeRender) {
        data = cfg.beforeRender({ data }) || data
      }

      // 调用渲染器进行截图
      let base64 = await renderer.screenshot(`${PLUGIN_NAME}/${tplPath}`, data)
      let ret = true
      if (base64) {
        ret = userId ? await e.bot.sendPrivateMsg(userId, base64) : await e.reply(base64)
      }
      return ret || true
    } finally {
      this.shoting.pop()
    }
  }
}

export default Puppeteer
