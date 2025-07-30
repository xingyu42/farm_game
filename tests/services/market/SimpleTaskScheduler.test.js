/**
 * SimpleTaskScheduler 单元测试
 */

import { SimpleTaskScheduler } from '../../../services/market/SimpleTaskScheduler.js';

// 模拟global.logger
global.logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('SimpleTaskScheduler', () => {
  let mockTaskConfig;
  let mockLockManager;
  let scheduler;

  beforeEach(() => {
    mockTaskConfig = {
      getTaskDefinitions: jest.fn().mockReturnValue([
        { name: 'task1', interval: 1000, timeout: 5000, retryAttempts: 2, enabled: true },
        { name: 'task2', interval: 2000, timeout: 5000, retryAttempts: 1, enabled: true },
        { name: 'statsReset', interval: 60000, timeout: 5000, retryAttempts: 1, enabled: true }
      ])
    };

    mockLockManager = {
      withLock: jest.fn().mockImplementation(async (key, operation, timeout) => {
        return await operation();
      })
    };

    scheduler = new SimpleTaskScheduler(mockTaskConfig, mockLockManager);

    // 清除mock调用记录
    jest.clearAllMocks();

    // 模拟setInterval和clearInterval
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    scheduler.stop();
  });

  describe('构造函数和基础功能', () => {
    test('应该能创建SimpleTaskScheduler实例', () => {
      expect(scheduler).toBeInstanceOf(SimpleTaskScheduler);
      expect(scheduler.taskConfig).toBe(mockTaskConfig);
      expect(scheduler.lockManager).toBe(mockLockManager);
      expect(scheduler.isRunning).toBe(false);
    });
  });

  describe('启动和停止', () => {
    test('应该能启动调度器', () => {
      scheduler.start();
      
      expect(scheduler.isRunning).toBe(true);
      expect(mockTaskConfig.getTaskDefinitions).toHaveBeenCalledTimes(1);
      expect(global.logger.info).toHaveBeenCalledWith('[SimpleTaskScheduler] 启动调度器，任务数量: 3');
      expect(scheduler.jobs.size).toBe(3);
    });

    test('应该能停止调度器', () => {
      scheduler.start();
      scheduler.stop();
      
      expect(scheduler.isRunning).toBe(false);
      expect(scheduler.jobs.size).toBe(0);
      expect(global.logger.info).toHaveBeenCalledWith('[SimpleTaskScheduler] 调度器已停止');
    });

    test('应该防止重复启动', () => {
      scheduler.start();
      scheduler.start(); // 第二次启动
      
      expect(global.logger.warn).toHaveBeenCalledWith('[SimpleTaskScheduler] 调度器已在运行中');
      expect(mockTaskConfig.getTaskDefinitions).toHaveBeenCalledTimes(1); // 只调用一次
    });
  });

  describe('任务调度', () => {
    test('应该为每个任务创建定时器', () => {
      scheduler.start();
      
      expect(scheduler.jobs.has('task1')).toBe(true);
      expect(scheduler.jobs.has('task2')).toBe(true);
      expect(scheduler.jobs.has('statsReset')).toBe(true);
    });

    test('应该在指定间隔触发任务', () => {
      const mockTrigger = jest.fn();
      scheduler._onTaskTrigger = mockTrigger;
      
      scheduler.start();
      
      // 快进1秒，应该触发task1
      jest.advanceTimersByTime(1000);
      expect(mockTrigger).toHaveBeenCalledWith('task1', 5000);
      
      // 再快进1秒，应该再次触发task1和首次触发task2
      jest.advanceTimersByTime(1000);
      expect(mockTrigger).toHaveBeenCalledWith('task2', 5000);
      expect(mockTrigger).toHaveBeenCalledTimes(3); // task1触发2次，task2触发1次
    });

    test('应该正确处理statsReset任务的特殊时机', () => {
      const mockTrigger = jest.fn();
      scheduler._onTaskTrigger = mockTrigger;
      
      // 模拟非午夜时间
      const mockDate = new Date('2023-01-01T10:30:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);
      
      scheduler.start();
      jest.advanceTimersByTime(60000); // 触发statsReset间隔
      
      // 非午夜时间不应该触发statsReset
      expect(mockTrigger).not.toHaveBeenCalledWith('statsReset', expect.any(Number));
      
      // 模拟午夜时间
      mockDate.setHours(0, 0, 0, 0);
      jest.advanceTimersByTime(60000);
      
      // 午夜时间应该触发statsReset
      expect(mockTrigger).toHaveBeenCalledWith('statsReset', 5000);
      
      global.Date.mockRestore();
    });
  });

  describe('手动任务执行', () => {
    test('应该能手动执行任务', async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue({ success: true });
      
      const result = await scheduler.executeTask('testTask', mockTaskFunction, 5000);
      
      expect(mockLockManager.withLock).toHaveBeenCalledWith(
        'scheduler:testTask',
        expect.any(Function),
        10000 // timeout + 5000
      );
      expect(mockTaskFunction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
      expect(global.logger.info).toHaveBeenCalledWith('[SimpleTaskScheduler] 开始执行任务: testTask');
    });

    test('应该记录任务执行时间', async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue({ success: true });
      
      await scheduler.executeTask('testTask', mockTaskFunction, 5000);
      
      expect(global.logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/\[SimpleTaskScheduler\] 任务完成: testTask, 耗时: \d+ms/)
      );
    });

    test('应该处理任务执行失败', async () => {
      const error = new Error('Task failed');
      const mockTaskFunction = jest.fn().mockRejectedValue(error);
      
      await expect(scheduler.executeTask('testTask', mockTaskFunction, 5000)).rejects.toThrow('Task failed');
      
      expect(global.logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/\[SimpleTaskScheduler\] 任务失败: testTask, 耗时: \d+ms/),
        { error: 'Task failed' }
      );
    });
  });

  describe('超时控制', () => {
    test('应该在超时时中断任务', async () => {
      const mockTaskFunction = jest.fn().mockImplementation(() => {
        return new Promise(resolve => setTimeout(resolve, 10000)); // 10秒任务
      });
      
      const executePromise = scheduler.executeTask('testTask', mockTaskFunction, 1000); // 1秒超时
      
      // 快进到超时
      jest.advanceTimersByTime(1000);
      
      await expect(executePromise).rejects.toThrow('Task timeout after 1000ms');
    });

    test('应该在任务完成时正常返回', async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue({ success: true });
      
      const result = await scheduler.executeTask('testTask', mockTaskFunction, 5000);
      
      expect(result).toEqual({ success: true });
      expect(mockTaskFunction).toHaveBeenCalledTimes(1);
    });
  });

  describe('分布式锁集成', () => {
    test('应该使用正确的锁键', async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue({ success: true });
      
      await scheduler.executeTask('myTask', mockTaskFunction, 5000);
      
      expect(mockLockManager.withLock).toHaveBeenCalledWith(
        'scheduler:myTask',
        expect.any(Function),
        10000
      );
    });

    test('应该在锁获取失败时抛出错误', async () => {
      const lockError = new Error('获取锁失败: scheduler:testTask');
      mockLockManager.withLock.mockRejectedValue(lockError);
      
      const mockTaskFunction = jest.fn();
      
      await expect(scheduler.executeTask('testTask', mockTaskFunction, 5000)).rejects.toThrow('获取锁失败: scheduler:testTask');
      
      expect(mockTaskFunction).not.toHaveBeenCalled();
    });
  });

  describe('错误处理和日志', () => {
    test('应该记录调度器启动日志', () => {
      scheduler.start();
      
      expect(global.logger.info).toHaveBeenCalledWith('[SimpleTaskScheduler] 启动调度器，任务数量: 3');
      expect(global.logger.info).toHaveBeenCalledWith('[SimpleTaskScheduler] 调度器启动成功，活跃任务: task1, task2, statsReset');
    });

    test('应该记录调度器停止日志', () => {
      scheduler.start();
      scheduler.stop();
      
      expect(global.logger.info).toHaveBeenCalledWith('[SimpleTaskScheduler] 停止调度器');
      expect(global.logger.debug).toHaveBeenCalledWith('[SimpleTaskScheduler] 停止任务: task1');
      expect(global.logger.debug).toHaveBeenCalledWith('[SimpleTaskScheduler] 停止任务: task2');
      expect(global.logger.debug).toHaveBeenCalledWith('[SimpleTaskScheduler] 停止任务: statsReset');
    });
  });
});
