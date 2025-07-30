/**
 * TaskConfig 单元测试
 */

import { TaskConfig } from '../../../services/market/TaskConfig.js';

// 模拟global.logger
global.logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('TaskConfig', () => {
  describe('构造函数和基础功能', () => {
    test('应该能创建TaskConfig实例', () => {
      const config = { market: { scheduler: { enabled: true } } };
      const taskConfig = new TaskConfig(config);
      expect(taskConfig).toBeInstanceOf(TaskConfig);
    });

    test('应该能处理空配置', () => {
      const config = {};
      const taskConfig = new TaskConfig(config);
      expect(taskConfig).toBeInstanceOf(TaskConfig);
      expect(global.logger.warn).toHaveBeenCalledWith('[TaskConfig] 未找到调度器配置，使用默认值');
    });
  });

  describe('配置验证', () => {
    test('应该验证有效配置', () => {
      const config = {
        market: {
          scheduler: {
            task_timeout: 300000,
            retry_attempts: 2,
            max_concurrent_tasks: 3,
            tasks: [
              {
                name: 'testTask',
                interval: 60000,
                timeout: 30000,
                retryAttempts: 1,
                enabled: true
              }
            ]
          }
        }
      };
      
      const taskConfig = new TaskConfig(config);
      const validation = taskConfig.validateConfig();
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('应该检测无效配置', () => {
      const config = {
        market: {
          scheduler: {
            task_timeout: -1,
            retry_attempts: 'invalid',
            max_concurrent_tasks: 0,
            tasks: [
              {
                name: '',
                interval: 0,
                timeout: -100,
                retryAttempts: -1,
                enabled: 'not_boolean'
              }
            ]
          }
        }
      };
      
      const taskConfig = new TaskConfig(config);
      const validation = taskConfig.validateConfig();
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors).toContain('task_timeout必须是正数');
      expect(validation.errors).toContain('retry_attempts必须是非负数');
    });
  });

  describe('任务定义管理', () => {
    test('应该返回启用的任务定义', () => {
      const config = {
        market: {
          scheduler: {
            tasks: [
              { name: 'task1', interval: 60000, timeout: 30000, retryAttempts: 1, enabled: true },
              { name: 'task2', interval: 60000, timeout: 30000, retryAttempts: 1, enabled: false },
              { name: 'task3', interval: 60000, timeout: 30000, retryAttempts: 1, enabled: true }
            ]
          }
        }
      };
      
      const taskConfig = new TaskConfig(config);
      const tasks = taskConfig.getTaskDefinitions();
      
      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => t.name)).toEqual(['task1', 'task3']);
    });

    test('应该能根据名称查找任务', () => {
      const config = {
        market: {
          scheduler: {
            tasks: [
              { name: 'findMe', interval: 60000, timeout: 30000, retryAttempts: 1, enabled: true }
            ]
          }
        }
      };
      
      const taskConfig = new TaskConfig(config);
      const task = taskConfig.getTaskDefinition('findMe');
      
      expect(task).toBeTruthy();
      expect(task.name).toBe('findMe');
      
      const notFound = taskConfig.getTaskDefinition('notExists');
      expect(notFound).toBeNull();
    });

    test('应该使用默认任务定义当配置中没有任务时', () => {
      const config = {
        market: {
          update: { interval: 3600 },
          scheduler: { task_timeout: 300000, retry_attempts: 2 }
        }
      };
      
      const taskConfig = new TaskConfig(config);
      const tasks = taskConfig.getTaskDefinitions();
      
      expect(tasks).toHaveLength(3);
      expect(tasks.map(t => t.name)).toEqual(['priceUpdate', 'statsReset', 'monitoring']);
    });
  });

  describe('调度器配置', () => {
    test('应该返回合并后的调度器配置', () => {
      const config = {
        market: {
          scheduler: {
            enabled: true,
            max_concurrent_tasks: 5,
            task_timeout: 600000
          }
        }
      };
      
      const taskConfig = new TaskConfig(config);
      const schedulerConfig = taskConfig.getSchedulerConfig();
      
      expect(schedulerConfig.enabled).toBe(true);
      expect(schedulerConfig.max_concurrent_tasks).toBe(5);
      expect(schedulerConfig.task_timeout).toBe(600000);
      expect(schedulerConfig.retry_attempts).toBe(2); // 默认值
    });

    test('应该使用默认调度器配置', () => {
      const config = {};
      const taskConfig = new TaskConfig(config);
      const schedulerConfig = taskConfig.getSchedulerConfig();
      
      expect(schedulerConfig.enabled).toBe(true);
      expect(schedulerConfig.max_concurrent_tasks).toBe(3);
      expect(schedulerConfig.task_timeout).toBe(300000);
      expect(schedulerConfig.retry_attempts).toBe(2);
      expect(schedulerConfig.lock_ttl).toBe(600000);
    });
  });

  describe('任务定义标准化', () => {
    test('应该正确标准化任务定义', () => {
      const config = {
        market: {
          scheduler: {
            task_timeout: 300000,
            retry_attempts: 2,
            tasks: [
              {
                name: 'testTask',
                interval: 60000
                // 缺少其他字段，应该使用默认值
              }
            ]
          }
        }
      };
      
      const taskConfig = new TaskConfig(config);
      const tasks = taskConfig.getTaskDefinitions();
      const task = tasks[0];
      
      expect(task.name).toBe('testTask');
      expect(task.interval).toBe(60000);
      expect(task.timeout).toBe(300000); // 使用调度器默认值
      expect(task.retryAttempts).toBe(2); // 使用调度器默认值
      expect(task.enabled).toBe(true); // 默认启用
      expect(task.description).toBe('testTask任务'); // 自动生成描述
    });
  });
});
