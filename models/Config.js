import YAML from 'yaml';
import chokidar from 'chokidar';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';

// 项目常量
const PLUGIN_NAME = 'farm_game';
const PROJECT_PATH = process.cwd();

class Config {
  constructor(redis = null, logger = null) {
    this.redis = redis || global.redis;
    this.logger = logger || console;
    this._configCache = {};

    /** 监听文件 */
    this.watcher = { config: {}, defSet: {} };

    this.initCfg();
  }

  /** 初始化配置 */
  initCfg() {
    try {
      let configPath = path.join(PROJECT_PATH, 'config', 'config');
      let defaultPath = path.join(PROJECT_PATH, 'config', 'default_config');

      // 确保配置目录存在
      if (!fs.existsSync(configPath)) {
        fs.mkdirSync(configPath, { recursive: true });
      }

      // 确保默认配置目录存在
      if (!fs.existsSync(defaultPath)) {
        fs.mkdirSync(defaultPath, { recursive: true });
      }

      // 读取默认配置目录下的所有yaml文件
      if (fs.existsSync(defaultPath)) {
        const files = fs.readdirSync(defaultPath).filter(file => file.endsWith('.yaml'));
        for (let file of files) {
          try {
            const configFile = path.join(configPath, file);
            const defaultFile = path.join(defaultPath, file);

            // 如果config目录下没有对应文件，从default_config复制
            if (!fs.existsSync(configFile)) {
              fs.copyFileSync(defaultFile, configFile);
              console.log(`[Config] 复制默认配置文件: ${file}`);
            }

            // 监听配置文件变化
            this.watch(configFile, file.replace('.yaml', ''), 'config');
          } catch (fileError) {
            console.error(`[Config] 处理配置文件失败 [${file}]: ${fileError.message}`);
            // 继续处理其他文件，不中断整个初始化过程
          }
        }
      }
    } catch (error) {
      console.error(`[Config] 初始化配置失败: ${error.message}`);
      // 配置初始化失败不应该导致整个应用崩溃
      // 可以使用默认配置继续运行
    }
  }

  /** 获取主配置设置 */
  get config() {
    return this.getDefOrConfig('config');
  }

  /** 获取作物设置 */
  get crops() {
    return this.getDefOrConfig('crops');
  }

  /** 获取物品设置 */
  get items() {
    return this.getDefOrConfig('items');
  }

  /** 获取等级设置 */
  get levels() {
    return this.getDefOrConfig('levels');
  }

  /** 获取土地设置 */
  get land() {
    return this.getDefOrConfig('land');
  }

  /** 获取偷窃设置 */
  get steal() {
    return this.getDefOrConfig('steal');
  }

  /**
   * 默认配置和用户配置
   * @param {string} name 配置名称
   */
  getDefOrConfig(name) {
    let def = this.getdefSet(name);
    let config = this.getConfig(name);
    function customizer(objValue, srcValue) {
      if (_.isArray(objValue)) {
        return srcValue;
      }
    }
    return _.mergeWith({}, def, config, customizer);
  }

  /**
   * 默认配置
   * @param {string} name 配置名称
   */
  getdefSet(name) {
    return this.getYaml('default_config', name);
  }

  /**
   * 用户配置
   * @param {string} name 配置名称
   */
  getConfig(name) {
    return this.getYaml('config', name);
  }

  /**
   * 获取配置yaml
   * @param {string} type 默认配置-default_config，用户配置-config
   * @param {string} name 名称
   */
  getYaml(type, name) {
    let file = path.join(PROJECT_PATH, 'config', type, `${name}.yaml`);
    let key = `${type}.${name}`;

    if (this._configCache[key]) return this._configCache[key];

    if (!fs.existsSync(file)) {
      return {};
    }

    try {
      this._configCache[key] = YAML.parse(
        fs.readFileSync(file, 'utf8')
      );

      this.watch(file, name, type);

      return this._configCache[key];
    } catch (e) {
      this.logger.error(`[${PLUGIN_NAME}][读取配置文件失败][${type}][${name}]：${e}`);
      return {};
    }
  }

  /**
   * 监听配置文件
   * @param {string} file 文件路径
   * @param {string} name 配置名称
   * @param {string} type 配置类型
   */
  watch(file, name, type = 'default_config') {
    let key = `${type}.${name}`;

    if (this.watcher[key]) return;

    const watcher = chokidar.watch(file);
    watcher.on('change', _path => {
      delete this._configCache[key];
      this.logger.info(`[${PLUGIN_NAME}][修改配置文件][${type}][${name}]`);
      if (this[`change_${name}`]) {
        this[`change_${name}`]();
      }
    });

    this.watcher[key] = watcher;
  }

  /**
   * 修改设置
   * @param {string} name 文件名
   * @param {string} key 修改的key值
   * @param {string | number} value 修改的value值
   * @param {'config'|'default_config'} type 配置文件或默认
   * @param {string} comment 注释
   */
  modify(name, key, value, type = 'config', comment = null) {
    let filePath = path.join(PROJECT_PATH, 'config', type, `${name}.yaml`);

    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 确保文件存在
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
    
    try {
      // 简化版本：直接使用YAML操作
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = YAML.parseDocument(content);
      
      // 设置值
      doc.setIn(key.split('.'), value);
      
      fs.writeFileSync(filePath, doc.toString(), 'utf8');
    } catch (e) {
      this.logger.error(`[${PLUGIN_NAME}][修改配置文件失败][${name}]：${e}`);
      return false;
    }

    delete this._configCache[`${type}.${name}`];
    return true;
  }

  /**
   * 删除配置项
   * @param {string} name 文件名
   * @param {string} key 要删除的key
   * @param {'config'|'default_config'} type 配置文件或默认
   */
  deleteKey(name, key, type = 'config') {
    let filePath = path.join(PROJECT_PATH, 'config', type, `${name}.yaml`);
    if (!fs.existsSync(filePath)) return false;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = YAML.parseDocument(content);
      
      // 删除键
      doc.deleteIn(key.split('.'));
      
      fs.writeFileSync(filePath, doc.toString(), 'utf8');
    } catch (e) {
      this.logger.error(`[${PLUGIN_NAME}][删除配置文件键失败][${name}]：${e}`);
      return false;
    }
    
    delete this._configCache[`${type}.${name}`];
    return true;
  }
}

// 导出类和默认实例
export default new Config();
