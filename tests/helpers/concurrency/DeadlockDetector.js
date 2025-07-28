/**
 * 死锁检测器 - 检测和防范分布式锁的死锁情况
 * 
 * 核心功能：
 * 1. 构建锁依赖图，检测环形依赖
 * 2. 实时监控锁的获取和释放
 * 3. 预测死锁风险并提供预警
 * 4. 提供死锁解决建议和自动恢复
 */
export class DeadlockDetector {
  constructor(options = {}) {
    // 配置参数
    this.maxLockWaitTime = options.maxLockWaitTime || 30000; // 30秒最大等待时间
    this.detectionInterval = options.detectionInterval || 5000; // 5秒检测间隔
    this.maxDependencyDepth = options.maxDependencyDepth || 10; // 最大依赖深度
    this.enableAutoResolution = options.enableAutoResolution !== false; // 自动解决死锁
    
    // 数据结构
    this.lockGraph = new Map(); // 锁依赖图: lockKey -> Set<dependentLocks>
    this.threadLocks = new Map(); // 线程持有的锁: threadId -> Set<lockKeys>
    this.waitGraph = new Map(); // 等待图: threadId -> Set<lockKeys>
    this.lockOwners = new Map(); // 锁的持有者: lockKey -> threadId
    this.lockRequests = new Map(); // 锁请求记录: requestId -> requestInfo
    this.lockHistory = []; // 锁操作历史
    
    // 统计信息
    this.stats = {
      totalLockRequests: 0,
      totalLockReleases: 0,
      deadlocksDetected: 0,
      deadlocksResolved: 0,
      falsePositives: 0,
      averageDetectionTime: 0,
      startTime: Date.now()
    };
    
    // 检测状态
    this.isDetecting = false;
    this.detectionTimer = null;
    this.currentDetectionId = 0;
    
    // 绑定方法
    this.periodicDetection = this.periodicDetection.bind(this);
    
    console.log('DeadlockDetector: 初始化完成');
  }
  
  /**
   * 启动死锁检测
   */
  startDetection() {
    if (this.isDetecting) {
      console.warn('DeadlockDetector: 检测已经在运行中');
      return;
    }
    
    this.isDetecting = true;
    this.detectionTimer = setInterval(this.periodicDetection, this.detectionInterval);
    console.log(`DeadlockDetector: 已启动死锁检测，间隔: ${this.detectionInterval}ms`);
  }
  
  /**
   * 停止死锁检测
   */
  stopDetection() {
    if (this.detectionTimer) {
      clearInterval(this.detectionTimer);
      this.detectionTimer = null;
    }
    this.isDetecting = false;
    console.log('DeadlockDetector: 已停止死锁检测');
  }
  
  /**
   * 注册锁获取请求
   * @param {string} lockKey - 锁的标识符
   * @param {string} threadId - 线程ID
   * @param {number} timestamp - 请求时间戳
   * @param {Object} metadata - 额外元数据
   */
  registerLockRequest(lockKey, threadId, timestamp = Date.now(), metadata = {}) {
    const requestId = `${threadId}_${lockKey}_${timestamp}`;
    
    const requestInfo = {
      requestId,
      lockKey,
      threadId,
      timestamp,
      status: 'waiting',
      metadata,
      waitingFor: new Set()
    };
    
    // 记录请求
    this.lockRequests.set(requestId, requestInfo);
    this.stats.totalLockRequests++;
    
    // 更新等待图
    if (!this.waitGraph.has(threadId)) {
      this.waitGraph.set(threadId, new Set());
    }
    this.waitGraph.get(threadId).add(lockKey);
    
    // 检查当前锁的持有者
    const currentOwner = this.lockOwners.get(lockKey);
    if (currentOwner && currentOwner !== threadId) {
      requestInfo.waitingFor.add(currentOwner);
      this.updateLockDependency(threadId, currentOwner);
    }
    
    // 记录历史
    this.recordLockOperation('request', lockKey, threadId, metadata);
    
    // 立即检查死锁风险
    const riskAssessment = this.assessDeadlockRisk(threadId, lockKey);
    if (riskAssessment.risk === 'high') {
      console.warn(`DeadlockDetector: 检测到高死锁风险 - 线程:${threadId}, 锁:${lockKey}`);
    }
    
    return requestId;
  }
  
  /**
   * 注册锁获取成功
   * @param {string} requestId - 请求ID
   * @param {string} lockId - 实际获取的锁ID
   */
  registerLockAcquisition(requestId, lockId) {
    const requestInfo = this.lockRequests.get(requestId);
    if (!requestInfo) {
      console.warn(`DeadlockDetector: 未找到锁请求记录: ${requestId}`);
      return;
    }
    
    const { lockKey, threadId } = requestInfo;
    
    // 更新请求状态
    requestInfo.status = 'acquired';
    requestInfo.lockId = lockId;
    requestInfo.acquiredAt = Date.now();
    
    // 更新锁持有者
    this.lockOwners.set(lockKey, threadId);
    
    // 更新线程持有的锁
    if (!this.threadLocks.has(threadId)) {
      this.threadLocks.set(threadId, new Set());
    }
    this.threadLocks.get(threadId).add(lockKey);
    
    // 清除等待状态
    const waitingLocks = this.waitGraph.get(threadId);
    if (waitingLocks) {
      waitingLocks.delete(lockKey);
      if (waitingLocks.size === 0) {
        this.waitGraph.delete(threadId);
      }
    }
    
    // 记录历史
    this.recordLockOperation('acquire', lockKey, threadId, { 
      requestId, 
      lockId,
      waitTime: requestInfo.acquiredAt - requestInfo.timestamp 
    });
    
    console.log(`DeadlockDetector: 锁获取成功 - 线程:${threadId}, 锁:${lockKey}`);
  }
  
  /**
   * 注册锁释放
   * @param {string} lockKey - 锁的标识符
   * @param {string} threadId - 线程ID
   * @param {string} lockId - 锁ID
   */
  registerLockRelease(lockKey, threadId, lockId) {
    // 更新锁持有者
    if (this.lockOwners.get(lockKey) === threadId) {
      this.lockOwners.delete(lockKey);
    }
    
    // 更新线程持有的锁
    const threadLocks = this.threadLocks.get(threadId);
    if (threadLocks) {
      threadLocks.delete(lockKey);
      if (threadLocks.size === 0) {
        this.threadLocks.delete(threadId);
      }
    }
    
    // 清理锁依赖
    this.cleanupLockDependencies(threadId, lockKey);
    
    // 更新相关的锁请求状态
    for (const [requestId, requestInfo] of this.lockRequests) {
      if (requestInfo.lockKey === lockKey && requestInfo.status === 'waiting') {
        requestInfo.waitingFor.delete(threadId);
      }
    }
    
    this.stats.totalLockReleases++;
    
    // 记录历史
    this.recordLockOperation('release', lockKey, threadId, { lockId });
    
    console.log(`DeadlockDetector: 锁释放 - 线程:${threadId}, 锁:${lockKey}`);
  }
  
  /**
   * 检查死锁风险
   * @param {string} threadId - 线程ID
   * @param {string} lockKey - 要获取的锁
   */
  checkDeadlockRisk(threadId, lockKey) {
    const riskAssessment = this.assessDeadlockRisk(threadId, lockKey);
    
    if (riskAssessment.risk === 'high') {
      console.error(`DeadlockDetector: 高死锁风险警告!`, riskAssessment);
      
      if (this.enableAutoResolution) {
        const resolution = this.generateResolutionStrategy(riskAssessment);
        if (resolution.canResolve) {
          console.log('DeadlockDetector: 尝试自动解决死锁风险');
          return { 
            hasRisk: true, 
            riskLevel: 'high',
            resolution,
            shouldBlock: resolution.recommendBlock 
          };
        }
      }
      
      return { 
        hasRisk: true, 
        riskLevel: 'high',
        shouldBlock: true,
        message: `潜在死锁风险: ${riskAssessment.reason}` 
      };
    }
    
    return { 
      hasRisk: riskAssessment.risk !== 'low', 
      riskLevel: riskAssessment.risk,
      shouldBlock: false 
    };
  }
  
  /**
   * 评估死锁风险
   * @param {string} threadId - 线程ID
   * @param {string} lockKey - 要获取的锁
   */
  assessDeadlockRisk(threadId, lockKey) {
    const assessment = {
      risk: 'low',
      confidence: 0,
      reason: '',
      cycleDetected: false,
      involvedThreads: [],
      suggestedActions: []
    };
    
    // 检查是否会形成直接环路
    const directCycle = this.detectDirectCycle(threadId, lockKey);
    if (directCycle.detected) {
      assessment.risk = 'high';
      assessment.confidence = 0.9;
      assessment.reason = '检测到直接环形依赖';
      assessment.cycleDetected = true;
      assessment.involvedThreads = directCycle.cycle;
      assessment.suggestedActions.push('拒绝当前锁请求');
      return assessment;
    }
    
    // 检查深度依赖链
    const dependencyChain = this.analyzeDependencyChain(threadId, lockKey);
    if (dependencyChain.depth > this.maxDependencyDepth) {
      assessment.risk = 'medium';
      assessment.confidence = 0.6;
      assessment.reason = `依赖链过深 (深度: ${dependencyChain.depth})`;
      assessment.suggestedActions.push('检查依赖链', '考虑重新排序锁获取');
    }
    
    // 检查等待时间
    const currentOwner = this.lockOwners.get(lockKey);
    if (currentOwner) {
      const ownerWaitTime = this.getThreadMaxWaitTime(currentOwner);
      if (ownerWaitTime > this.maxLockWaitTime * 0.8) {
        assessment.risk = assessment.risk === 'low' ? 'medium' : assessment.risk;
        assessment.confidence = Math.max(assessment.confidence, 0.5);
        assessment.reason += `; 锁持有者等待时间过长 (${ownerWaitTime}ms)`;
        assessment.suggestedActions.push('检查锁持有者状态');
      }
    }
    
    // 检查资源竞争热点
    const lockContention = this.analyzeLockContention(lockKey);
    if (lockContention.highContention) {
      assessment.risk = assessment.risk === 'low' ? 'medium' : assessment.risk;
      assessment.confidence = Math.max(assessment.confidence, 0.4);
      assessment.reason += `; 锁竞争激烈 (${lockContention.waitingThreads}个线程等待)`;
      assessment.suggestedActions.push('优化锁粒度', '考虑锁分段');
    }
    
    return assessment;
  }
  
  /**
   * 检测直接环形依赖
   * @param {string} startThread - 起始线程
   * @param {string} targetLock - 目标锁
   */
  detectDirectCycle(startThread, targetLock) {
    const visited = new Set();
    const recursionStack = new Set();
    const path = [];
    
    // 检查目标锁的当前持有者
    const lockOwner = this.lockOwners.get(targetLock);
    if (!lockOwner) {
      return { detected: false, cycle: [] };
    }
    
    // 从锁持有者开始DFS搜索
    const cycleDetected = this.dfsDetectCycle(
      lockOwner, 
      startThread, 
      visited, 
      recursionStack, 
      path
    );
    
    if (cycleDetected) {
      return { 
        detected: true, 
        cycle: [...path, startThread],
        lockInvolved: targetLock
      };
    }
    
    return { detected: false, cycle: [] };
  }
  
  /**
   * DFS检测环形依赖
   * @param {string} currentThread - 当前线程
   * @param {string} targetThread - 目标线程
   * @param {Set} visited - 已访问的线程
   * @param {Set} recursionStack - 递归栈
   * @param {Array} path - 路径记录
   */
  dfsDetectCycle(currentThread, targetThread, visited, recursionStack, path) {
    if (currentThread === targetThread) {
      return true; // 找到环路
    }
    
    if (recursionStack.has(currentThread)) {
      return true; // 发现环路
    }
    
    if (visited.has(currentThread)) {
      return false; // 已访问过，无环路
    }
    
    visited.add(currentThread);
    recursionStack.add(currentThread);
    path.push(currentThread);
    
    // 查找当前线程等待的锁
    const waitingLocks = this.waitGraph.get(currentThread);
    if (waitingLocks) {
      for (const lockKey of waitingLocks) {
        const lockOwner = this.lockOwners.get(lockKey);
        if (lockOwner && lockOwner !== currentThread) {
          if (this.dfsDetectCycle(lockOwner, targetThread, visited, recursionStack, path)) {
            return true;
          }
        }
      }
    }
    
    recursionStack.delete(currentThread);
    path.pop();
    return false;
  }
  
  /**
   * 分析依赖链深度
   * @param {string} threadId - 线程ID
   * @param {string} lockKey - 锁键
   */
  analyzeDependencyChain(threadId, lockKey) {
    const chain = [];
    const visited = new Set();
    let currentThread = threadId;
    let depth = 0;
    
    while (currentThread && !visited.has(currentThread) && depth < this.maxDependencyDepth) {
      visited.add(currentThread);
      chain.push(currentThread);
      depth++;
      
      // 查找当前线程等待的锁
      const waitingLocks = this.waitGraph.get(currentThread);
      if (waitingLocks && waitingLocks.size > 0) {
        const nextLock = waitingLocks.values().next().value;
        currentThread = this.lockOwners.get(nextLock);
      } else {
        break;
      }
    }
    
    return {
      depth,
      chain,
      hasLoop: visited.size < depth // 如果访问的节点数少于深度，说明有环路
    };
  }
  
  /**
   * 分析锁竞争情况
   * @param {string} lockKey - 锁键
   */
  analyzeLockContention(lockKey) {
    let waitingThreads = 0;
    let totalWaitTime = 0;
    
    for (const [requestId, requestInfo] of this.lockRequests) {
      if (requestInfo.lockKey === lockKey && requestInfo.status === 'waiting') {
        waitingThreads++;
        totalWaitTime += Date.now() - requestInfo.timestamp;
      }
    }
    
    const avgWaitTime = waitingThreads > 0 ? totalWaitTime / waitingThreads : 0;
    
    return {
      waitingThreads,
      avgWaitTime,
      totalWaitTime,
      highContention: waitingThreads > 3 || avgWaitTime > this.maxLockWaitTime * 0.5
    };
  }
  
  /**
   * 获取线程最大等待时间
   * @param {string} threadId - 线程ID
   */
  getThreadMaxWaitTime(threadId) {
    let maxWaitTime = 0;
    
    for (const [requestId, requestInfo] of this.lockRequests) {
      if (requestInfo.threadId === threadId && requestInfo.status === 'waiting') {
        const waitTime = Date.now() - requestInfo.timestamp;
        if (waitTime > maxWaitTime) {
          maxWaitTime = waitTime;
        }
      }
    }
    
    return maxWaitTime;
  }
  
  /**
   * 更新锁依赖关系
   * @param {string} waitingThread - 等待的线程
   * @param {string} holdingThread - 持有锁的线程
   */
  updateLockDependency(waitingThread, holdingThread) {
    if (!this.lockGraph.has(waitingThread)) {
      this.lockGraph.set(waitingThread, new Set());
    }
    this.lockGraph.get(waitingThread).add(holdingThread);
  }
  
  /**
   * 清理锁依赖关系
   * @param {string} threadId - 线程ID
   * @param {string} lockKey - 锁键
   */
  cleanupLockDependencies(threadId, lockKey) {
    // 清理与该锁相关的依赖关系
    for (const [thread, dependencies] of this.lockGraph) {
      if (thread === threadId) {
        // 清理该线程的依赖
        const waitingLocks = this.waitGraph.get(threadId);
        if (!waitingLocks || waitingLocks.size === 0) {
          dependencies.clear();
        }
      } else {
        // 如果其他线程依赖这个线程，检查是否还需要
        if (dependencies.has(threadId)) {
          const threadLocks = this.threadLocks.get(threadId);
          if (!threadLocks || threadLocks.size === 0) {
            dependencies.delete(threadId);
          }
        }
      }
    }
    
    // 清理空的依赖关系
    for (const [thread, dependencies] of this.lockGraph) {
      if (dependencies.size === 0) {
        this.lockGraph.delete(thread);
      }
    }
  }
  
  /**
   * 记录锁操作历史
   * @param {string} operation - 操作类型
   * @param {string} lockKey - 锁键
   * @param {string} threadId - 线程ID
   * @param {Object} metadata - 元数据
   */
  recordLockOperation(operation, lockKey, threadId, metadata = {}) {
    const record = {
      timestamp: Date.now(),
      operation,
      lockKey,
      threadId,
      ...metadata
    };
    
    this.lockHistory.push(record);
    
    // 限制历史记录大小
    if (this.lockHistory.length > 1000) {
      this.lockHistory.shift();
    }
  }
  
  /**
   * 定期死锁检测
   */
  periodicDetection() {
    const detectionId = ++this.currentDetectionId;
    const startTime = Date.now();
    
    try {
      const deadlocks = this.performFullDeadlockDetection();
      const detectionTime = Date.now() - startTime;
      
      // 更新平均检测时间
      this.stats.averageDetectionTime = 
        (this.stats.averageDetectionTime + detectionTime) / 2;
      
      if (deadlocks.length > 0) {
        console.error(`DeadlockDetector: 检测到 ${deadlocks.length} 个死锁!`);
        this.stats.deadlocksDetected += deadlocks.length;
        
        for (const deadlock of deadlocks) {
          console.error('死锁详情:', deadlock);
          
          if (this.enableAutoResolution) {
            this.attemptDeadlockResolution(deadlock);
          }
        }
      }
      
    } catch (error) {
      console.error(`DeadlockDetector: 检测过程发生错误 (ID:${detectionId}):`, error.message);
    }
  }
  
  /**
   * 执行完整的死锁检测
   */
  performFullDeadlockDetection() {
    const deadlocks = [];
    const allThreads = new Set([
      ...this.threadLocks.keys(),
      ...this.waitGraph.keys()
    ]);
    
    for (const threadId of allThreads) {
      const visited = new Set();
      const recursionStack = new Set();
      const path = [];
      
      if (this.detectCycleFromThread(threadId, visited, recursionStack, path)) {
        // 发现死锁环路
        const cycle = [...path];
        const involvedLocks = this.getInvolvedLocks(cycle);
        
        deadlocks.push({
          type: 'circular_wait',
          involvedThreads: cycle,
          involvedLocks,
          detectedAt: Date.now(),
          severity: this.assessDeadlockSeverity(cycle, involvedLocks)
        });
      }
    }
    
    return deadlocks;
  }
  
  /**
   * 从指定线程开始检测环形等待
   * @param {string} threadId - 起始线程ID
   * @param {Set} visited - 已访问线程
   * @param {Set} recursionStack - 递归栈
   * @param {Array} path - 路径记录
   */
  detectCycleFromThread(threadId, visited, recursionStack, path) {
    if (recursionStack.has(threadId)) {
      // 找到环路
      const cycleStart = path.indexOf(threadId);
      path.splice(0, cycleStart); // 保留环路部分
      return true;
    }
    
    if (visited.has(threadId)) {
      return false;
    }
    
    visited.add(threadId);
    recursionStack.add(threadId);
    path.push(threadId);
    
    // 查找该线程等待的锁
    const waitingLocks = this.waitGraph.get(threadId);
    if (waitingLocks) {
      for (const lockKey of waitingLocks) {
        const lockOwner = this.lockOwners.get(lockKey);
        if (lockOwner && lockOwner !== threadId) {
          if (this.detectCycleFromThread(lockOwner, visited, recursionStack, path)) {
            return true;
          }
        }
      }
    }
    
    recursionStack.delete(threadId);
    path.pop();
    return false;
  }
  
  /**
   * 获取死锁涉及的锁
   * @param {Array} threadCycle - 线程环路
   */
  getInvolvedLocks(threadCycle) {
    const locks = new Set();
    
    for (let i = 0; i < threadCycle.length; i++) {
      const currentThread = threadCycle[i];
      const nextThread = threadCycle[(i + 1) % threadCycle.length];
      
      // 查找当前线程等待的、由下一个线程持有的锁
      const waitingLocks = this.waitGraph.get(currentThread);
      if (waitingLocks) {
        for (const lockKey of waitingLocks) {
          if (this.lockOwners.get(lockKey) === nextThread) {
            locks.add(lockKey);
          }
        }
      }
    }
    
    return Array.from(locks);
  }
  
  /**
   * 评估死锁严重程度
   * @param {Array} threadCycle - 线程环路
   * @param {Array} involvedLocks - 涉及的锁
   */
  assessDeadlockSeverity(threadCycle, involvedLocks) {
    let severity = 'medium';
    
    // 基于涉及的线程数量
    if (threadCycle.length > 5) {
      severity = 'high';
    } else if (threadCycle.length === 2) {
      severity = 'low';
    }
    
    // 基于涉及的锁数量
    if (involvedLocks.length > 3) {
      severity = 'high';
    }
    
    // 基于等待时间
    let maxWaitTime = 0;
    for (const threadId of threadCycle) {
      const waitTime = this.getThreadMaxWaitTime(threadId);
      if (waitTime > maxWaitTime) {
        maxWaitTime = waitTime;
      }
    }
    
    if (maxWaitTime > this.maxLockWaitTime) {
      severity = 'high';
    }
    
    return severity;
  }
  
  /**
   * 生成解决策略
   * @param {Object} riskAssessment - 风险评估结果
   */
  generateResolutionStrategy(riskAssessment) {
    const strategy = {
      canResolve: false,
      methods: [],
      recommendBlock: true,
      estimatedSuccess: 0
    };
    
    if (riskAssessment.cycleDetected) {
      // 对于直接环路，建议拒绝请求
      strategy.methods.push({
        type: 'request_rejection',
        description: '拒绝当前锁请求以打破环路',
        priority: 'high',
        success: 0.9
      });
      strategy.canResolve = true;
      strategy.estimatedSuccess = 0.9;
    }
    
    if (riskAssessment.involvedThreads.length > 0) {
      // 建议超时处理
      strategy.methods.push({
        type: 'timeout_resolution',
        description: '通过超时机制强制释放部分锁',
        priority: 'medium',
        success: 0.7
      });
      
      // 建议重新排序
      strategy.methods.push({
        type: 'lock_ordering',
        description: '建议重新排序锁的获取顺序',
        priority: 'low',
        success: 0.8
      });
    }
    
    return strategy;
  }
  
  /**
   * 尝试自动解决死锁
   * @param {Object} deadlock - 死锁信息
   */
  attemptDeadlockResolution(deadlock) {
    console.log(`DeadlockDetector: 尝试解决死锁 - 涉及线程: ${deadlock.involvedThreads.join(', ')}`);
    
    // 选择牺牲线程（简单策略：选择等待时间最短的线程）
    let victimThread = null;
    let minWaitTime = Infinity;
    
    for (const threadId of deadlock.involvedThreads) {
      const waitTime = this.getThreadMaxWaitTime(threadId);
      if (waitTime < minWaitTime) {
        minWaitTime = waitTime;
        victimThread = threadId;
      }
    }
    
    if (victimThread) {
      console.log(`DeadlockDetector: 选择牺牲线程: ${victimThread}`);
      
      // 强制释放该线程的所有锁请求
      this.forceReleaseThreadRequests(victimThread);
      
      this.stats.deadlocksResolved++;
      
      return {
        resolved: true,
        victimThread,
        method: 'thread_sacrifice',
        timestamp: Date.now()
      };
    }
    
    return { resolved: false, reason: 'No suitable victim thread found' };
  }
  
  /**
   * 强制释放线程的锁请求
   * @param {string} threadId - 线程ID
   */
  forceReleaseThreadRequests(threadId) {
    // 找到该线程的所有等待中的请求
    const requestsToCancel = [];
    
    for (const [requestId, requestInfo] of this.lockRequests) {
      if (requestInfo.threadId === threadId && requestInfo.status === 'waiting') {
        requestsToCancel.push(requestId);
      }
    }
    
    // 取消这些请求
    for (const requestId of requestsToCancel) {
      const requestInfo = this.lockRequests.get(requestId);
      requestInfo.status = 'cancelled';
      requestInfo.cancelledAt = Date.now();
      requestInfo.cancelReason = 'deadlock_resolution';
    }
    
    // 清理等待图
    this.waitGraph.delete(threadId);
    
    // 清理依赖图
    this.lockGraph.delete(threadId);
    
    console.log(`DeadlockDetector: 已取消线程 ${threadId} 的 ${requestsToCancel.length} 个锁请求`);
  }
  
  /**
   * 获取死锁检测统计信息
   */
  getDetectionStatistics() {
    const runtime = Date.now() - this.stats.startTime;
    
    return {
      // 基本统计
      totalLockRequests: this.stats.totalLockRequests,
      totalLockReleases: this.stats.totalLockReleases,
      deadlocksDetected: this.stats.deadlocksDetected,
      deadlocksResolved: this.stats.deadlocksResolved,
      falsePositives: this.stats.falsePositives,
      
      // 当前状态
      activeLocks: this.lockOwners.size,
      activeThreads: this.threadLocks.size,
      waitingThreads: this.waitGraph.size,
      pendingRequests: Array.from(this.lockRequests.values())
        .filter(req => req.status === 'waiting').length,
      
      // 性能指标
      averageDetectionTime: this.stats.averageDetectionTime,
      detectionEfficiency: this.stats.deadlocksResolved / Math.max(this.stats.deadlocksDetected, 1),
      falsePositiveRate: this.stats.falsePositives / Math.max(this.stats.totalLockRequests, 1),
      
      // 运行时信息
      runtime,
      isDetecting: this.isDetecting,
      detectionInterval: this.detectionInterval
    };
  }
  
  /**
   * 生成死锁检测报告
   */
  generateDeadlockReport() {
    const stats = this.getDetectionStatistics();
    const recentHistory = this.lockHistory.slice(-50); // 最近50条操作
    
    return {
      timestamp: new Date().toISOString(),
      
      summary: {
        status: this.isDetecting ? 'active' : 'inactive',
        totalDeadlocks: stats.deadlocksDetected,
        resolvedDeadlocks: stats.deadlocksResolved,
        currentActiveLocks: stats.activeLocks,
        currentWaitingThreads: stats.waitingThreads
      },
      
      statistics: stats,
      
      currentState: {
        lockOwners: Array.from(this.lockOwners.entries()),
        threadLocks: Array.from(this.threadLocks.entries()).map(([thread, locks]) => ({
          thread,
          locks: Array.from(locks)
        })),
        waitingThreads: Array.from(this.waitGraph.entries()).map(([thread, locks]) => ({
          thread,
          waitingFor: Array.from(locks)
        }))
      },
      
      recentActivity: recentHistory,
      
      health: this.assessDetectorHealth(stats),
      
      recommendations: this.generateOptimizationRecommendations(stats)
    };
  }
  
  /**
   * 评估检测器健康状况
   */
  assessDetectorHealth(stats) {
    let status = 'healthy';
    let issues = [];
    let score = 100;
    
    // 检查死锁检测效率
    if (stats.detectionEfficiency < 0.8 && stats.deadlocksDetected > 0) {
      status = 'warning';
      issues.push('死锁解决效率较低');
      score -= 20;
    }
    
    // 检查误报率
    if (stats.falsePositiveRate > 0.1) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push('误报率过高');
      score -= 15;
    }
    
    // 检查平均检测时间
    if (stats.averageDetectionTime > 1000) { // 超过1秒
      status = status === 'healthy' ? 'warning' : status;
      issues.push('检测时间过长');
      score -= 10;
    }
    
    // 检查等待线程数量
    if (stats.waitingThreads > 10) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push('等待线程数量过多');
      score -= 10;
    }
    
    return {
      status,
      score: Math.max(0, score),
      issues,
      uptime: stats.runtime
    };
  }
  
  /**
   * 生成优化建议
   */
  generateOptimizationRecommendations(stats) {
    const recommendations = [];
    
    if (stats.deadlocksDetected > 0) {
      recommendations.push({
        type: 'deadlock_prevention',
        priority: 'high',
        message: '建议优化锁的获取顺序以减少死锁',
        actions: [
          '实施统一的锁排序策略',
          '减少锁的持有时间',
          '考虑使用更细粒度的锁'
        ]
      });
    }
    
    if (stats.averageDetectionTime > 500) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        message: '检测性能可以进一步优化',
        actions: [
          '增加检测间隔以减少CPU使用',
          '优化数据结构以提高检测效率',
          '考虑异步检测策略'
        ]
      });
    }
    
    if (stats.waitingThreads > 5) {
      recommendations.push({
        type: 'concurrency',
        priority: 'medium',
        message: '高并发场景下建议优化锁策略',
        actions: [
          '实施锁分段策略',
          '使用读写锁优化读多写少场景',
          '考虑无锁数据结构'
        ]
      });
    }
    
    return recommendations;
  }
  
  /**
   * 重置检测器状态
   */
  reset() {
    console.log('DeadlockDetector: 重置检测器状态');
    
    // 清空所有数据结构
    this.lockGraph.clear();
    this.threadLocks.clear();
    this.waitGraph.clear();
    this.lockOwners.clear();
    this.lockRequests.clear();
    this.lockHistory = [];
    
    // 重置统计信息
    this.stats = {
      totalLockRequests: 0,
      totalLockReleases: 0,
      deadlocksDetected: 0,
      deadlocksResolved: 0,
      falsePositives: 0,
      averageDetectionTime: 0,
      startTime: Date.now()
    };
    
    this.currentDetectionId = 0;
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    console.log('DeadlockDetector: 开始清理...');
    
    // 停止检测
    this.stopDetection();
    
    // 生成最终报告
    const finalReport = this.generateDeadlockReport();
    
    // 重置状态
    this.reset();
    
    console.log('DeadlockDetector: 清理完成');
    return finalReport;
  }
}