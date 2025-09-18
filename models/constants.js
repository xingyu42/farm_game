import path from 'path'

const _path = process.cwd()
const PLUGIN_NAME = 'farm_game'
const PLUGIN_PATH = path.join(_path, 'plugins', PLUGIN_NAME)

export {
  _path,
  PLUGIN_NAME,
  PLUGIN_PATH
}
