/**
 * TestScenarios - 测试场景数据集
 * 提供各种业务场景的测试数据组合
 */

import { PlayerGenerator } from './PlayerGenerator.js';

export class TestScenarios {
  /**
   * 新手玩家场景 - 玩家刚开始游戏
   */
  static newPlayerScenario() {
    const player = PlayerGenerator.createNewPlayer();
    
    return {
      name: '新手玩家场景',
      description: '测试新玩家的基本功能和限制',
      player,
      context: {
        gamePhase: 'tutorial',
        availableFeatures: ['plant', 'harvest', 'status', 'signIn'],
        restrictedFeatures: ['steal', 'market', 'advancedShop']
      },
      expectedBehavior: {
        canPlant: true,
        canHarvest: false,
        canSteal: false,
        canAccessMarket: false,
        shouldShowTutorial: true,
        maxLands: 1
      },
      testCases: [
        {
          action: 'signIn',
          expectedResult: 'success',
          expectedRewards: { money: 100, energy: 20 }
        },
        {
          action: 'plant',
          params: { cropId: 'wheat', landId: 0 },
          expectedResult: 'success'
        },
        {
          action: 'steal',
          params: { targetUserId: 'other_player' },
          expectedResult: 'failure',
          expectedMessage: '等级不足'
        }
      ]
    };
  }

  /**
   * 高级玩家场景 - 经验丰富的玩家
   */
  static advancedPlayerScenario(level = 20) {
    const player = PlayerGenerator.createAdvancedPlayer(level, 8);
    
    return {
      name: '高级玩家场景',
      description: '测试高级玩家的完整功能访问',
      player,
      context: {
        gamePhase: 'advanced',
        availableFeatures: ['plant', 'harvest', 'steal', 'market', 'shop', 'protect'],
        restrictedFeatures: []
      },
      expectedBehavior: {
        canPlant: true,
        canHarvest: true,
        canSteal: true,
        canAccessMarket: true,
        canUseAdvancedFeatures: true,
        maxLands: 8
      },
      testCases: [
        {
          action: 'batchPlant',
          params: { cropId: 'tomato', landIds: [0, 1, 2] },
          expectedResult: 'success'
        },
        {
          action: 'steal',
          params: { targetUserId: 'victim_player' },
          expectedResult: 'depends_on_conditions'
        },
        {
          action: 'marketTrade',
          params: { cropId: 'wheat', quantity: 50, pricePerUnit: 20 },
          expectedResult: 'success'
        }
      ]
    };
  }

  /**
   * 多玩家交互场景 - 测试玩家间的互动
   */
  static multiPlayerScenario() {
    const players = [
      PlayerGenerator.createPlayerWithCrops(3, 'wheat'), // 受害者
      PlayerGenerator.createAdvancedPlayer(15, 5),        // 偷菜者
      PlayerGenerator.createNewPlayer(),                  // 新手观察者
      PlayerGenerator.createRichPlayer(50000)             // 富有玩家
    ];

    return {
      name: '多玩家交互场景',
      description: '测试多个玩家之间的交互和数据一致性',
      players,
      interactions: [
        {
          type: 'steal',
          from: 1, // 高级玩家
          to: 0,   // 有作物的玩家
          expectedOutcome: 'success_probability_70%'
        },
        {
          type: 'help',
          from: 3, // 富有玩家
          to: 2,   // 新手玩家
          params: { giftType: 'money', amount: 1000 }
        },
        {
          type: 'market_competition',
          participants: [0, 1, 3],
          item: 'wheat',
          scenario: 'price_war'
        },
        {
          type: 'protection',
          from: 0, // 被偷的玩家
          action: 'buy_protection',
          duration: 3600000 // 1小时
        }
      ],
      testCases: [
        {
          description: '偷菜成功后双方数据更新',
          steps: [
            'player1_steals_from_player0',
            'verify_player0_lost_crops',
            'verify_player1_gained_crops',
            'verify_steal_cooldown_applied'
          ]
        },
        {
          description: '市场价格竞争',
          steps: [
            'multiple_players_list_same_item',
            'verify_price_competition',
            'execute_trades',
            'verify_market_efficiency'
          ]
        }
      ]
    };
  }

  /**
   * 农作物生命周期场景 - 完整的种植到收获流程
   */
  static cropLifecycleScenario() {
    const player = PlayerGenerator.createTestPlayer({
      nickname: '种植专家',
      level: 10,
      money: 5000,
      energy: 100,
      lands: Array.from({ length: 5 }, (_, i) => ({
        id: i,
        crop: null,
        status: 'empty',
        plantedAt: null,
        harvestTime: null,
        fertilized: false,
        protected: false
      }))
    });

    return {
      name: '农作物生命周期场景',
      description: '测试从种植到收获的完整农作物生命周期',
      player,
      crops: [
        { id: 'wheat', name: '小麦', growTime: 300000, yield: 3 },
        { id: 'corn', name: '玉米', growTime: 600000, yield: 5 },
        { id: 'tomato', name: '番茄', growTime: 900000, yield: 8 }
      ],
      timeline: [
        { time: 0, action: 'plant_wheat', landId: 0 },
        { time: 60000, action: 'plant_corn', landId: 1 },
        { time: 120000, action: 'plant_tomato', landId: 2 },
        { time: 180000, action: 'apply_fertilizer', landId: 0 },
        { time: 300000, action: 'harvest_wheat', landId: 0 },
        { time: 660000, action: 'harvest_corn', landId: 1 },
        { time: 1020000, action: 'harvest_tomato', landId: 2 }
      ],
      expectedOutcomes: {
        wheat: { baseYield: 3, fertilizedYield: 4, experience: 5 },
        corn: { baseYield: 5, experience: 10 },
        tomato: { baseYield: 8, experience: 15 }
      }
    };
  }

  /**
   * 经济系统场景 - 测试游戏内经济循环
   */
  static economicSystemScenario() {
    const players = [
      PlayerGenerator.createTestPlayer({
        nickname: '生产者',
        level: 15,
        money: 10000,
        inventory: { wheat: 100, corn: 80, tomato: 50 }
      }),
      PlayerGenerator.createTestPlayer({
        nickname: '交易商',
        level: 20,
        money: 50000,
        inventory: {}
      }),
      PlayerGenerator.createTestPlayer({
        nickname: '消费者',
        level: 8,
        money: 3000,
        inventory: {}
      })
    ];

    return {
      name: '经济系统场景',
      description: '测试游戏内经济系统的平衡性和稳定性',
      players,
      marketConditions: {
        wheat: { basePrice: 15, demand: 'high', supply: 'medium' },
        corn: { basePrice: 25, demand: 'medium', supply: 'low' },
        tomato: { basePrice: 40, demand: 'low', supply: 'high' }
      },
      economicEvents: [
        {
          time: 0,
          event: 'market_open',
          description: '市场开放交易'
        },
        {
          time: 60000,
          event: 'price_fluctuation',
          description: '价格波动事件',
          effects: { wheat: '+10%', corn: '-5%', tomato: '+15%' }
        },
        {
          time: 120000,
          event: 'bulk_trade',
          description: '大宗交易',
          trader: 1,
          items: { wheat: 50, corn: 30 }
        }
      ],
      testCases: [
        {
          description: '价格发现机制',
          verify: ['supply_demand_balance', 'price_stability', 'arbitrage_opportunities']
        },
        {
          description: '流动性测试',
          verify: ['trade_execution_speed', 'market_depth', 'slippage_control']
        }
      ]
    };
  }

  /**
   * 偷菜系统场景 - PvP互动测试
   */
  static stealingSystemScenario() {
    const victim = PlayerGenerator.createPlayerWithReadyCrops(4, 'wheat');
    const thief = PlayerGenerator.createAdvancedPlayer(12, 3);
    const protector = PlayerGenerator.createRichPlayer(30000);

    return {
      name: '偷菜系统场景',
      description: '测试偷菜机制和防护系统',
      players: [victim, thief, protector],
      roles: {
        0: 'victim',    // 被偷者
        1: 'thief',     // 偷菜者
        2: 'protector'  // 保护者
      },
      stealingRules: {
        levelRequirement: 5,
        cooldownTime: 3600000, // 1小时
        maxStealPercentage: 0.3, // 最多偷30%
        successRate: 0.7,
        energyCost: 10
      },
      scenarios: [
        {
          name: '成功偷菜',
          steps: [
            'thief_attempts_steal',
            'check_success_probability',
            'transfer_crops',
            'apply_cooldown',
            'update_statistics'
          ]
        },
        {
          name: '偷菜失败',
          steps: [
            'thief_attempts_steal',
            'fail_due_to_protection',
            'apply_failure_penalty',
            'notify_victim'
          ]
        },
        {
          name: '防护激活',
          steps: [
            'victim_buys_protection',
            'thief_attempts_steal',
            'protection_blocks_steal',
            'consume_protection_item'
          ]
        }
      ]
    };
  }

  /**
   * 压力测试场景 - 高负载情况测试
   */
  static stressTestScenario(playerCount = 100) {
    const players = PlayerGenerator.createBatchPlayers(playerCount);
    
    return {
      name: '压力测试场景',
      description: `${playerCount}个玩家的高并发操作测试`,
      players,
      concurrentOperations: [
        {
          operation: 'simultaneous_plant',
          playerCount: Math.floor(playerCount * 0.8),
          expectedDuration: 5000 // 5秒内完成
        },
        {
          operation: 'batch_harvest',
          playerCount: Math.floor(playerCount * 0.6),
          expectedDuration: 3000 // 3秒内完成
        },
        {
          operation: 'market_trades',
          playerCount: Math.floor(playerCount * 0.4),
          expectedDuration: 10000 // 10秒内完成
        },
        {
          operation: 'steal_attempts',
          playerCount: Math.floor(playerCount * 0.3),
          expectedDuration: 8000 // 8秒内完成
        }
      ],
      performanceMetrics: {
        maxResponseTime: 100, // 100ms
        successRate: 0.99, // 99%成功率
        memoryUsage: 512 * 1024 * 1024, // 512MB
        concurrentConnections: playerCount
      }
    };
  }

  /**
   * 边界条件场景 - 测试极端情况
   */
  static edgeCaseScenario() {
    return {
      name: '边界条件场景',
      description: '测试各种边界条件和异常情况',
      testCases: [
        {
          name: '最大等级玩家',
          player: PlayerGenerator.createTestPlayer({
            level: 100,
            experience: 1000000,
            money: 999999999
          }),
          tests: ['level_cap_behavior', 'experience_overflow', 'money_limit']
        },
        {
          name: '零资源玩家',
          player: PlayerGenerator.createPoorPlayer(0),
          tests: ['zero_money_operations', 'no_energy_actions', 'empty_inventory']
        },
        {
          name: '数据损坏恢复',
          player: PlayerGenerator.createTestPlayer({
            // 故意设置一些无效数据
            level: -1,
            money: -1000,
            energy: 200, // 超过最大值
            lands: null
          }),
          tests: ['data_validation', 'corruption_recovery', 'default_value_restoration']
        },
        {
          name: '并发锁测试',
          scenario: 'multiple_operations_same_player',
          operations: ['plant', 'harvest', 'steal', 'buy'],
          expectedBehavior: 'serialize_operations'
        }
      ]
    };
  }

  /**
   * 获取所有预定义场景
   */
  static getAllScenarios() {
    return [
      this.newPlayerScenario(),
      this.advancedPlayerScenario(),
      this.multiPlayerScenario(),
      this.cropLifecycleScenario(),
      this.economicSystemScenario(),
      this.stealingSystemScenario(),
      this.edgeCaseScenario()
    ];
  }

  /**
   * 根据名称获取特定场景
   */
  static getScenarioByName(name) {
    const scenarios = this.getAllScenarios();
    return scenarios.find(scenario => scenario.name === name);
  }

  /**
   * 创建自定义场景
   */
  static createCustomScenario(config) {
    return {
      name: config.name || '自定义场景',
      description: config.description || '用户自定义的测试场景',
      ...config
    };
  }

  /**
   * 验证场景数据完整性
   */
  static validateScenario(scenario) {
    const errors = [];
    
    if (!scenario.name) {
      errors.push('场景缺少名称');
    }
    
    if (!scenario.description) {
      errors.push('场景缺少描述');
    }
    
    if (scenario.player && !PlayerGenerator.validatePlayer(scenario.player).isValid) {
      errors.push('场景中的玩家数据无效');
    }
    
    if (scenario.players && scenario.players.length > 0) {
      for (let i = 0; i < scenario.players.length; i++) {
        const validation = PlayerGenerator.validatePlayer(scenario.players[i]);
        if (!validation.isValid) {
          errors.push(`第${i + 1}个玩家数据无效: ${validation.errors.join(', ')}`);
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}