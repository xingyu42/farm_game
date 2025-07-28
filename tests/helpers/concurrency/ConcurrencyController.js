/**
 * 并发控制器 - 管理并发测试执行和资源调度
 * 
 * 核心功能：
 * 1. 并发任务队列管理
 * 2. 资源池和调度策略
 * 3. 并发限制和负载均衡
 * 4. 故障隔离和恢复
 * 5. 性能监控和优化
 */
export class ConcurrencyController {
  constructor(options = {}) {
    // 基础配置
    this.maxConcurrency = options.maxConcurrency || 10;           // 最大并发数
    this.queueMaxSize = options.queueMaxSize || 1000;             // 队列最大大小
    this.taskTimeout = options.taskTimeout || 30000;             // 任务超时时间（30秒）
    this.retryAttempts = options.retryAttempts || 3;              // 重试次数
    this.enableLoadBalancing = options.enableLoadBalancing !== false;
    this.enableFailureIsolation = options.enableFailureIsolation !== false;
    
    // 调度策略配置
    this.schedulingStrategy = options.schedulingStrategy || 'round_robin'; // round_robin, priority, fifo, resource_aware
    this.resourceMonitoringEnabled = options.resourceMonitoringEnabled !== false;
    this.adaptiveScaling = options.adaptiveScaling !== false;
    
    // 任务队列和工作池
    this.taskQueue = [];                    // 待执行任务队列
    this.runningTasks = new Map();          // 正在执行的任务
    this.completedTasks = new Map();        // 已完成的任务
    this.failedTasks = new Map();           // 失败的任务
    this.workerPool = [];                   // 工作线程池
    
    // 资源管理
    this.resourcePools = new Map();         // 资源池管理
    this.resourceUsage = new Map();         // 资源使用情况
    this.resourceLimits = new Map();        // 资源限制
    
    // 统计信息
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
      timeoutTasks: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      peakConcurrency: 0,
      currentConcurrency: 0,
      queueLength: 0,
      startTime: Date.now()
    };
    
    // 负载均衡和调度
    this.loadBalancer = {
      currentWorkerIndex: 0,              // 轮询调度索引
      workerLoads: new Map(),             // 工作线程负载
      taskDistribution: new Map()         // 任务分布统计
    };
    
    // 事件处理
    this.eventHandlers = new Map();
    
    // 监控和健康检查
    this.healthCheckInterval = null;
    this.performanceMonitor = {
      metricsHistory: [],
      alertThresholds: {
        queueLength: 100,
        averageExecutionTime: 5000,  // 5秒
        failureRate: 0.1             // 10%
      }
    };
    
    // 绑定方法
    this.processQueue = this.processQueue.bind(this);
    this.healthCheck = this.healthCheck.bind(this);
    
    console.log('ConcurrencyController: 并发控制器已初始化');
  }
  
  /**
   * 初始化并发控制器
   */
  async initialize() {
    console.log('ConcurrencyController: 开始初始化...');
    
    // 初始化工作线程池
    await this._initializeWorkerPool();
    
    // 启动队列处理
    this._startQueueProcessing();
    
    // 启动健康检查
    if (this.resourceMonitoringEnabled) {
      this._startHealthCheck();
    }
    
    console.log('ConcurrencyController: 初始化完成');
  }
  
  /**
   * 初始化工作线程池
   */
  async _initializeWorkerPool() {
    this.workerPool = [];
    
    for (let i = 0; i < this.maxConcurrency; i++) {
      const worker = {
        id: `worker_${i}`,
        status: 'idle',        // idle, busy, error
        currentTask: null,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        lastActiveTime: Date.now(),
        createdAt: Date.now()
      };
      
      this.workerPool.push(worker);
      this.loadBalancer.workerLoads.set(worker.id, 0);
    }
    
    console.log(`ConcurrencyController: 初始化了 ${this.maxConcurrency} 个工作线程`);
  }
  
  /**
   * 启动队列处理
   */
  _startQueueProcessing() {
    // 使用 setImmediate 而非 setInterval 以避免固定间隔的性能开销
    const processNext = () => {
      this.processQueue();
      setImmediate(processNext);
    };
    
    setImmediate(processNext);
    console.log('ConcurrencyController: 队列处理已启动');
  }
  
  /**
   * 启动健康检查
   */
  _startHealthCheck() {
    this.healthCheckInterval = setInterval(this.healthCheck, 5000); // 每5秒检查一次
    console.log('ConcurrencyController: 健康检查已启动');
  }
  
  /**
   * 提交任务到并发队列
   * @param {Function} taskFunction - 任务函数
   * @param {Object} options - 任务选项
   */
  async submitTask(taskFunction, options = {}) {
    if (typeof taskFunction !== 'function') {
      throw new Error('Task must be a function');
    }
    
    if (this.taskQueue.length >= this.queueMaxSize) {
      throw new Error(`Task queue is full (max: ${this.queueMaxSize})`);
    }
    
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task = {
      id: taskId,
      function: taskFunction,
      options: {
        priority: options.priority || 0,
        timeout: options.timeout || this.taskTimeout,
        retryAttempts: options.retryAttempts || this.retryAttempts,
        resourceRequirements: options.resourceRequirements || {},
        metadata: options.metadata || {},
        ...options
      },
      status: 'queued',
      submittedAt: Date.now(),
      attempts: 0,
      errors: []
    };
    
    // 根据调度策略插入任务
    this._insertTaskByStrategy(task);
    
    this.stats.totalTasks++;
    this.stats.queueLength = this.taskQueue.length;
    
    console.log(`ConcurrencyController: 提交任务 ${taskId}，队列长度: ${this.taskQueue.length}`);
    
    // 触发任务提交事件
    this._emitEvent('taskSubmitted', { task });
    
    return taskId;
  }
  
  /**
   * 根据调度策略插入任务
   * @param {Object} task - 任务对象
   */
  _insertTaskByStrategy(task) {
    switch (this.schedulingStrategy) {
      case 'priority':
        // 按优先级插入（高优先级在前）
        const insertIndex = this.taskQueue.findIndex(t => t.options.priority < task.options.priority);
        if (insertIndex === -1) {
          this.taskQueue.push(task);
        } else {
          this.taskQueue.splice(insertIndex, 0, task);
        }
        break;
        
      case 'fifo':
        // 先进先出
        this.taskQueue.push(task);
        break;
        
      case 'resource_aware':
        // 资源感知调度（简化实现）
        this.taskQueue.push(task);
        this._sortQueueByResourceAvailability();
        break;
        
      case 'round_robin':
      default:
        // 轮询调度（默认为FIFO）
        this.taskQueue.push(task);
        break;
    }
  }
  
  /**
   * 按资源可用性排序队列
   */
  _sortQueueByResourceAvailability() {
    this.taskQueue.sort((a, b) => {
      const aScore = this._calculateResourceScore(a.options.resourceRequirements);
      const bScore = this._calculateResourceScore(b.options.resourceRequirements);
      return bScore - aScore; // 高分在前
    });
  }
  
  /**
   * 计算资源可用性得分
   * @param {Object} requirements - 资源需求
   */
  _calculateResourceScore(requirements) {
    let score = 100;
    
    for (const [resource, required] of Object.entries(requirements)) {
      const available = this._getAvailableResource(resource);
      if (available < required) {
        score -= 50; // 资源不足，大幅降分
      } else {
        const ratio = available / required;
        score += Math.min(ratio * 10, 50); // 资源充足度加分
      }
    }
    
    return score;
  }
  
  /**
   * 获取可用资源量
   * @param {string} resourceType - 资源类型
   */
  _getAvailableResource(resourceType) {
    const limit = this.resourceLimits.get(resourceType) || Infinity;
    const used = this.resourceUsage.get(resourceType) || 0;
    return Math.max(0, limit - used);
  }
  
  /**
   * 处理任务队列
   */
  async processQueue() {
    // 更新统计信息
    this.stats.currentConcurrency = this.runningTasks.size;
    this.stats.queueLength = this.taskQueue.length;
    
    // 如果没有待处理任务或已达到最大并发数，直接返回
    if (this.taskQueue.length === 0 || this.runningTasks.size >= this.maxConcurrency) {
      return;
    }
    
    // 获取可用的工作线程
    const availableWorker = this._getAvailableWorker();
    if (!availableWorker) {
      return;
    }
    
    // 获取下一个任务
    const task = this.taskQueue.shift();
    if (!task) {
      return;
    }
    
    // 检查资源可用性
    if (!this._checkResourceAvailability(task.options.resourceRequirements)) {
      // 资源不足，将任务重新放回队列
      this.taskQueue.unshift(task);
      return;
    }
    
    // 分配资源
    this._allocateResources(task.options.resourceRequirements);
    
    // 执行任务
    await this._executeTask(task, availableWorker);
  }
  
  /**
   * 获取可用的工作线程
   */
  _getAvailableWorker() {
    if (this.enableLoadBalancing) {
      return this._getWorkerByLoadBalancing();
    } else {
      return this.workerPool.find(worker => worker.status === 'idle');
    }
  }
  
  /**
   * 通过负载均衡获取工作线程
   */
  _getWorkerByLoadBalancing() {
    // 找到负载最小的空闲工作线程
    const idleWorkers = this.workerPool.filter(worker => worker.status === 'idle');
    
    if (idleWorkers.length === 0) {
      return null;
    }
    
    // 按负载排序，选择负载最小的
    idleWorkers.sort((a, b) => {
      const loadA = this.loadBalancer.workerLoads.get(a.id) || 0;
      const loadB = this.loadBalancer.workerLoads.get(b.id) || 0;
      return loadA - loadB;
    });
    
    return idleWorkers[0];
  }
  
  /**
   * 检查资源可用性
   * @param {Object} requirements - 资源需求
   */
  _checkResourceAvailability(requirements) {
    for (const [resource, required] of Object.entries(requirements)) {
      const available = this._getAvailableResource(resource);
      if (available < required) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * 分配资源
   * @param {Object} requirements - 资源需求
   */
  _allocateResources(requirements) {
    for (const [resource, required] of Object.entries(requirements)) {
      const currentUsage = this.resourceUsage.get(resource) || 0;
      this.resourceUsage.set(resource, currentUsage + required);
    }
  }
  
  /**
   * 释放资源
   * @param {Object} requirements - 资源需求
   */
  _releaseResources(requirements) {
    for (const [resource, required] of Object.entries(requirements)) {
      const currentUsage = this.resourceUsage.get(resource) || 0;
      this.resourceUsage.set(resource, Math.max(0, currentUsage - required));
    }
  }
  
  /**
   * 执行任务
   * @param {Object} task - 任务对象
   * @param {Object} worker - 工作线程对象
   */
  async _executeTask(task, worker) {
    const startTime = Date.now();
    
    // 更新任务和工作线程状态
    task.status = 'running';
    task.startedAt = startTime;
    task.assignedWorker = worker.id;
    task.attempts++;
    
    worker.status = 'busy';
    worker.currentTask = task.id;
    worker.totalTasks++;
    worker.lastActiveTime = startTime;
    
    // 将任务添加到运行中任务列表
    this.runningTasks.set(task.id, task);
    
    // 更新负载均衡器
    const currentLoad = this.loadBalancer.workerLoads.get(worker.id) || 0;
    this.loadBalancer.workerLoads.set(worker.id, currentLoad + 1);
    
    // 更新峰值并发数
    if (this.runningTasks.size > this.stats.peakConcurrency) {
      this.stats.peakConcurrency = this.runningTasks.size;
    }
    
    console.log(`ConcurrencyController: 开始执行任务 ${task.id}，工作线程: ${worker.id}`);
    
    // 触发任务开始事件
    this._emitEvent('taskStarted', { task, worker });
    
    try {
      // 设置超时控制
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Task timeout after ${task.options.timeout}ms`));
        }, task.options.timeout);
      });
      
      // 执行任务函数
      const taskPromise = task.function();
      
      // 等待任务完成或超时
      const result = await Promise.race([taskPromise, timeoutPromise]);
      
      // 任务成功完成
      await this._handleTaskSuccess(task, worker, result, startTime);
      
    } catch (error) {
      // 任务执行失败
      await this._handleTaskFailure(task, worker, error, startTime);
    }
  }
  
  /**
   * 处理任务成功
   * @param {Object} task - 任务对象
   * @param {Object} worker - 工作线程对象
   * @param {*} result - 任务结果
   * @param {number} startTime - 开始时间
   */
  async _handleTaskSuccess(task, worker, result, startTime) {
    const executionTime = Date.now() - startTime;
    
    // 更新任务状态
    task.status = 'completed';
    task.completedAt = Date.now();
    task.executionTime = executionTime;
    task.result = result;
    
    // 更新工作线程状态
    worker.status = 'idle';
    worker.currentTask = null;
    worker.completedTasks++;
    worker.totalExecutionTime += executionTime;
    worker.averageExecutionTime = worker.totalExecutionTime / worker.completedTasks;
    
    // 更新统计信息
    this.stats.completedTasks++;
    this.stats.totalExecutionTime += executionTime;
    this.stats.averageExecutionTime = this.stats.totalExecutionTime / this.stats.completedTasks;
    
    // 更新负载均衡器
    const currentLoad = this.loadBalancer.workerLoads.get(worker.id) || 0;
    this.loadBalancer.workerLoads.set(worker.id, Math.max(0, currentLoad - 1));
    
    // 释放资源
    this._releaseResources(task.options.resourceRequirements);
    
    // 移动任务到完成列表
    this.runningTasks.delete(task.id);
    this.completedTasks.set(task.id, task);
    
    console.log(`ConcurrencyController: 任务 ${task.id} 执行成功，耗时: ${executionTime}ms`);
    
    // 触发任务完成事件
    this._emitEvent('taskCompleted', { task, worker, result, executionTime });
  }
  
  /**
   * 处理任务失败
   * @param {Object} task - 任务对象
   * @param {Object} worker - 工作线程对象
   * @param {Error} error - 错误对象
   * @param {number} startTime - 开始时间
   */
  async _handleTaskFailure(task, worker, error, startTime) {
    const executionTime = Date.now() - startTime;
    
    // 记录错误
    task.errors.push({
      attempt: task.attempts,
      error: error.message,
      timestamp: Date.now(),
      executionTime
    });
    
    // 更新工作线程状态
    worker.status = 'idle';
    worker.currentTask = null;
    worker.failedTasks++;
    
    // 更新负载均衡器
    const currentLoad = this.loadBalancer.workerLoads.get(worker.id) || 0;
    this.loadBalancer.workerLoads.set(worker.id, Math.max(0, currentLoad - 1));
    
    // 释放资源
    this._releaseResources(task.options.resourceRequirements);
    
    // 移除正在运行的任务
    this.runningTasks.delete(task.id);
    
    // 检查是否需要重试
    if (task.attempts < task.options.retryAttempts && this._shouldRetryTask(error)) {
      console.log(`ConcurrencyController: 任务 ${task.id} 失败，准备重试 (第${task.attempts}次)`);
      
      // 重试任务（添加延迟）
      setTimeout(() => {
        task.status = 'queued';
        this._insertTaskByStrategy(task);
        this.stats.retriedTasks++;
      }, this._calculateRetryDelay(task.attempts));
      
    } else {
      // 任务最终失败
      task.status = 'failed';
      task.failedAt = Date.now();
      task.finalError = error.message;
      
      this.stats.failedTasks++;
      
      if (error.message.includes('timeout')) {
        this.stats.timeoutTasks++;
      }
      
      // 移动到失败任务列表
      this.failedTasks.set(task.id, task);
      
      console.error(`ConcurrencyController: 任务 ${task.id} 最终失败:`, error.message);
      
      // 故障隔离检查
      if (this.enableFailureIsolation) {
        this._checkFailureIsolation(worker, error);
      }
    }
    
    // 触发任务失败事件
    this._emitEvent('taskFailed', { task, worker, error, executionTime });
  }
  
  /**
   * 判断是否应该重试任务
   * @param {Error} error - 错误对象
   */
  _shouldRetryTask(error) {
    // 某些错误类型不适合重试
    const nonRetryableErrors = [
      'validation error',
      'permission denied',
      'invalid parameter'
    ];
    
    const errorMessage = error.message.toLowerCase();
    return !nonRetryableErrors.some(err => errorMessage.includes(err));
  }
  
  /**
   * 计算重试延迟
   * @param {number} attempt - 尝试次数
   */
  _calculateRetryDelay(attempt) {
    // 指数退避策略
    const baseDelay = 1000; // 1秒
    const maxDelay = 30000; // 最大30秒
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    
    // 添加随机抖动
    const jitter = Math.random() * 0.1 * delay;
    return delay + jitter;
  }
  
  /**
   * 故障隔离检查
   * @param {Object} worker - 工作线程对象
   * @param {Error} error - 错误对象
   */
  _checkFailureIsolation(worker, error) {
    const recentFailures = this._getRecentFailures(worker.id, 300000); // 最近5分钟
    
    if (recentFailures.length > 3) {
      console.warn(`ConcurrencyController: 工作线程 ${worker.id} 频繁失败，暂时隔离`);
      
      worker.status = 'error';
      worker.isolatedAt = Date.now();
      worker.isolationReason = 'Too many recent failures';
      
      // 5分钟后恢复
      setTimeout(() => {
        if (worker.status === 'error') {
          worker.status = 'idle';
          worker.isolatedAt = null;
          worker.isolationReason = null;
          console.log(`ConcurrencyController: 工作线程 ${worker.id} 已恢复`);
        }
      }, 300000);
      
      // 触发隔离事件
      this._emitEvent('workerIsolated', { worker, recentFailures });
    }
  }
  
  /**
   * 获取工作线程最近的失败记录
   * @param {string} workerId - 工作线程ID
   * @param {number} timeWindow - 时间窗口（毫秒）
   */
  _getRecentFailures(workerId, timeWindow) {
    const cutoffTime = Date.now() - timeWindow;
    const failures = [];
    
    for (const task of this.failedTasks.values()) {
      if (task.assignedWorker === workerId && task.failedAt > cutoffTime) {
        failures.push(task);
      }
    }
    
    return failures;
  }
  
  /**
   * 健康检查
   */
  healthCheck() {
    const currentMetrics = this._collectMetrics();
    
    // 记录指标历史
    this.performanceMonitor.metricsHistory.push(currentMetrics);
    
    // 保持历史记录大小
    if (this.performanceMonitor.metricsHistory.length > 100) {
      this.performanceMonitor.metricsHistory.shift();
    }
    
    // 检查告警条件
    this._checkAlertConditions(currentMetrics);
    
    // 自适应缩放
    if (this.adaptiveScaling) {
      this._performAdaptiveScaling(currentMetrics);
    }
  }
  
  /**
   * 收集性能指标
   */
  _collectMetrics() {
    const now = Date.now();
    const runtime = now - this.stats.startTime;
    
    return {
      timestamp: now,
      queueLength: this.taskQueue.length,
      runningTasks: this.runningTasks.size,
      completedTasks: this.stats.completedTasks,
      failedTasks: this.stats.failedTasks,
      averageExecutionTime: this.stats.averageExecutionTime,
      failureRate: this.stats.totalTasks > 0 ? 
        this.stats.failedTasks / this.stats.totalTasks : 0,
      throughput: runtime > 0 ? 
        (this.stats.completedTasks / (runtime / 1000)) : 0,
      resourceUtilization: this._calculateResourceUtilization(),
      workerUtilization: this._calculateWorkerUtilization()
    };
  }
  
  /**
   * 计算资源利用率
   */
  _calculateResourceUtilization() {
    const utilization = {};
    
    for (const [resource, limit] of this.resourceLimits) {
      const used = this.resourceUsage.get(resource) || 0;
      utilization[resource] = limit > 0 ? used / limit : 0;
    }
    
    return utilization;
  }
  
  /**
   * 计算工作线程利用率
   */
  _calculateWorkerUtilization() {
    const busyWorkers = this.workerPool.filter(w => w.status === 'busy').length;
    const totalWorkers = this.workerPool.length;
    
    return totalWorkers > 0 ? busyWorkers / totalWorkers : 0;
  }
  
  /**
   * 检查告警条件
   * @param {Object} metrics - 当前指标
   */
  _checkAlertConditions(metrics) {
    const thresholds = this.performanceMonitor.alertThresholds;
    
    // 队列长度告警
    if (metrics.queueLength > thresholds.queueLength) {
      this._emitEvent('alert', {
        type: 'queue_length',
        message: `队列长度过长: ${metrics.queueLength}`,
        severity: 'warning',
        metrics
      });
    }
    
    // 平均执行时间告警
    if (metrics.averageExecutionTime > thresholds.averageExecutionTime) {
      this._emitEvent('alert', {
        type: 'execution_time',
        message: `平均执行时间过长: ${metrics.averageExecutionTime}ms`,
        severity: 'warning',
        metrics
      });
    }
    
    // 失败率告警
    if (metrics.failureRate > thresholds.failureRate) {
      this._emitEvent('alert', {
        type: 'failure_rate',
        message: `失败率过高: ${(metrics.failureRate * 100).toFixed(2)}%`,
        severity: 'critical',
        metrics
      });
    }
  }
  
  /**
   * 自适应缩放
   * @param {Object} metrics - 当前指标
   */
  _performAdaptiveScaling(metrics) {
    const queueLength = metrics.queueLength;
    const utilization = metrics.workerUtilization;
    
    // 扩容条件：队列长度大于10且工作线程利用率超过80%
    if (queueLength > 10 && utilization > 0.8 && this.workerPool.length < 20) {
      this._scaleUp();
    }
    // 缩容条件：队列为空且工作线程利用率低于20%，且工作线程数量大于最小值
    else if (queueLength === 0 && utilization < 0.2 && this.workerPool.length > this.maxConcurrency) {
      this._scaleDown();
    }
  }
  
  /**
   * 扩容工作线程
   */
  _scaleUp() {
    const newWorkerId = `worker_${this.workerPool.length}`;
    const newWorker = {
      id: newWorkerId,
      status: 'idle',
      currentTask: null,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      lastActiveTime: Date.now(),
      createdAt: Date.now()
    };
    
    this.workerPool.push(newWorker);
    this.loadBalancer.workerLoads.set(newWorkerId, 0);
    
    console.log(`ConcurrencyController: 扩容增加工作线程 ${newWorkerId}，当前数量: ${this.workerPool.length}`);
    
    this._emitEvent('workerAdded', { worker: newWorker });
  }
  
  /**
   * 缩容工作线程
   */
  _scaleDown() {
    // 移除最后一个空闲的工作线程
    const idleWorkerIndex = this.workerPool.findIndex(w => w.status === 'idle');
    
    if (idleWorkerIndex !== -1) {
      const removedWorker = this.workerPool.splice(idleWorkerIndex, 1)[0];
      this.loadBalancer.workerLoads.delete(removedWorker.id);
      
      console.log(`ConcurrencyController: 缩容移除工作线程 ${removedWorker.id}，当前数量: ${this.workerPool.length}`);
      
      this._emitEvent('workerRemoved', { worker: removedWorker });
    }
  }
  
  /**
   * 设置资源限制
   * @param {string} resourceType - 资源类型
   * @param {number} limit - 资源限制
   */
  setResourceLimit(resourceType, limit) {
    this.resourceLimits.set(resourceType, limit);
    console.log(`ConcurrencyController: 设置资源限制 ${resourceType}: ${limit}`);
  }
  
  /**
   * 获取任务状态
   * @param {string} taskId - 任务ID
   */
  getTaskStatus(taskId) {
    // 检查正在运行的任务
    if (this.runningTasks.has(taskId)) {
      return { ...this.runningTasks.get(taskId) };
    }
    
    // 检查已完成的任务
    if (this.completedTasks.has(taskId)) {
      return { ...this.completedTasks.get(taskId) };
    }
    
    // 检查失败的任务
    if (this.failedTasks.has(taskId)) {
      return { ...this.failedTasks.get(taskId) };
    }
    
    // 检查队列中的任务
    const queuedTask = this.taskQueue.find(task => task.id === taskId);
    if (queuedTask) {
      return { ...queuedTask };
    }
    
    return null;
  }
  
  /**
   * 取消任务
   * @param {string} taskId - 任务ID
   */
  cancelTask(taskId) {
    // 从队列中移除
    const queueIndex = this.taskQueue.findIndex(task => task.id === taskId);
    if (queueIndex !== -1) {
      const cancelledTask = this.taskQueue.splice(queueIndex, 1)[0];
      cancelledTask.status = 'cancelled';
      cancelledTask.cancelledAt = Date.now();
      
      console.log(`ConcurrencyController: 取消队列中的任务 ${taskId}`);
      this._emitEvent('taskCancelled', { task: cancelledTask });
      
      return true;
    }
    
    // 如果是正在运行的任务，标记为取消（具体的取消逻辑需要任务函数自行处理）
    if (this.runningTasks.has(taskId)) {
      const runningTask = this.runningTasks.get(taskId);
      runningTask.cancelRequested = true;
      runningTask.cancelRequestedAt = Date.now();
      
      console.log(`ConcurrencyController: 请求取消正在运行的任务 ${taskId}`);
      this._emitEvent('taskCancelRequested', { task: runningTask });
      
      return true;
    }
    
    return false;
  }
  
  /**
   * 获取并发控制器统计信息
   */
  getStatistics() {
    const runtime = Date.now() - this.stats.startTime;
    
    return {
      // 基础统计
      totalTasks: this.stats.totalTasks,
      completedTasks: this.stats.completedTasks,
      failedTasks: this.stats.failedTasks,
      retriedTasks: this.stats.retriedTasks,
      timeoutTasks: this.stats.timeoutTasks,
      
      // 性能统计
      averageExecutionTime: this.stats.averageExecutionTime,
      totalExecutionTime: this.stats.totalExecutionTime,
      throughput: runtime > 0 ? (this.stats.completedTasks / (runtime / 1000)).toFixed(2) : '0',
      
      // 并发统计
      currentConcurrency: this.stats.currentConcurrency,
      peakConcurrency: this.stats.peakConcurrency,
      maxConcurrency: this.maxConcurrency,
      queueLength: this.stats.queueLength,
      
      // 成功率
      successRate: this.stats.totalTasks > 0 ? 
        ((this.stats.completedTasks / this.stats.totalTasks) * 100).toFixed(2) + '%' : '100%',
      failureRate: this.stats.totalTasks > 0 ? 
        ((this.stats.failedTasks / this.stats.totalTasks) * 100).toFixed(2) + '%' : '0%',
      
      // 工作线程统计
      totalWorkers: this.workerPool.length,
      busyWorkers: this.workerPool.filter(w => w.status === 'busy').length,
      idleWorkers: this.workerPool.filter(w => w.status === 'idle').length,
      errorWorkers: this.workerPool.filter(w => w.status === 'error').length,
      
      // 时间统计
      runtime,
      uptime: runtime
    };
  }
  
  /**
   * 获取工作线程详细信息
   */
  getWorkerDetails() {
    return this.workerPool.map(worker => ({
      ...worker,
      load: this.loadBalancer.workerLoads.get(worker.id) || 0,
      efficiency: worker.completedTasks > 0 ? 
        (worker.completedTasks / (worker.completedTasks + worker.failedTasks) * 100).toFixed(2) + '%' : '100%'
    }));
  }
  
  /**
   * 注册事件处理器
   * @param {string} eventType - 事件类型
   * @param {Function} handler - 事件处理函数
   */
  on(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    
    this.eventHandlers.get(eventType).push(handler);
    console.log(`ConcurrencyController: 注册事件处理器 - ${eventType}`);
  }
  
  /**
   * 触发事件
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   */
  _emitEvent(eventType, eventData) {
    const handlers = this.eventHandlers.get(eventType) || [];
    
    for (const handler of handlers) {
      try {
        handler(eventData);
      } catch (error) {
        console.error(`ConcurrencyController: 事件处理器执行失败 - ${eventType}:`, error.message);
      }
    }
  }
  
  /**
   * 生成并发控制报告
   */
  generateConcurrencyReport() {
    const stats = this.getStatistics();
    const workerDetails = this.getWorkerDetails();
    const currentMetrics = this._collectMetrics();
    
    return {
      timestamp: new Date().toISOString(),
      
      summary: {
        totalTasks: stats.totalTasks,
        successRate: stats.successRate,
        averageExecutionTime: stats.averageExecutionTime,
        currentConcurrency: stats.currentConcurrency,
        queueLength: stats.queueLength
      },
      
      statistics: stats,
      workerDetails,
      currentMetrics,
      
      performance: {
        metricsHistory: this.performanceMonitor.metricsHistory.slice(-20), // 最近20条记录
        alertThresholds: this.performanceMonitor.alertThresholds
      },
      
      resourceUsage: {
        limits: Object.fromEntries(this.resourceLimits),
        usage: Object.fromEntries(this.resourceUsage),
        utilization: currentMetrics.resourceUtilization
      },
      
      configuration: {
        maxConcurrency: this.maxConcurrency,
        queueMaxSize: this.queueMaxSize,
        taskTimeout: this.taskTimeout,
        schedulingStrategy: this.schedulingStrategy,
        enableLoadBalancing: this.enableLoadBalancing,
        enableFailureIsolation: this.enableFailureIsolation,
        adaptiveScaling: this.adaptiveScaling
      }
    };
  }
  
  /**
   * 重置统计信息
   */
  resetStatistics() {
    console.log('ConcurrencyController: 重置统计信息');
    
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
      timeoutTasks: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      peakConcurrency: 0,
      currentConcurrency: this.runningTasks.size,
      queueLength: this.taskQueue.length,
      startTime: Date.now()
    };
    
    // 重置工作线程统计
    for (const worker of this.workerPool) {
      worker.totalTasks = 0;
      worker.completedTasks = 0;
      worker.failedTasks = 0;
      worker.totalExecutionTime = 0;
      worker.averageExecutionTime = 0;
    }
    
    // 清空历史记录
    this.completedTasks.clear();
    this.failedTasks.clear();
    this.performanceMonitor.metricsHistory = [];
  }
  
  /**
   * 清理资源
   */
  async cleanup() {
    console.log('ConcurrencyController: 开始清理资源...');
    
    // 停止健康检查
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // 等待所有正在运行的任务完成或超时
    const maxWaitTime = 30000; // 最大等待30秒
    const startTime = Date.now();
    
    while (this.runningTasks.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      console.log(`ConcurrencyController: 等待 ${this.runningTasks.size} 个任务完成...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 强制取消剩余任务
    if (this.runningTasks.size > 0) {
      console.warn(`ConcurrencyController: 强制取消 ${this.runningTasks.size} 个未完成的任务`);
      for (const taskId of this.runningTasks.keys()) {
        this.cancelTask(taskId);
      }
    }
    
    // 清空队列
    this.taskQueue = [];
    
    // 生成最终报告
    const finalReport = this.generateConcurrencyReport();
    
    // 清理数据
    this.runningTasks.clear();
    this.completedTasks.clear();
    this.failedTasks.clear();
    this.resourcePools.clear();
    this.resourceUsage.clear();
    this.resourceLimits.clear();
    this.eventHandlers.clear();
    
    console.log('ConcurrencyController: 清理完成');
    
    return finalReport;
  }
}