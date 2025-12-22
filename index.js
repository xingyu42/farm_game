/**
 * @fileoverview 农场游戏插件入口 - Miao-Yunzai 插件加载器
 *
 * Input:
 * - node:fs - 文件系统操作
 * - ./services/index.js - 服务容器 (ServiceContainer)
 * - ./apps/*.js - 所有应用指令处理器 (动态加载)
 * - oicq - QQ机器人消息段构造器
 *
 * Output:
 * - apps - 所有已加载的应用指令处理器映射表
 *
 * Pos: 项目根入口,负责初始化服务容器并动态加载所有应用层指令处理器
 */
import fs from 'node:fs'
import serviceContainer from './services/index.js';

if (!global.segment) {
  global.segment = (await import("oicq")).segment
}

const files = fs.readdirSync('./plugins/farm_game/apps').filter(file => file.endsWith('.js'))

let ret = []

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')

  if (ret[i].status != 'fulfilled') {
    logger.error(`载入插件错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}
logger.info(logger.green(`- 农场游戏插件载入成功 -`))

// 初始化服务
await serviceContainer.init();
logger.info('[农场游戏] 服务初始化完成')

export { apps }