import fs from "node:fs"
import YAML from "yaml"
import _ from "lodash"

/**
 * YAML读取和修改工具类
 */
class YamlReader {
  /**
   * 构造函数
   * @param {string} path YAML文件路径
   */
  constructor(path) {
    this.path = path
    this.document = YAML.parseDocument(fs.readFileSync(path, "utf8") || "{}")
    this.data = this.document.toJSON()
  }

  /**
   * 获取指定路径的值
   * @param {string} path 路径，使用.分隔
   * @returns {any} 值
   */
  get(path) {
    return _.get(this.data, path)
  }

  /**
   * 设置指定路径的值
   * @param {string} path 路径，使用.分隔
   * @param {any} value 值
   * @param {string} comment 注释
   * @returns {boolean} 是否成功
   */
  set(path, value, comment = "") {
    if (path == "") {
      this.document = YAML.parseDocument(YAML.stringify(value))
      this.data = value
    } else {
      let paths = path.split(".")
      let last = paths.pop()
      let doc = this.document
      for (let p of paths) {
        if (!doc.has(p)) {
          doc.set(p, {})
        }
        doc = doc.get(p)
      }
      doc.set(last, value)
      if (comment) {
        doc.get(last).commentBefore = comment
      }
      this.data = this.document.toJSON()
    }
    this.save()
    return true
  }

  /**
   * 删除指定路径的值
   * @param {string} path 路径，使用.分隔
   * @returns {boolean} 是否成功
   */
  delete(path) {
    if (path == "") {
      this.document = YAML.parseDocument("")
      this.data = {}
    } else {
      let paths = path.split(".")
      let last = paths.pop()
      let doc = this.document
      for (let p of paths) {
        if (!doc.has(p)) {
          return false
        }
        doc = doc.get(p)
      }
      if (doc.has(last)) {
        doc.delete(last)
        this.data = this.document.toJSON()
      } else {
        return false
      }
    }
    this.save()
    return true
  }

  /**
   * 删除指定键
   * @param {string} path 路径，使用.分隔
   * @returns {boolean} 是否成功
   */
  deleteKey(path) {
    return this.delete(path)
  }

  /**
   * 向数组添加元素
   * @param {string} path 数组路径，使用.分隔
   * @param {any} value 要添加的值
   * @returns {boolean} 是否成功
   */
  addIn(path, value) {
    let arr = this.get(path)
    if (!arr) {
      this.set(path, [value])
    } else if (Array.isArray(arr)) {
      if (!arr.includes(value)) {
        arr.push(value)
        this.set(path, arr)
      }
    } else {
      return false
    }
    return true
  }

  /**
   * 从数组中移除元素
   * @param {string} path 数组路径，使用.分隔
   * @param {any} value 要移除的值
   * @returns {boolean} 是否成功
   */
  delFrom(path, value) {
    let arr = this.get(path)
    if (Array.isArray(arr)) {
      let index = arr.indexOf(value)
      if (index !== -1) {
        arr.splice(index, 1)
        this.set(path, arr)
        return true
      }
    }
    return false
  }

  /**
   * 保存文件
   */
  save() {
    let yaml = this.document.toString()
    fs.writeFileSync(this.path, yaml, "utf8")
  }
}

export default YamlReader
