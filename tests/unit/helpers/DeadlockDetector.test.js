/**
 * DeadlockDetector 单元测试 - 精简版
 * 测试基础的死锁检测功能
 */

import { DeadlockDetector } from '../../helpers/concurrency/DeadlockDetector.js';

describe('DeadlockDetector - 简化版', () => {
  let detector;

  beforeEach(() => {
    detector = new DeadlockDetector({
      maxLockWaitTime: 1000, // 1秒测试超时
      detectionInterval: 50,  // 50ms快速检测
      maxDependencyDepth: 3
    });
  });

  afterEach(async () => {
    if (detector) {
      await detector.cleanup();
    }
  });

  describe('基础功能测试', () => {
    test('应该正确初始化死锁检测器', () => {
      expect(detector).toBeDefined();
      expect(detector.isDetecting).toBe(false);
    });

    test('应该能够启动和停止检测', () => {
      detector.startDetection();
      expect(detector.isDetecting).toBe(true);
      
      detector.stopDetection();
      expect(detector.isDetecting).toBe(false);
    });

    test('应该能够注册锁获取', () => {
      // registerLockAcquisition可能不返回值，只测试不抛异常
      expect(() => {
        detector.registerLockAcquisition('thread1', 'lock1');
      }).not.toThrow();
    });

    test('应该能够注册锁释放', () => {
      detector.registerLockAcquisition('thread1', 'lock1');
      expect(() => {
        detector.registerLockRelease('thread1', 'lock1');
      }).not.toThrow();
    });

    test('应该能够检查死锁风险', () => {
      detector.registerLockAcquisition('thread1', 'lock1');
      const riskCheck = detector.checkDeadlockRisk('thread1', 'lock2');
      expect(riskCheck).toHaveProperty('riskLevel');
      expect(riskCheck.riskLevel).toMatch(/^(low|medium|high)$/);
    });
  });

  describe('清理功能', () => {
    test('应该能够清理资源', async () => {
      detector.startDetection();
      detector.registerLockAcquisition('thread1', 'lock1');
      
      await detector.cleanup();
      expect(detector.isDetecting).toBe(false);
    });
  });
});