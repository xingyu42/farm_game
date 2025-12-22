/**
 * @fileoverview 服务聚合模块 - 常用服务快捷导出
 *
 * Input:
 * - ./Data.js - 数据工具对象
 * - ./puppeteer.js - Puppeteer 图片渲染引擎
 * - global.logger - Yunzai 框架日志对象
 *
 * Output:
 * - Data - 数据工具对象 (配置导入)
 * - Puppeteer - Puppeteer 实例 (Vue 组件图片渲染)
 *
 * Pos: 模型层服务聚合,为应用层提供常用服务的统一导出
 */

import Data from './Data.js'
import Puppeteer from './puppeteer.js'

const puppeteer = new Puppeteer(logger)

export {
  Data,
  puppeteer as Puppeteer
}