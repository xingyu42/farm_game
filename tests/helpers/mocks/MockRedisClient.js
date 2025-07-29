/**
 * 简化的MockRedisClient - 基础Redis模拟功能
 * 
 * 提供核心Redis操作的Mock实现，用于单元测试
 * 专注于基础功能，避免过度复杂化
 */
export class MockRedisClient {
  constructor(options = {}) {
    // 内存存储
    this.data = new Map();
    this.connected = false;
    this.subscriptions = new Map();

    // 基础配置
    this.host = options.host || 'localhost';
    this.port = options.port || 6379;
    this.db = options.db || 0;

    console.log('MockRedisClient: 创建Mock Redis客户端');
  }

  /**
   * 模拟连接Redis
   */
  async connect() {
    this.connected = true;
    console.log('MockRedisClient: 已连接到Mock Redis');
    return Promise.resolve();
  }

  /**
   * 模拟断开连接
   */
  async disconnect() {
    this.connected = false;
    this.data.clear();
    this.subscriptions.clear();
    console.log('MockRedisClient: 已断开Mock Redis连接');
    return Promise.resolve();
  }

  /**
   * 检查连接状态
   */
  isConnected() {
    return this.connected;
  }

  /**
   * 模拟SET操作
   */
  async set(key, value, options = {}) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    this.data.set(key, stringValue);

    // 如果设置了过期时间
    if (options.EX || options.ex) {
      const ttl = options.EX || options.ex;
      setTimeout(() => {
        this.data.delete(key);
      }, ttl * 1000);
    }

    return 'OK';
  }

  /**
   * 模拟GET操作
   */
  async get(key) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    return this.data.get(key) || null;
  }

  /**
   * 模拟DEL操作
   */
  async del(...keys) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    let deletedCount = 0;
    keys.forEach(key => {
      if (this.data.has(key)) {
        this.data.delete(key);
        deletedCount++;
      }
    });

    return deletedCount;
  }

  /**
   * 模拟EXISTS操作
   */
  async exists(...keys) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    return keys.filter(key => this.data.has(key)).length;
  }

  /**
   * 模拟KEYS操作
   */
  async keys(pattern = '*') {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    const allKeys = Array.from(this.data.keys());

    // 简单的通配符匹配
    if (pattern === '*') {
      return allKeys;
    }

    // 将Redis通配符转换为正则表达式
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);

    return allKeys.filter(key => regex.test(key));
  }

  /**
   * 模拟FLUSHALL操作
   */
  async flushall() {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    this.data.clear();
    return 'OK';
  }

  /**
   * 模拟FLUSHDB操作
   */
  async flushdb() {
    return this.flushall();
  }

  /**
   * 模拟HSET操作 - 支持单个字段或对象形式
   */
  async hset(key, fieldOrObject, value) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    if (!this.data.has(key)) {
      this.data.set(key, new Map());
    }

    const hash = this.data.get(key);
    if (!(hash instanceof Map)) {
      this.data.set(key, new Map());
    }

    const hashMap = this.data.get(key);
    let newFieldsCount = 0;

    // 支持对象形式的批量设置
    if (typeof fieldOrObject === 'object' && fieldOrObject !== null && value === undefined) {
      for (const [field, val] of Object.entries(fieldOrObject)) {
        const isNewField = !hashMap.has(field);
        hashMap.set(field, val);
        if (isNewField) newFieldsCount++;
      }
      return newFieldsCount;
    } else {
      // 传统的单个字段设置
      const isNewField = !hashMap.has(fieldOrObject);
      hashMap.set(fieldOrObject, value);
      return isNewField ? 1 : 0;
    }
  }

  /**
   * 模拟HSET操作的别名 - 兼容新版Redis客户端
   */
  async hSet(key, fieldOrObject, value) {
    return this.hset(key, fieldOrObject, value);
  }

  /**
   * 模拟HGET操作
   */
  async hget(key, field) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    const hash = this.data.get(key);
    if (!(hash instanceof Map)) {
      return null;
    }

    return hash.get(field) || null;
  }

  /**
   * 模拟HGETALL操作
   */
  async hgetall(key) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    const hash = this.data.get(key);
    if (!(hash instanceof Map)) {
      return {};
    }

    const result = {};
    hash.forEach((value, field) => {
      result[field] = value;
    });

    return result;
  }

  /**
   * 模拟HDEL操作
   */
  async hdel(key, ...fields) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    const hash = this.data.get(key);
    if (!(hash instanceof Map)) {
      return 0;
    }

    let deletedCount = 0;
    fields.forEach(field => {
      if (hash.has(field)) {
        hash.delete(field);
        deletedCount++;
      }
    });

    return deletedCount;
  }

  /**
   * 模拟TTL操作
   */
  async ttl(key) {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    // 简化实现，始终返回-1（无过期时间）
    return this.data.has(key) ? -1 : -2;
  }

  /**
   * 模拟PING操作
   */
  async ping() {
    if (!this.connected) {
      throw new Error('Redis客户端未连接');
    }

    return 'PONG';
  }

  /**
   * 获取模拟的统计信息
   */
  getStats() {
    return {
      connected: this.connected,
      keyCount: this.data.size,
      subscriptions: this.subscriptions.size
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    await this.disconnect();
    console.log('MockRedisClient: 清理完成');
  }
}