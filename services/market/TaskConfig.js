/**
 * 任务配置管理类
 * 
 * 负责加载和管理调度器任务配置，支持配置验证和默认值。
 * 采用配置驱动设计，提高系统的灵活性和可维护性。
 * 
 * @version 1.0.0
 */

export class TaskConfig {
  constructor(config) {
    this.config = config;
    this.schedulerConfig = this._getSchedulerConfig();
    this.taskDefinitions = this._loadTaskDefinitions();
    
    // 验证配置
    const validation = this.validateConfig();
    if (!validation.isValid) {
      logger.warn('[TaskConfig] 配置验证失败', { errors: validation.errors });
    }
  }

  /**
   * 获取任务定义列表
   * @returns {Array<TaskDefinition>} 任务定义数组
   */
  getTaskDefinitions() {
    return this.taskDefinitions.filter(task => task.enabled);
  }

  /**
   * 获取调度器配置
   * @returns {Object} 调度器配置对象
   */
  getSchedulerConfig() {
    return this.schedulerConfig;
  }

  /**
   * 根据任务名称获取任务定义
   * @param {string} taskName 任务名称
   * @returns {TaskDefinition|null} 任务定义或null
   */
  getTaskDefinition(taskName) {
    return this.taskDefinitions.find(task => task.name === taskName) || null;
  }

  /**
   * 验证配置
   * @returns {ValidationResult} 验证结果
   */
  validateConfig() {
    const errors = [];

    // 验证调度器配置
    if (!this.schedulerConfig) {
      errors.push('缺少调度器配置');
    } else {
      if (typeof this.schedulerConfig.task_timeout !== 'number' || this.schedulerConfig.task_timeout <= 0) {
        errors.push('task_timeout必须是正数');
      }
      if (typeof this.schedulerConfig.retry_attempts !== 'number' || this.schedulerConfig.retry_attempts < 0) {
        errors.push('retry_attempts必须是非负数');
      }
      if (typeof this.schedulerConfig.max_concurrent_tasks !== 'number' || this.schedulerConfig.max_concurrent_tasks <= 0) {
        errors.push('max_concurrent_tasks必须是正数');
      }
    }

    // 验证任务定义
    this.taskDefinitions.forEach((task, index) => {
      if (!task.name || typeof task.name !== 'string') {
        errors.push(`任务${index}: name必须是非空字符串`);
      }
      if (typeof task.interval !== 'number' || task.interval <= 0) {
        errors.push(`任务${task.name || index}: interval必须是正数`);
      }
      if (typeof task.timeout !== 'number' || task.timeout <= 0) {
        errors.push(`任务${task.name || index}: timeout必须是正数`);
      }
      if (typeof task.retryAttempts !== 'number' || task.retryAttempts < 0) {
        errors.push(`任务${task.name || index}: retryAttempts必须是非负数`);
      }
      if (typeof task.enabled !== 'boolean') {
        errors.push(`任务${task.name || index}: enabled必须是布尔值`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 获取调度器配置（私有方法）
   * @returns {Object} 调度器配置
   * @private
   */
  _getSchedulerConfig() {
    const marketConfig = this.config.market;
    if (!marketConfig || !marketConfig.scheduler) {
      logger.warn('[TaskConfig] 未找到调度器配置，使用默认值');
      return this._getDefaultSchedulerConfig();
    }

    // 合并默认配置和用户配置
    const defaultConfig = this._getDefaultSchedulerConfig();
    return {
      ...defaultConfig,
      ...marketConfig.scheduler
    };
  }

  /**
   * 加载任务定义（私有方法）
   * @returns {Array<TaskDefinition>} 任务定义数组
   * @private
   */
  _loadTaskDefinitions() {
    const marketConfig = this.config.market;
    const schedulerConfig = this.schedulerConfig;

    // 如果配置中有任务定义，使用配置中的定义
    if (marketConfig.scheduler && marketConfig.scheduler.tasks) {
      return marketConfig.scheduler.tasks.map(task => this._normalizeTaskDefinition(task));
    }

    // 否则使用默认任务定义
    return this._getDefaultTaskDefinitions(marketConfig, schedulerConfig);
  }

  /**
   * 获取默认调度器配置
   * @returns {Object} 默认调度器配置
   * @private
   */
  _getDefaultSchedulerConfig() {
    return {
      enabled: true,
      max_concurrent_tasks: 3,
      task_timeout: 300000,  // 5分钟
      retry_attempts: 2,
      lock_ttl: 600000      // 10分钟
    };
  }

  /**
   * 获取默认任务定义
   * @param {Object} marketConfig 市场配置
   * @param {Object} schedulerConfig 调度器配置
   * @returns {Array<TaskDefinition>} 默认任务定义数组
   * @private
   */
  _getDefaultTaskDefinitions(marketConfig, schedulerConfig) {
    const updateInterval = (marketConfig.update?.interval || 3600) * 1000; // 默认1小时
    const monitoringInterval = 15 * 60 * 1000; // 15分钟
    const statsResetCheckInterval = 60 * 1000; // 1分钟检查间隔

    return [
      {
        name: 'priceUpdate',
        interval: updateInterval,
        timeout: schedulerConfig.task_timeout,
        retryAttempts: schedulerConfig.retry_attempts,
        enabled: true,
        description: '价格更新任务'
      },
      {
        name: 'statsReset',
        interval: statsResetCheckInterval,
        timeout: schedulerConfig.task_timeout,
        retryAttempts: schedulerConfig.retry_attempts,
        enabled: true,
        description: '统计重置任务（每天午夜执行）'
      },
      {
        name: 'monitoring',
        interval: monitoringInterval,
        timeout: schedulerConfig.task_timeout,
        retryAttempts: schedulerConfig.retry_attempts,
        enabled: true,
        description: '市场监控任务'
      }
    ];
  }

  /**
   * 标准化任务定义
   * @param {Object} task 原始任务定义
   * @returns {TaskDefinition} 标准化的任务定义
   * @private
   */
  _normalizeTaskDefinition(task) {
    return {
      name: task.name,
      interval: task.interval || 3600000,
      timeout: task.timeout || this.schedulerConfig.task_timeout,
      retryAttempts: task.retryAttempts !== undefined ? task.retryAttempts : this.schedulerConfig.retry_attempts,
      enabled: task.enabled !== undefined ? task.enabled : true,
      description: task.description || `${task.name}任务`
    };
  }
}

export default TaskConfig;
