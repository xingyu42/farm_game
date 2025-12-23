/**
 * @fileoverview 数据工具 - 配置加载与动态模块导入
 *
 * Input:
 * - node:fs - 文件系统操作
 * - ./constants.js - 路径常量 (_path, PLUGIN_NAME)
 *
 * Output:
 * - Data (default) - 数据工具对象,提供:
 *   - importConfig: 加载系统配置与用户自定义配置
 *   - importModule: 动态导入JS模块
 *
 * Pos: 模型层工具类,负责配置文件和动态模块的运行时加载
 */
import fs from 'fs'
import { _path, PLUGIN_NAME } from './constants.js'

const getRoot = (root = '') => {
  if (root === 'root' || root === 'yunzai') {
    root = `${_path}/`
  } else if (!root) {
    root = `${_path}/plugins/${PLUGIN_NAME}/`
  }
  return root
}

let Data = {
  async importConfig(key) {
    let sysCfg = await Data.importModule(`config/system/${key}_system.js`)
    let diyCfg = await Data.importModule(`config/${key}.js`)
    if (diyCfg.isSys) {
      console.error(`${key}配置无效，已忽略`)
      console.error(`如需配置请复制config/${key}_default.js为config/${key}.js，请勿复制config/system下的系统文件`)
      diyCfg = {}
    }
    return {
      sysCfg,
      diyCfg
    }
  },
  async importModule(file, root = '') {
    root = getRoot(root)
    if (!/\.js$/.test(file)) {
      file = file + '.js'
    }
    if (fs.existsSync(`${root}/${file}`)) {
      try {
        let data = await import(`file://${root}/${file}?t=${new Date() * 1}`)
        return data || {}
      } catch (e) {
        console.log(e)
      }
    }
    return {}
  }
}

export default Data