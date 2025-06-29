/**
 * Redis客户端工具类
 * 提供Key生成、JSON处理、事务封装等核心功能
 */

const redis = require('redis');

class RedisClient {
  constructor() {
    // 在实际使用时，可以通过配置注入Redis连接
    this.client = null;
    this.keyPrefix = 'farm_game';
  }

  /**
   * 初始化Redis连接
   * @param {Object} config Redis配置
   */
  async init(config = {}) {
    if (!this.client) {
      this.client = redis.createClient(config);
      await this.client.connect();
    }
  }

  /**
   * 生成标准化的Redis Key
   * @param {string} type 数据类型 (player, land, inventory等)
   * @param {string} id 唯一标识符
   * @param {string} field 可选字段
   * @returns {string} 格式化的Key
   */
  generateKey(type, id, field = null) {
    const baseKey = `${this.keyPrefix}:${type}:${id}`;
    return field ? `${baseKey}:${field}` : baseKey;
  }

  /**
   * JSON序列化
   * @param {any} data 要序列化的数据
   * @returns {string} JSON字符串
   */
  serialize(data) {
    try {
      return JSON.stringify(data);
    } catch (error) {
      throw new Error(`Serialization failed: ${error.message}`);
    }
  }

  /**
   * JSON反序列化
   * @param {string} jsonStr JSON字符串
   * @returns {any} 反序列化的数据
   */
  deserialize(jsonStr) {
    try {
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch (error) {
      throw new Error(`Deserialization failed: ${error.message}`);
    }
  }

  /**
   * 执行Redis事务
   * @param {Function} transactionFn 事务函数，接收multi实例
   * @returns {Promise<any>} 事务执行结果
   */
  async transaction(transactionFn) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    const multi = this.client.multi();
    
    try {
      // 执行事务函数，传入multi实例
      await transactionFn(multi);
      
      // 执行事务
      const results = await multi.exec();
      return results;
    } catch (error) {
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  /**
   * 设置数据（自动JSON序列化）
   * @param {string} key Redis键
   * @param {any} value 要设置的值
   * @param {number} ttl 可选的过期时间（秒）
   */
  async set(key, value, ttl = null) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    const serializedValue = this.serialize(value);
    
    if (ttl) {
      await this.client.setEx(key, ttl, serializedValue);
    } else {
      await this.client.set(key, serializedValue);
    }
  }

  /**
   * 获取数据（自动JSON反序列化）
   * @param {string} key Redis键
   * @returns {any} 反序列化的数据
   */
  async get(key) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    const value = await this.client.get(key);
    return this.deserialize(value);
  }

  /**
   * 删除数据
   * @param {string} key Redis键
   */
  async del(key) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    return await this.client.del(key);
  }

  /**
   * 检查键是否存在
   * @param {string} key Redis键
   * @returns {boolean} 是否存在
   */
  async exists(key) {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    return (await this.client.exists(key)) === 1;
  }

  /**
   * 关闭连接
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

// 导出单例实例
module.exports = new RedisClient(); 