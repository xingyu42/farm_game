/**
 * PlayerService Redis Hash性能基准测试
 * 用于验证Hash存储相对于JSON存储的性能提升
 * 
 * {{CHENGQI:
 * Action: Created; Timestamp: 2025-06-30T19:12:48+08:00; Reason: Shrimp Task ID: #9826d906, performance benchmark for Redis Hash optimization;
 * }}
 */

const redis = require('redis');
const PlayerService = require('../services/PlayerService');
const RedisClient = require('../common/redisClient');

// 测试配置
const TEST_CONFIG = {
  levels: {
    default: { startingCoins: 100 },
    levels: {
      requirements: {
        1: { experience: 0, description: "新手农夫" },
        2: { experience: 100, description: "见习农夫" },
        3: { experience: 250, description: "熟练农夫" }
      }
    }
  },
  land: {
    default: { startingLands: 6, maxLands: 24 }
  },
  items: {
    inventory: { startingCapacity: 20, maxCapacity: 200 },
    initial_gift: [
      { item_id: 'wheat_seed', quantity: 10 }
    ]
  }
};

class PlayerServiceBenchmark {
  constructor() {
    this.redisClient = null;
    this.playerService = null;
    this.logger = console;
  }

  /**
   * 初始化Redis连接
   */
  async init() {
    try {
      this.redisClient = new RedisClient();
      await this.redisClient.init({
        socket: { host: 'localhost', port: 6379 },
        database: 1 // 使用测试数据库
      });
      
      this.playerService = new PlayerService(this.redisClient, TEST_CONFIG, this.logger);
      
      console.log('✅ Redis连接已建立，准备开始基准测试...');
      return true;
    } catch (error) {
      console.error('❌ Redis连接失败:', error.message);
      return false;
    }
  }

  /**
   * 清理测试数据
   */
  async cleanup() {
    try {
      const pattern = this.redisClient.generateKey('player', '*');
      const keys = await this.redisClient.client.keys(pattern);
      
      if (keys.length > 0) {
        await this.redisClient.client.del(keys);
        console.log(`🧹 已清理 ${keys.length} 个测试数据`);
      }
    } catch (error) {
      console.error('清理失败:', error.message);
    }
  }

  /**
   * 创建测试玩家数据
   */
  createTestPlayerData(userId) {
    return {
      name: `TestPlayer_${userId}`,
      level: Math.floor(Math.random() * 10) + 1,
      experience: Math.floor(Math.random() * 1000),
      coins: Math.floor(Math.random() * 5000) + 100,
      landCount: 6,
      maxLandCount: 24,
      inventoryCapacity: 20,
      maxInventoryCapacity: 200,
      lands: new Array(6).fill(null).map((_, i) => ({
        id: i + 1,
        crop: Math.random() > 0.5 ? 'wheat' : null,
        quality: 'normal',
        plantTime: Math.random() > 0.5 ? Date.now() - 3600000 : null,
        harvestTime: Math.random() > 0.5 ? Date.now() + 3600000 : null,
        status: Math.random() > 0.5 ? 'growing' : 'empty'
      })),
      inventory: {
        wheat_seed: { quantity: Math.floor(Math.random() * 50) },
        carrot_seed: { quantity: Math.floor(Math.random() * 30) }
      },
      signIn: {
        lastSignDate: Date.now() - 86400000,
        consecutiveDays: Math.floor(Math.random() * 7),
        totalSignDays: Math.floor(Math.random() * 30)
      },
      protection: {
        dogFood: { type: null, effectEndTime: 0, defenseBonus: 0 },
        farmProtection: { endTime: 0 }
      },
      stealing: {
        lastStealTime: Date.now() - 3600000,
        cooldownEndTime: Date.now() - 1800000
      },
      statistics: {
        totalHarvested: Math.floor(Math.random() * 100),
        totalStolenFrom: Math.floor(Math.random() * 20),
        totalStolenBy: Math.floor(Math.random() * 15),
        totalMoneyEarned: Math.floor(Math.random() * 10000),
        totalMoneySpent: Math.floor(Math.random() * 8000)
      },
      createdAt: Date.now() - Math.floor(Math.random() * 30) * 86400000,
      lastUpdated: Date.now(),
      lastActiveTime: Date.now()
    };
  }

  /**
   * 模拟JSON存储方式（用于对比）
   */
  async simulateJSONStorage(playerData, userId) {
    const playerKey = this.redisClient.generateKey('player', userId);
    const jsonData = JSON.stringify(playerData);
    await this.redisClient.client.set(playerKey, jsonData);
  }

  /**
   * 模拟JSON读取操作
   */
  async simulateJSONRead(userId) {
    const playerKey = this.redisClient.generateKey('player', userId);
    const jsonData = await this.redisClient.client.get(playerKey);
    return JSON.parse(jsonData);
  }

  /**
   * 模拟JSON字段更新（需要完整读写）
   */
  async simulateJSONFieldUpdate(userId, field, value) {
    const playerData = await this.simulateJSONRead(userId);
    playerData[field] = value;
    playerData.lastUpdated = Date.now();
    await this.simulateJSONStorage(playerData, userId);
  }

  /**
   * 执行Hash存储测试
   */
  async runHashStorageTest(userCount = 100, operationsPerUser = 50) {
    console.log(`\n🧪 开始Hash存储基准测试 (${userCount} 用户, 每用户 ${operationsPerUser} 次操作)`);
    
    const startTime = Date.now();
    
    // 第一阶段：创建玩家
    const createStartTime = Date.now();
    for (let i = 1; i <= userCount; i++) {
      const userId = `hash_test_${i}`;
      await this.playerService.getPlayer(userId);
    }
    const createTime = Date.now() - createStartTime;
    
    // 第二阶段：执行更新操作
    const updateStartTime = Date.now();
    for (let i = 1; i <= userCount; i++) {
      const userId = `hash_test_${i}`;
      
      for (let j = 0; j < operationsPerUser; j++) {
        // 随机执行不同类型的操作
        const operation = Math.floor(Math.random() * 4);
        switch (operation) {
          case 0:
            await this.playerService.addCoins(userId, Math.floor(Math.random() * 100));
            break;
          case 1:
            await this.playerService.addExp(userId, Math.floor(Math.random() * 50));
            break;
          case 2:
            await this.playerService.signIn(userId);
            break;
          case 3:
            await this.playerService.updateStatistics(userId, {
              totalHarvested: Math.floor(Math.random() * 10)
            });
            break;
        }
      }
    }
    const updateTime = Date.now() - updateStartTime;
    
    const totalTime = Date.now() - startTime;
    
    return {
      userCount,
      operationsPerUser,
      createTime,
      updateTime,
      totalTime,
      avgCreateTime: createTime / userCount,
      avgUpdateTime: updateTime / (userCount * operationsPerUser)
    };
  }

  /**
   * 执行JSON存储对比测试
   */
  async runJSONStorageTest(userCount = 100, operationsPerUser = 50) {
    console.log(`\n📊 开始JSON存储对比测试 (${userCount} 用户, 每用户 ${operationsPerUser} 次操作)`);
    
    const startTime = Date.now();
    
    // 第一阶段：创建玩家数据
    const createStartTime = Date.now();
    for (let i = 1; i <= userCount; i++) {
      const userId = `json_test_${i}`;
      const playerData = this.createTestPlayerData(userId);
      await this.simulateJSONStorage(playerData, userId);
    }
    const createTime = Date.now() - createStartTime;
    
    // 第二阶段：执行更新操作
    const updateStartTime = Date.now();
    for (let i = 1; i <= userCount; i++) {
      const userId = `json_test_${i}`;
      
      for (let j = 0; j < operationsPerUser; j++) {
        // 模拟字段更新（需要完整读写）
        const operation = Math.floor(Math.random() * 4);
        switch (operation) {
          case 0:
            await this.simulateJSONFieldUpdate(userId, 'coins', Math.floor(Math.random() * 5000));
            break;
          case 1:
            await this.simulateJSONFieldUpdate(userId, 'experience', Math.floor(Math.random() * 1000));
            break;
          case 2:
            await this.simulateJSONFieldUpdate(userId, 'level', Math.floor(Math.random() * 10) + 1);
            break;
          case 3:
            const playerData = await this.simulateJSONRead(userId);
            playerData.statistics.totalHarvested += Math.floor(Math.random() * 10);
            await this.simulateJSONStorage(playerData, userId);
            break;
        }
      }
    }
    const updateTime = Date.now() - updateStartTime;
    
    const totalTime = Date.now() - startTime;
    
    return {
      userCount,
      operationsPerUser,
      createTime,
      updateTime,
      totalTime,
      avgCreateTime: createTime / userCount,
      avgUpdateTime: updateTime / (userCount * operationsPerUser)
    };
  }

  /**
   * 运行完整基准测试
   */
  async runFullBenchmark() {
    console.log('🚀 PlayerService Redis Hash性能基准测试');
    console.log('='.repeat(60));
    
    const testSizes = [
      { users: 10, operations: 20 },
      { users: 50, operations: 30 },
      { users: 100, operations: 50 }
    ];
    
    const results = [];
    
    for (const { users, operations } of testSizes) {
      await this.cleanup();
      
      // 运行Hash测试
      const hashResult = await this.runHashStorageTest(users, operations);
      
      // 运行JSON对比测试
      const jsonResult = await this.runJSONStorageTest(users, operations);
      
      // 计算性能提升
      const improvement = {
        createSpeedup: (jsonResult.createTime / hashResult.createTime).toFixed(2),
        updateSpeedup: (jsonResult.updateTime / hashResult.updateTime).toFixed(2),
        totalSpeedup: (jsonResult.totalTime / hashResult.totalTime).toFixed(2)
      };
      
      results.push({
        testSize: `${users}用户x${operations}操作`,
        hash: hashResult,
        json: jsonResult,
        improvement
      });
      
      // 输出当前测试结果
      console.log(`\n📈 测试结果 (${users}用户x${operations}操作):`);
      console.log(`Hash存储 - 创建: ${hashResult.createTime}ms, 更新: ${hashResult.updateTime}ms, 总计: ${hashResult.totalTime}ms`);
      console.log(`JSON存储 - 创建: ${jsonResult.createTime}ms, 更新: ${jsonResult.updateTime}ms, 总计: ${jsonResult.totalTime}ms`);
      console.log(`性能提升 - 创建: ${improvement.createSpeedup}x, 更新: ${improvement.updateSpeedup}x, 总计: ${improvement.totalSpeedup}x`);
    }
    
    // 输出汇总报告
    console.log('\n📊 基准测试汇总报告');
    console.log('='.repeat(60));
    
    const avgCreateSpeedup = results.reduce((sum, r) => sum + parseFloat(r.improvement.createSpeedup), 0) / results.length;
    const avgUpdateSpeedup = results.reduce((sum, r) => sum + parseFloat(r.improvement.updateSpeedup), 0) / results.length;
    const avgTotalSpeedup = results.reduce((sum, r) => sum + parseFloat(r.improvement.totalSpeedup), 0) / results.length;
    
    console.log(`🎯 Hash存储相对于JSON存储的平均性能提升:`);
    console.log(`   创建操作: ${avgCreateSpeedup.toFixed(2)}x`);
    console.log(`   更新操作: ${avgUpdateSpeedup.toFixed(2)}x`);
    console.log(`   总体性能: ${avgTotalSpeedup.toFixed(2)}x`);
    
    if (avgUpdateSpeedup > 1.5) {
      console.log(`✅ 优化成功！Hash存储在更新操作上显著优于JSON存储`);
    } else {
      console.log(`⚠️  性能提升有限，需要进一步优化`);
    }
    
    return results;
  }

  /**
   * 关闭连接
   */
  async close() {
    if (this.redisClient) {
      await this.redisClient.close();
      console.log('🔒 Redis连接已关闭');
    }
  }
}

// 如果直接运行此文件
if (require.main === module) {
  (async () => {
    const benchmark = new PlayerServiceBenchmark();
    
    try {
      const connected = await benchmark.init();
      if (!connected) {
        console.error('无法连接Redis，跳过基准测试');
        process.exit(1);
      }
      
      await benchmark.runFullBenchmark();
      
    } catch (error) {
      console.error('基准测试失败:', error.message);
    } finally {
      await benchmark.close();
    }
  })();
}

module.exports = PlayerServiceBenchmark; 