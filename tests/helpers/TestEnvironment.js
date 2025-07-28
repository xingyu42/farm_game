/**
 * TestEnvironment - 测试环境管理器
 * 提供统一的测试环境控制、数据管理和生命周期管理
 */

import { MockServiceContainer } from './mocks/MockServiceContainer.js';
import { MockRedisClient } from './mocks/MockRedisClient.js';

export class TestEnvironment {
  constructor() {
    this.serviceContainer = null;
    this.mockRedis = null;
    this.testData = new Map();
    this.snapshots = new Map();
    this.isSetup = false;
    this.mockTime = false;
    this.currentTime = Date.now();
    this.timeMultiplier = 1;
    this._cleanupTasks = [];
    this._testMetrics = {
      testsRun: 0,
      dataCreated: 0,
      errorsEncountered: 0
    };
  }

  /**
   * 设置测试环境
   */
  async setup() {
    if (this.isSetup) {
      return;
    }

    try {
      console.log('🔧 正在设置测试环境...');
      
      // 初始化Mock服务容器
      this.serviceContainer = new MockServiceContainer();
      await this.serviceContainer.init();
      this.mockRedis = this.serviceContainer.getMockRedis();

      // 设置时间模拟
      this._setupTimeMocking();

      // 初始化测试数据存储
      this._initializeTestDataStorage();

      // 设置全局错误处理
      this._setupErrorHandling();

      this.isSetup = true;
      console.log('✅ 测试环境设置完成');
    } catch (error) {
      console.error('❌ 测试环境设置失败:', error);
      throw error;
    }
  }

  /**
   * 清理测试环境
   */
  async teardown() {
    if (!this.isSetup) {
      return;
    }

    try {
      console.log('🧹 正在清理测试环境...');

      // 执行清理任务
      for (const cleanupTask of this._cleanupTasks) {
        try {
          await cleanupTask();
        } catch (error) {
          console.warn('清理任务执行失败:', error);
        }
      }
      this._cleanupTasks = [];

      // 清理服务容器
      if (this.serviceContainer) {
        await this.serviceContainer.cleanup();
        this.serviceContainer = null;
      }

      // 恢复时间模拟
      this._restoreTimeMocking();

      // 清理数据
      this.testData.clear();
      this.snapshots.clear();

      this.isSetup = false;
      console.log('✅ 测试环境清理完成');
      
      // 打印测试统计
      this._printTestMetrics();
    } catch (error) {
      console.error('❌ 测试环境清理失败:', error);
      throw error;
    }
  }

  /**
   * 重置测试数据
   */
  async resetTestData() {
    if (!this.isSetup) {
      throw new Error('测试环境未初始化');
    }

    try {
      // 重置服务容器状态
      await this.serviceContainer.reset();

      // 清理测试数据
      this.testData.clear();

      // 重置时间
      this.currentTime = Date.now();

      console.log('🔄 测试数据已重置');
    } catch (error) {
      console.error('❌ 测试数据重置失败:', error);
      throw error;
    }
  }

  /**
   * 清理测试数据（每个测试后调用）
   */
  async cleanupTestData() {
    if (!this.isSetup) {
      return;
    }

    try {
      // 清理临时测试数据
      const tempKeys = Array.from(this.testData.keys()).filter(key => 
        key.startsWith('temp_') || key.startsWith('test_')
      );
      
      for (const key of tempKeys) {
        this.testData.delete(key);
      }

      // 重置Redis调用统计
      this.mockRedis.resetCallCounts();
    } catch (error) {
      console.warn('测试数据清理警告:', error);
    }
  }

  /**
   * 获取服务实例
   */
  getService(serviceName) {
    if (!this.serviceContainer) {
      throw new Error('服务容器未初始化');
    }
    return this.serviceContainer.getService(serviceName);
  }

  /**
   * 获取Mock Redis客户端
   */
  getMockRedis() {
    return this.mockRedis;
  }

  /**
   * 模拟命令执行（用于E2E测试）
   */
  async simulateCommand(userId, command) {
    // 这里可以模拟完整的命令执行流程
    // 包括解析命令、调用相应的app处理器等
    console.log(`模拟执行命令: ${command} (用户: ${userId})`);
    
    // 简单的命令路由示例
    if (command.includes('状态')) {
      const playerService = this.getService('playerService');
      const result = await playerService.getPlayer(userId);
      return result.success ? '玩家状态查询成功' : '玩家不存在，欢迎来到农场游戏！';
    }
    
    if (command.includes('签到')) {
      const playerService = this.getService('playerService');
      // 模拟签到逻辑
      return '签到成功！获得100金币和20体力';
    }
    
    return `命令"${command}"执行完成`;
  }

  /**
   * 时间控制 - 前进时间
   */
  advanceTime(milliseconds) {
    if (this.mockTime) {
      this.currentTime += milliseconds * this.timeMultiplier;
      
      // 触发定时器回调（如果有的话）
      this._triggerTimers();
      
      console.log(`⏭️ 时间前进 ${milliseconds}ms`);
    } else {
      console.warn('时间模拟未启用');
    }
  }

  /**
   * 设置时间倍率
   */
  setTimeMultiplier(multiplier) {
    this.timeMultiplier = multiplier;
    console.log(`⏰ 时间倍率设置为 ${multiplier}x`);
  }

  /**
   * 获取当前时间
   */
  now() {
    return this.mockTime ? this.currentTime : Date.now();
  }

  /**
   * 创建数据快照
   */
  async createSnapshot(name) {
    if (!this.mockRedis) {
      throw new Error('MockRedis未初始化');
    }

    const snapshot = this.mockRedis.getSnapshot();
    this.snapshots.set(name, snapshot);
    console.log(`📸 创建快照: ${name}`);
  }

  /**
   * 恢复数据快照
   */
  async restoreSnapshot(name) {
    if (!this.snapshots.has(name)) {
      throw new Error(`快照 '${name}' 不存在`);
    }

    const snapshot = this.snapshots.get(name);
    this.mockRedis.restoreSnapshot(snapshot);
    console.log(`🔄 恢复快照: ${name}`);
  }

  /**
   * 获取玩家数据（用于E2E测试验证）
   */
  async getPlayerData(userId) {
    const playerService = this.getService('playerService');
    const result = await playerService.getPlayer(userId);
    return result.data;
  }

  /**
   * 存储测试数据
   */
  setTestData(key, value) {
    this.testData.set(key, value);
    this._testMetrics.dataCreated++;
  }

  /**
   * 获取测试数据
   */
  getTestData(key) {
    return this.testData.get(key);
  }

  /**
   * 检查测试数据是否存在
   */
  hasTestData(key) {
    return this.testData.has(key);
  }

  /**
   * 删除测试数据
   */
  deleteTestData(key) {
    return this.testData.delete(key);
  }

  /**
   * 添加清理任务
   */
  addCleanupTask(task) {
    if (typeof task === 'function') {
      this._cleanupTasks.push(task);
    }
  }

  /**
   * 模拟网络延迟
   */
  async simulateNetworkDelay(min = 10, max = 100) {
    const delay = Math.random() * (max - min) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 模拟随机错误
   */
  simulateRandomError(probability = 0.1, errorMessage = '模拟网络错误') {
    if (Math.random() < probability) {
      throw new Error(errorMessage);
    }
  }

  /**
   * 获取测试统计信息
   */
  getTestMetrics() {
    return { ...this._testMetrics };
  }

  /**
   * 增加测试计数
   */
  incrementTestCount() {
    this._testMetrics.testsRun++;
  }

  /**
   * 记录错误
   */
  recordError(error) {
    this._testMetrics.errorsEncountered++;
    console.error('测试错误记录:', error);
  }

  // ===========================================
  // 私有方法
  // ===========================================

  /**
   * 设置时间模拟
   */
  _setupTimeMocking() {
    this.mockTime = true;
    this.currentTime = Date.now();
    
    // 保存原始Date构造函数
    this._originalDate = global.Date;
    this._originalDateNow = Date.now;
    
    // Mock Date.now()
    const testEnv = this;
    Date.now = function() {
      return testEnv.mockTime ? testEnv.currentTime : testEnv._originalDateNow();
    };
    
    // Mock new Date()
    global.Date = function(...args) {
      if (args.length === 0) {
        return new testEnv._originalDate(testEnv.mockTime ? testEnv.currentTime : Date.now());
      }
      return new testEnv._originalDate(...args);
    };
    
    // 复制Date的静态方法
    Object.setPrototypeOf(global.Date, testEnv._originalDate);
    Object.getOwnPropertyNames(testEnv._originalDate).forEach(prop => {
      if (prop !== 'now' && prop !== 'length' && prop !== 'name') {
        global.Date[prop] = testEnv._originalDate[prop];
      }
    });
    
    console.log('⏰ 时间模拟已启用');
  }

  /**
   * 恢复时间模拟
   */
  _restoreTimeMocking() {
    if (this._originalDate) {
      global.Date = this._originalDate;
      Date.now = this._originalDateNow;
      this.mockTime = false;
      console.log('⏰ 时间模拟已恢复');
    }
  }

  /**
   * 初始化测试数据存储
   */
  _initializeTestDataStorage() {
    this.testData = new Map();
    this.snapshots = new Map();
  }

  /**
   * 设置错误处理
   */
  _setupErrorHandling() {
    // 这里可以设置全局错误捕获和处理
    process.on('uncaughtException', (error) => {
      this.recordError(error);
      console.error('未捕获的异常:', error);
    });

    process.on('unhandledRejection', (reason) => {
      this.recordError(reason);
      console.error('未处理的Promise拒绝:', reason);
    });
  }

  /**
   * 触发定时器（时间模拟相关）
   */
  _triggerTimers() {
    // 这里可以实现定时器的触发逻辑
    // 暂时留空，后续可以扩展
  }

  /**
   * 打印测试统计
   */
  _printTestMetrics() {
    console.log('📊 测试统计:');
    console.log(`  - 运行测试数: ${this._testMetrics.testsRun}`);
    console.log(`  - 创建数据量: ${this._testMetrics.dataCreated}`);
    console.log(`  - 遇到错误数: ${this._testMetrics.errorsEncountered}`);
  }
}