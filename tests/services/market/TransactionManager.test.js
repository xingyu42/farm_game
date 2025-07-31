/**
 * TransactionManager 单元测试
 * 
 * 测试事务管理服务的核心功能：
 * - 分布式锁管理
 * - 事务性批量更新
 * - 原子性操作执行
 * - 死锁检测
 * - 错误处理和回滚
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { TransactionManager } from '../../../services/market/TransactionManager.js';

// 创建一个简单的mock对象，直接注入到TransactionManager构造函数中
const createMockLockManager = () => ({
  withLock: jest.fn(),
  acquire: jest.fn(),
  release: jest.fn()
});

// 模拟global.logger
global.logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('TransactionManager', () => {
  let transactionManager;
  let mockRedisClient;
  let mockConfig;
  let mockLockManager;

  beforeEach(() => {
    mockRedisClient = {
      keyPrefix: 'farm_game',
      multi: jest.fn(),
      pipeline: jest.fn(),
      keys: jest.fn(),
      get: jest.fn(),
      ttl: jest.fn()
    };

    mockConfig = {
      market: {
        transaction: {
          lock_timeout: 30000,
          max_retries: 3,
          retry_delay: 1000
        }
      }
    };

    // 创建新的mockLockManager实例
    mockLockManager = createMockLockManager();

    transactionManager = new TransactionManager(mockRedisClient, mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('构造函数', () => {
    test('应该正确初始化配置和依赖', () => {
      expect(transactionManager.redis).toBe(mockRedisClient);
      expect(transactionManager.config).toBe(mockConfig);
      expect(transactionManager.lockManager).toBeDefined();
      expect(transactionManager.lockTimeout).toBe(30000);
      expect(transactionManager.maxRetries).toBe(3);
      expect(transactionManager.retryDelay).toBe(1000);
      expect(transactionManager.activeTransactions).toBeInstanceOf(Map);
    });

    test('应该使用默认配置当配置缺失时', () => {
      const managerWithoutConfig = new TransactionManager(mockRedisClient, {});
      expect(managerWithoutConfig.lockTimeout).toBe(30000); // 默认值
      expect(managerWithoutConfig.maxRetries).toBe(3);
      expect(managerWithoutConfig.retryDelay).toBe(1000);
    });
  });

  describe('executeBatchUpdate', () => {
    test('应该成功执行批量更新操作', async () => {
      const operations = [
        {
          type: 'hset',
          key: 'market:stats:item1',
          data: { current_price: '100', last_updated: '1634567890000' }
        },
        {
          type: 'hset',
          key: 'market:stats:item2',
          data: { current_price: '200', last_updated: '1634567890000' }
        }
      ];

      // 模拟lockManager.withLock方法
      jest.spyOn(transactionManager.lockManager, 'withLock').mockImplementation(async (key, callback) => {
        return await callback();
      });

      // 模拟Redis事务
      const mockMulti = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]])
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      const result = await transactionManager.executeBatchUpdate(operations);

      expect(result.success).toBe(true);
      expect(result.operationsCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.errors).toEqual([]);
      expect(mockMulti.hSet).toHaveBeenCalledTimes(2);
    });

    test('应该验证操作格式', async () => {
      const invalidOperations = [
        { type: 'hset' }, // 缺少key
        { key: 'test:key' }, // 缺少type
        { type: 'hset', key: 'test:key' } // hset缺少data
      ];

      // 模拟锁获取成功，使验证能够执行
      jest.spyOn(transactionManager, '_acquireLockWithRetry').mockResolvedValue(true);

      await expect(transactionManager.executeBatchUpdate(invalidOperations))
        .rejects.toThrow('操作验证失败');
    });

    test('应该处理获取锁失败', async () => {
      const operations = [{ type: 'hset', key: 'test:key', data: { value: '1' } }];

      // 模拟获取锁失败
      jest.spyOn(transactionManager, '_acquireLockWithRetry').mockResolvedValue(false);

      await expect(transactionManager.executeBatchUpdate(operations))
        .rejects.toThrow('获取事务锁失败');
    });

    test('应该跟踪活跃事务', async () => {
      const operations = [{ type: 'hset', key: 'test:key', data: { value: '1' } }];

      // 模拟lockManager.withLock方法
      jest.spyOn(transactionManager.lockManager, 'withLock').mockImplementation(async (key, callback) => {
        // 在锁内检查活跃事务
        expect(transactionManager.activeTransactions.size).toBe(1);
        return await callback();
      });

      const mockMulti = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1]])
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      await transactionManager.executeBatchUpdate(operations);

      // 事务完成后应该清理
      expect(transactionManager.activeTransactions.size).toBe(0);
    });

    test('应该处理Redis事务执行错误', async () => {
      const operations = [
        { type: 'hset', key: 'test:key1', data: { value: '1' } },
        { type: 'hset', key: 'test:key2', data: { value: '2' } },
        { type: 'hset', key: 'test:key3', data: { value: '3' } },
        { type: 'hset', key: 'test:key4', data: { value: '4' } },
        { type: 'hset', key: 'test:key5', data: { value: '5' } },
        { type: 'hset', key: 'test:key6', data: { value: '6' } },
        { type: 'hset', key: 'test:key7', data: { value: '7' } },
        { type: 'hset', key: 'test:key8', data: { value: '8' } },
        { type: 'hset', key: 'test:key9', data: { value: '9' } },
        { type: 'hset', key: 'test:key10', data: { value: '10' } },
        { type: 'hset', key: 'test:key11', data: { value: '11' } }
      ];

      // 模拟lockManager.withLock方法
      jest.spyOn(transactionManager.lockManager, 'withLock').mockImplementation(async (key, callback) => {
        return await callback();
      });

      const mockMulti = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [new Error('Redis错误'), null], // 第一个失败 (错误率约9%)
          [null, 1], [null, 1], [null, 1], [null, 1], [null, 1], 
          [null, 1], [null, 1], [null, 1], [null, 1], [null, 1] // 其余成功
        ])
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      const result = await transactionManager.executeBatchUpdate(operations);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(10);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toBe('Redis错误');
    });

    test('应该支持不同类型的操作', async () => {
      const operations = [
        { type: 'hset', key: 'test:hash', data: { field: 'value' } },
        { type: 'hincrby', key: 'test:counter', field: 'count', value: 5 },
        { type: 'set', key: 'test:string', value: 'test_value' },
        { type: 'del', key: 'test:delete' }
      ];

      // 模拟lockManager.withLock方法
      jest.spyOn(transactionManager.lockManager, 'withLock').mockImplementation(async (key, callback) => {
        return await callback();
      });

      const mockMulti = {
        hSet: jest.fn().mockReturnThis(),
        hIncrBy: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1], [null, 5], [null, 'OK'], [null, 1]
        ])
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      const result = await transactionManager.executeBatchUpdate(operations);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(4);
      expect(mockMulti.hSet).toHaveBeenCalledWith('test:hash', { field: 'value' });
      expect(mockMulti.hIncrBy).toHaveBeenCalledWith('test:counter', 'count', 5);
      expect(mockMulti.set).toHaveBeenCalledWith('test:string', 'test_value');
      expect(mockMulti.del).toHaveBeenCalledWith('test:delete');
    });

    test('应该拒绝不支持的操作类型', async () => {
      const operations = [
        { type: 'hset', key: 'test:valid1', data: { value: '1' } },
        { type: 'hset', key: 'test:valid2', data: { value: '2' } },
        { type: 'hset', key: 'test:valid3', data: { value: '3' } },
        { type: 'hset', key: 'test:valid4', data: { value: '4' } },
        { type: 'hset', key: 'test:valid5', data: { value: '5' } },
        { type: 'hset', key: 'test:valid6', data: { value: '6' } },
        { type: 'hset', key: 'test:valid7', data: { value: '7' } },
        { type: 'hset', key: 'test:valid8', data: { value: '8' } },
        { type: 'hset', key: 'test:valid9', data: { value: '9' } },
        { type: 'hset', key: 'test:valid10', data: { value: '10' } },
        { type: 'unsupported', key: 'test:key' } // 无效操作 (错误率约9%)
      ];

      // 模拟lockManager.withLock方法
      jest.spyOn(transactionManager.lockManager, 'withLock').mockImplementation(async (key, callback) => {
        return await callback();
      });

      const mockMulti = {
        hSet: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1], [null, 1], [null, 1], [null, 1], [null, 1],
          [null, 1], [null, 1], [null, 1], [null, 1], [null, 1] // 前10个成功
        ])
      };
      mockRedisClient.multi.mockReturnValue(mockMulti);

      const result = await transactionManager.executeBatchUpdate(operations);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(10);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain('不支持的操作类型');
    });
  });

  describe('executeAtomicOperation', () => {
    test('应该成功执行原子操作', async () => {
      const lockKey = 'test:lock';
      const operation = jest.fn().mockResolvedValue('操作结果');

      mockLockManager.withLock.mockImplementation(async (key, callback) => {
        expect(key).toBe(lockKey);
        return await callback();
      });

      const result = await transactionManager.executeAtomicOperation(lockKey, operation);

      expect(result).toBe('操作结果');
      expect(operation).toHaveBeenCalled();
    });

    test('应该处理原子操作失败', async () => {
      const lockKey = 'test:lock';
      const operation = jest.fn().mockRejectedValue(new Error('操作失败'));

      mockLockManager.withLock.mockRejectedValue(new Error('操作失败'));

      await expect(transactionManager.executeAtomicOperation(lockKey, operation))
        .rejects.toThrow('操作失败');

      expect(logger.error).toHaveBeenCalled();
    });

    test('应该使用自定义超时', async () => {
      const lockKey = 'test:lock';
      const operation = jest.fn().mockResolvedValue('结果');
      const customTimeout = 60000;

      mockLockManager.withLock.mockImplementation(async (key, callback, timeout) => {
        expect(timeout).toBe(customTimeout);
        return await callback();
      });

      await transactionManager.executeAtomicOperation(lockKey, operation, customTimeout);

      expect(mockLockManager.withLock).toHaveBeenCalledWith(lockKey, operation, customTimeout);
    });
  });

  describe('acquireBatchLocks', () => {
    test('应该成功获取所有锁', async () => {
      const lockKeys = ['lock1', 'lock2', 'lock3'];
      const mockLock = { id: 'lock_id', key: 'lock_key' };

      mockLockManager.acquire.mockResolvedValue(mockLock);

      const result = await transactionManager.acquireBatchLocks(lockKeys);

      expect(result.success).toBe(true);
      expect(result.acquiredCount).toBe(3);
      expect(result.failedLocks).toEqual([]);
      expect(result.acquiredLocks).toHaveLength(3);
    });

    test('应该按顺序获取锁以避免死锁', async () => {
      const lockKeys = ['lock3', 'lock1', 'lock2']; // 无序输入
      const sortedKeys = ['lock1', 'lock2', 'lock3']; // 期望的排序
      const mockLock = { id: 'lock_id', key: 'lock_key' };

      mockLockManager.acquire.mockResolvedValue(mockLock);

      await transactionManager.acquireBatchLocks(lockKeys);

      // 验证按排序顺序调用
      for (let i = 0; i < sortedKeys.length; i++) {
        expect(mockLockManager.acquire).toHaveBeenNthCalledWith(
          i + 1, 
          sortedKeys[i], 
          expect.any(Number)
        );
      }
    });

    test('应该处理部分锁获取失败', async () => {
      const lockKeys = ['lock1', 'lock2', 'lock3'];
      const mockLock = { id: 'lock_id', key: 'lock_key' };

      mockLockManager.acquire
        .mockResolvedValueOnce(mockLock) // lock1成功
        .mockResolvedValueOnce(null)     // lock2失败
        .mockResolvedValueOnce(mockLock); // lock3成功

      const result = await transactionManager.acquireBatchLocks(lockKeys);

      expect(result.success).toBe(false);
      expect(result.acquiredCount).toBe(2);
      expect(result.failedLocks).toEqual(['lock2']);
    });

    test('应该在失败时释放已获取的锁', async () => {
      const lockKeys = ['lock1', 'lock2', 'lock3'];
      const mockLock1 = { id: 'lock1_id', key: 'lock1' };
      const mockLock2 = { id: 'lock2_id', key: 'lock2' };

      mockLockManager.acquire
        .mockResolvedValueOnce(mockLock1)
        .mockResolvedValueOnce(mockLock2)
        .mockRejectedValueOnce(new Error('获取锁失败'));
      mockLockManager.release.mockResolvedValue(true);

      await expect(transactionManager.acquireBatchLocks(lockKeys))
        .rejects.toThrow('获取锁失败');

      expect(mockLockManager.release).toHaveBeenCalledWith(mockLock1);
      expect(mockLockManager.release).toHaveBeenCalledWith(mockLock2);
    });
  });

  describe('detectDeadlocks', () => {
    test('应该检测到长时间持有的锁', async () => {
      const lockKeys = ['farm_game:lock:key1', 'farm_game:lock:key2'];
      const longTTL = 60; // 60秒，超过默认锁超时30秒

      mockRedisClient.keys.mockResolvedValue(lockKeys);
      mockRedisClient.pipeline.mockReturnValue({
        get: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 'lock_value1'], [null, longTTL],
          [null, 'lock_value2'], [null, 20]
        ])
      });

      const result = await transactionManager.detectDeadlocks();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        key: 'farm_game:lock:key1',
        suspectedDeadlock: true,
        reason: '锁持有时间过长'
      });
    });

    test('应该在没有锁时返回空数组', async () => {
      mockRedisClient.keys.mockResolvedValue([]);

      const result = await transactionManager.detectDeadlocks();

      expect(result).toEqual([]);
    });

    test('应该处理Redis操作错误', async () => {
      mockRedisClient.keys.mockRejectedValue(new Error('Redis连接失败'));

      const result = await transactionManager.detectDeadlocks();

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('死锁检测失败'),
        expect.any(String)
      );
    });
  });

  describe('getActiveTransactions', () => {
    test('应该返回活跃事务列表', () => {
      const transaction1 = {
        id: 'tx1',
        lockKey: 'lock1',
        operations: 5,
        startTime: Date.now(),
        status: 'in_progress'
      };
      const transaction2 = {
        id: 'tx2',
        lockKey: 'lock2',
        operations: 3,
        startTime: Date.now(),
        status: 'locked'
      };

      transactionManager.activeTransactions.set('tx1', transaction1);
      transactionManager.activeTransactions.set('tx2', transaction2);

      const result = transactionManager.getActiveTransactions();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(transaction1);
      expect(result).toContainEqual(transaction2);
    });

    test('应该在没有活跃事务时返回空数组', () => {
      const result = transactionManager.getActiveTransactions();

      expect(result).toEqual([]);
    });
  });

  describe('getTransactionStats', () => {
    test('应该返回事务统计信息', () => {
      transactionManager.activeTransactions.set('tx1', { id: 'tx1' });
      transactionManager.activeTransactions.set('tx2', { id: 'tx2' });

      const stats = transactionManager.getTransactionStats();

      expect(stats).toEqual({
        activeTransactions: 2,
        lockTimeout: 30000,
        maxRetries: 3,
        retryDelay: 1000
      });
    });
  });

  describe('_acquireLockWithRetry', () => {
    test('应该在首次尝试成功时立即返回', async () => {
      mockLockManager.withLock.mockResolvedValue(true);

      const result = await transactionManager._acquireLockWithRetry('test:lock', 30000);

      expect(result).toBe(true);
      expect(mockLockManager.withLock).toHaveBeenCalledTimes(1);
    });

    test('应该在失败后重试', async () => {
      mockLockManager.withLock
        .mockRejectedValueOnce(new Error('锁获取失败'))
        .mockRejectedValueOnce(new Error('锁获取失败'))
        .mockResolvedValueOnce(true);

      const result = await transactionManager._acquireLockWithRetry('test:lock', 30000);

      expect(result).toBe(true);
      expect(mockLockManager.withLock).toHaveBeenCalledTimes(3);
    });

    test('应该在超过最大重试次数后返回失败', async () => {
      mockLockManager.withLock.mockRejectedValue(new Error('锁获取失败'));

      const result = await transactionManager._acquireLockWithRetry('test:lock', 30000);

      expect(result).toBe(false);
      expect(mockLockManager.withLock).toHaveBeenCalledTimes(3); // maxRetries
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('_validateOperations', () => {
    test('应该验证有效操作', () => {
      const validOperations = [
        { type: 'hset', key: 'test:key', data: { field: 'value' } },
        { type: 'hincrby', key: 'test:counter', field: 'count', value: 1 },
        { type: 'set', key: 'test:string', value: 'test' },
        { type: 'del', key: 'test:delete' }
      ];

      const result = transactionManager._validateOperations(validOperations);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('应该拒绝非数组输入', () => {
      const result = transactionManager._validateOperations('not an array');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('操作列表必须是数组');
    });

    test('应该拒绝空数组', () => {
      const result = transactionManager._validateOperations([]);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('操作列表不能为空');
    });

    test('应该检测缺失的必需字段', () => {
      const invalidOperations = [
        { key: 'test:key', data: {} }, // 缺少type
        { type: 'hset', data: {} }, // 缺少key
        { type: 'hset', key: 'test:key' }, // hset缺少data
        { type: 'hincrby', key: 'test:key', value: 1 }, // hincrby缺少field
        { type: 'set', key: 'test:key' } // set缺少value
      ];

      const result = transactionManager._validateOperations(invalidOperations);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(5);
    });
  });

  describe('_generateTransactionId', () => {
    test('应该生成唯一的事务ID', () => {
      const id1 = transactionManager._generateTransactionId();
      const id2 = transactionManager._generateTransactionId();

      expect(id1).toMatch(/^tx_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^tx_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('事务状态管理', () => {
    test('应该正确更新事务状态', () => {
      const transactionId = 'test_tx';
      const transaction = {
        id: transactionId,
        status: 'starting',
        lastUpdate: Date.now()
      };

      transactionManager.activeTransactions.set(transactionId, transaction);
      transactionManager._updateTransactionStatus(transactionId, 'locked');

      const updatedTransaction = transactionManager.activeTransactions.get(transactionId);
      expect(updatedTransaction.status).toBe('locked');
      expect(updatedTransaction.lastUpdate).toBeGreaterThan(transaction.lastUpdate);
    });

    test('应该处理不存在的事务ID', () => {
      // 不应该抛出错误
      expect(() => {
        transactionManager._updateTransactionStatus('nonexistent', 'completed');
      }).not.toThrow();
    });
  });
});