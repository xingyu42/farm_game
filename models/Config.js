import YAML from "yaml"
import chokidar from "chokidar"
import fs from "node:fs"
import _ from "lodash"
import cfg from "../../../lib/config/config.js"
import YamlReader from "./YamlReader.js"
import { PLUGIN_NAME, PLUGIN_PATH } from "./constants.js"

const Log_Prefix = `[${PLUGIN_NAME}插件]`

class Config {
  constructor(redis = null, logger = null) {
    this.redis = redis || global.redis;
    this.logger = logger || global.logger || console;
    this.config = {}

    /** 监听文件 */
    this.watcher = { config: {}, defSet: {} }

    this.initCfg()
  }

  /** 初始化配置 */
  initCfg() {
    let path = `${PLUGIN_PATH}/config/config/`
    let pathDef = `${PLUGIN_PATH}/config/default_config/`

    // 确保配置目录存在
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true })
    }

    // 确保默认配置目录存在
    if (!fs.existsSync(pathDef)) {
      fs.mkdirSync(pathDef, { recursive: true })
    }

    // 读取默认配置目录下的所有yaml文件
    if (fs.existsSync(pathDef)) {
      const files = fs.readdirSync(pathDef).filter(file => file.endsWith(".yaml"))
      for (let file of files) {
        if (!fs.existsSync(`${path}${file}`)) {
          fs.copyFileSync(`${pathDef}${file}`, `${path}${file}`)
        } else {
          // 安全检查：确保 other 配置可用且 autoMergeCfg 为 true
          try {
            const otherConfig = this.getDefOrConfig("other");
            if (otherConfig && otherConfig.autoMergeCfg) {
              this.mergeCfg(`${path}${file}`, `${pathDef}${file}`, file);
            }
          } catch (e) {
            // 如果获取配置失败，跳过自动合并
            this.logger && this.logger.warn(`${Log_Prefix}[跳过自动合并配置][${file}]：${e.message}`);
          }
        }
        this.watch(`${path}${file}`, file.replace(".yaml", ""), "config")
      }
    }
  }

  async mergeCfg(cfgPath, defPath, name) {
    try {
      // 默认文件未变化不合并
      let defData = fs.readFileSync(defPath, "utf8")
      let redisData = await this.redis.get(`werewolf:mergeCfg:${name}`)
      if (defData == redisData) return
      this.redis.set(`werewolf:mergeCfg:${name}`, defData)

      const userDoc = YAML.parseDocument(fs.readFileSync(cfgPath, "utf8"))
      const defDoc = YAML.parseDocument(defData)
      let isUpdate = false
      const merge = (user, def) => {
        const existingKeys = new Map()
        for (const item of user) {
          existingKeys.set(item.key.value, item.value)
        }
        for (const item of def) {
          if (item?.key?.commentBefore?.includes?.("noMerge")) continue
          if (!existingKeys.has(item.key.value)) {
            this.logger.info(`${Log_Prefix}[合并配置][${name}][${item.key.value}]`)
            user.push(item)
            isUpdate = true
          } else if (YAML.isMap(item.value)) {
            const userV = existingKeys.get(item.key.value).items
            merge(userV, item.value.items)
          }
        }
      }
      merge(userDoc.contents.items, defDoc.contents.items)
      let yaml = userDoc.toString()
      isUpdate && fs.writeFileSync(cfgPath, yaml, "utf8")
    } catch (e) {
      this.logger.error(`${Log_Prefix}[合并配置文件失败][${name}]：${e}`)
    }
  }

  /** 主人QQ */
  get masterQQ() {
    return cfg.masterQQ
  }

  get master() {
    return cfg.master
  }

  /** 获取主配置设置 */
  get config() {
    return this.getDefOrConfig("config")
  }

  /** 获取作物设置 */
  get crops() {
    return this.getDefOrConfig("crops")
  }

  /** 获取物品设置 */
  get items() {
    return this.getDefOrConfig("items")
  }

  /** 获取等级设置 */
  get levels() {
    return this.getDefOrConfig("levels")
  }

  /** 获取土地扩展设置 */
  get land_expansion() {
    return this.getDefOrConfig("land_expansion")
  }

  /** 获取土地质量设置 */
  get land_quality() {
    return this.getDefOrConfig("land_quality")
  }

  /**
   * 默认配置和用户配置
   * @param {string} name 配置名称
   */
  getDefOrConfig(name) {
    let def = this.getdefSet(name)
    let config = this.getConfig(name)
    function customizer(objValue, srcValue) {
      if (_.isArray(objValue)) {
        return srcValue
      }
    }
    return _.mergeWith({}, def, config, customizer)
  }

  /**
   * 默认配置
   * @param {string} name 配置名称
   */
  getdefSet(name) {
    return this.getYaml("default_config", name)
  }

  /**
   * 用户配置
   * @param {string} name 配置名称
   */
  getConfig(name) {
    return this.getYaml("config", name)
  }

  /**
   * 获取配置yaml
   * @param {string} type 默认配置-defSet，用户配置-config
   * @param {string} name 名称
   */
  getYaml(type, name) {
    let file = `${PLUGIN_PATH}/config/${type}/${name}.yaml`
    let key = `${type}.${name}`

    if (this.config[key]) return this.config[key]

    if (!fs.existsSync(file)) {
      return {}
    }

    try {
      this.config[key] = YAML.parse(
        fs.readFileSync(file, "utf8")
      )

      this.watch(file, name, type)

      return this.config[key]
    } catch (e) {
      this.logger.error(`${Log_Prefix}[读取配置文件失败][${type}][${name}]：${e}`)
      return {}
    }
  }

  /**
   * 监听配置文件
   * @param {string} file 文件路径
   * @param {string} name 配置名称
   * @param {string} type 配置类型
   */
  watch(file, name, type = "default_config") {
    let key = `${type}.${name}`

    if (this.watcher[key]) return

    // eslint-disable-next-line import/no-named-as-default-member
    const watcher = chokidar.watch(file)
    watcher.on("change", path => {
      delete this.config[key]
      if (typeof Bot == "undefined") return
      this.logger.mark(`${Log_Prefix}[修改配置文件][${type}][${name}]`)
      if (this[`change_${name}`]) {
        this[`change_${name}`]()
      }
    })

    this.watcher[key] = watcher
  }

  /**
   * 修改设置
   * @param {string} name 文件名
   * @param {string} key 修改的key值
   * @param {string | number} value 修改的value值
   * @param {'config'|'default_config'} type 配置文件或默认
   * @param {boolean} bot 是否修改Bot的配置
   * @param {string} comment 注释
   */
  modify(name, key, value, type = "config", bot = false, comment = null) {
    let path = `${bot ? process.cwd() : PLUGIN_PATH}/config/${type}/${name}.yaml`

    // 确保目录存在
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // 确保文件存在
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path, "", "utf8")
    }
    
    try {
      new YamlReader(path).set(key, value, comment)
    } catch (e) {
      this.logger.error(`${Log_Prefix}[修改配置文件失败][${name}]：${e}`)
      return false
    }

    delete this.config[`${type}.${name}`]
    return true
  }

  /**
   * 删除配置项
   * @param {string} name 文件名
   * @param {string} key 要删除的key
   * @param {'config'|'default_config'} type 配置文件或默认
   * @param {boolean} bot 是否修改Bot的配置
   */
  deleteKey(name, key, type = "config", bot = false) {
    let path = `${bot ? process.cwd() : PLUGIN_PATH}/config/${type}/${name}.yaml`
    if (!fs.existsSync(path)) return false

    try {
      new YamlReader(path).deleteKey(key)
    } catch (e) {
      this.logger.error(`${Log_Prefix}[删除配置文件键失败][${name}]：${e}`)
      return false
    }
    
    delete this.config[`${type}.${name}`]
    return true
  }

  /**
   * 修改配置数组
   * @param {string} name 文件名
   * @param {string} key key值
   * @param {string | number} value value
   * @param {'add'|'del'} category 类别 add or del
   * @param {'config'|'default_config'} type 配置文件或默认
   * @param {boolean} bot 是否修改Bot的配置
   */
  modifyArr(name, key, value, category = "add", type = "config", bot = false) {
    let path = `${bot ? process.cwd() : PLUGIN_PATH}/config/${type}/${name}.yaml`

    // 确保目录存在
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // 确保文件存在
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path, "", "utf8")
    }

    let yaml = new YamlReader(path)
    if (category == "add") {
      yaml.addIn(key, value)
    } else {
      let arr = yaml.get(key)
      if (Array.isArray(arr)) {
        let index = arr.indexOf(value)
        if (index !== -1) {
          yaml.delete(`${key}.${index}`)
        }
      }
    }
    delete this.config[`${type}.${name}`]
    return true
  }

}

// 导出类和默认实例
export default new Config()
