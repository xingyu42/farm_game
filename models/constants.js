/**
 * @fileoverview 项目常量定义 - 路径和插件名称
 *
 * Input:
 * - path - Node.js 路径模块
 * - process.cwd() - 当前工作目录
 *
 * Output:
 * - _path - 项目根路径
 * - PLUGIN_NAME - 插件名称常量
 * - PLUGIN_PATH - 插件完整路径
 *
 * Pos: 模型层常量定义,被其他模块引用以获取路径信息
 */

import path from 'path'

const _path = process.cwd()
const PLUGIN_NAME = 'farm_game'
const PLUGIN_PATH = path.join(_path, 'plugins', PLUGIN_NAME)

export {
  _path,
  PLUGIN_NAME,
  PLUGIN_PATH
}
