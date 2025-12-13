import puppeteer from 'puppeteer'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
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
      headless: 'new',
      userDataDir: path.join(_path, 'temp', 'puppeteer_cache'),
      args: [
        '--disable-gpu',
        '--disable-extensions',
        '--no-sandbox',            // Docker/Linux 必需
        '--disable-setuid-sandbox', // Docker/Linux 必需
        '--disable-dev-shm-usage'  // Docker 必需（共享内存限制）
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

    this.logger.mark('[农场游戏] Puppeteer 启动中...')

    try {
      // 尝试连接已存在的浏览器实例
      const browserURL = 'http://127.0.0.1:51777'
      this.browser = await puppeteer.connect({
        browserURL,
        timeout: 10000
      })
    } catch (connectError) {
      this.logger.debug(`连接现有浏览器失败: ${connectError.message}`)
      // 连接失败，启动新的浏览器实例
      this.browser = await puppeteer.launch({
        ...this.config,
        timeout: 30000
      })
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
    if (!page || typeof page.close !== 'function') return

    try {
      // 检查页面是否已关闭
      if (page.isClosed && page.isClosed()) return

      page.removeAllListeners?.()
      await page.close()
    } catch {
      // 页面可能已被关闭，忽略错误
    } finally {
      this.renderNum += 1
      this.restart()
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
   * 渲染 Vue 模板（客户端渲染）
   * @param {string} tplPath 模板路径，相对于 plugin resources 目录
   * @param {Object} data 渲染数据，将注入为 window.FARM_DATA
   * @param {Object} cfg 渲染配置
   * @returns {Promise<boolean>} 是否成功
   */
  async renderVue(tplPath, data = {}, cfg = {}) {
    this.shoting.push(true)
    let page = null

    try {
      const { e, scale = 2.0 } = cfg
      const tplFile = path.join(_path, 'plugins', PLUGIN_NAME, 'resources', `${tplPath}.html`)

      if (!fs.existsSync(tplFile)) {
        this.logger.error(`[农场游戏] 模板文件不存在: ${tplFile}`)
        return false
      }

      page = await this.newPage()
      if (!page) return false

      // 在页面脚本执行前注入数据
      await page.evaluateOnNewDocument((d) => { window.FARM_DATA = d }, data)
      await page.setViewport({ width: 800, height: 600, deviceScaleFactor: scale })
      const tplUrl = pathToFileURL(tplFile).href
      await page.goto(tplUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // 注入 Emoji 字体支持
      const fontPath = path.join(_path, 'plugins', PLUGIN_NAME, 'resources', 'common', 'fonts', 'NotoColorEmoji.ttf')
      if (fs.existsSync(fontPath)) {
        const fontUrl = pathToFileURL(fontPath).href
        await page.addStyleTag({
          content: `
            @font-face {
              font-family: 'Emoji';
              src: url('${fontUrl}');
              unicode-range: U+10000-10FFFF;
            }
            body, * {
              font-family: 'Emoji', system-ui, -apple-system, sans-serif;
            }
          `
        })
        // 等待字体加载完成
        await page.evaluate(async () => {
          await document.fonts.load('16px "Noto Color Emoji"', '🌱🥕🍅')
          await document.fonts.ready
        }).catch(() => {
          this.logger.warn('[农场游戏] 等待字体加载超时')
        })
      } else {
        this.logger.warn('[农场游戏] Emoji 字体文件不存在，emoji 可能显示为方块')
      }

      // 等待 Vue 渲染完成
      await page.waitForSelector('body.ready', { timeout: 10000 }).catch(() => {
        this.logger.warn('[农场游戏] 等待 Vue 渲染超时，继续截图')
      })

      // 等待 iconify 图标加载（networkidle 更可靠）
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => {})

      const box = await page.$('#app').then(el => el?.boundingBox())
      if (!box) {
        this.logger.error('[农场游戏] #app 元素不存在或无布局')
        return false
      }

      const base64 = await page.screenshot({ encoding: 'base64', clip: box })
      if (e) await e.reply({ type: 'image', file: `base64://${base64}` })

      return true
    } catch (error) {
      this.logger.error('[农场游戏] Vue 渲染失败:', error)
      return false
    } finally {
      if (page) await this.closePage(page)
      this.shoting.pop()
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
      let pluPath = `../../../${_.repeat('../', paths.length)}plugins/${PLUGIN_NAME}/`

      // 渲染数据
      data = {
        sys: {
          scale
        },
        _plugin: PLUGIN_NAME,
        _htmlPath: tplPath,
        pluResPath,
        pluPath,
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
