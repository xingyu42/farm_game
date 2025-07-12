# 事务设计规范指南

## 概述

本文档为团队提供统一的事务处理指导原则，确保系统的数据一致性和并发安全性。基于项目中修复的并发安全问题和事务嵌套问题的经验总结。

## 核心设计原则

### 1. 事务边界清晰原则

**业务操作层**：使用 `executeWithTransaction` 进行业务逻辑封装
**原子操作层**：直接操作 `multi` 实例进行数据修改

```javascript
// ✅ 正确：业务操作层使用 executeWithTransaction
async expandLand(userId) {
  return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
    // 在事务内进行所有检查和操作
    const playerData = await this.playerDataService.getPlayerFromHash(userId);
    
    // 业务逻辑检查
    if (playerData.coins < cost) {
      throw new Error('金币不足');
    }
    
    // 直接操作数据
    playerData.coins -= cost;
    playerData.landCount += 1;
    
    // 保存数据
    const serializer = this.playerDataService.getSerializer();
    multi.hSet(playerKey, serializer.serializeForHash(playerData));
    
    return result;
  });
}
```

### 2. 避免事务嵌套原则

**禁止**在事务内调用其他使用事务的方法

```javascript
// ❌ 错误：事务嵌套
return await this.redis.transaction(async (multi) => {
  // 这里调用了另一个事务方法，导致嵌套
  await this.economyService.deductCoins(userId, amount);
  await this.inventoryService.addItem(userId, itemId, quantity);
});

// ✅ 正确：在事务内直接操作数据
return await this.redis.transaction(async (multi) => {
  const playerData = await this.redis.get(playerKey);
  
  // 直接操作数据，避免调用外部事务方法
  const actualChange = this.economyService._updateCoinsInTransaction(playerData, -amount);
  
  // 直接操作库存
  if (!playerData.inventory[itemId]) {
    playerData.inventory[itemId] = { quantity: 0, lastUpdated: Date.now() };
  }
  playerData.inventory[itemId].quantity += quantity;
  
  multi.set(playerKey, this.redis.serialize(playerData));
});
```

### 3. 原子性保证原则

所有相关的检查和数据修改必须在同一事务中完成

```javascript
// ❌ 错误：检查和操作分离
// 事务外检查
if (playerData.coins < cost) {
  return { success: false, message: '金币不足' };
}

// 独立的事务操作
return await this.executeWithTransaction(userId, async (multi, playerKey) => {
  // 这里存在时间窗口，数据可能已经改变
  playerData.coins -= cost;
});

// ✅ 正确：检查和操作在同一事务中
return await this.executeWithTransaction(userId, async (multi, playerKey) => {
  // 在事务内重新获取最新数据
  const playerData = await this.playerDataService.getPlayerFromHash(userId);
  
  // 在事务内进行检查
  if (playerData.coins < cost) {
    throw new Error('金币不足');
  }
  
  // 立即进行操作
  playerData.coins -= cost;
  
  // 保存数据
  multi.hSet(playerKey, serializer.serializeForHash(playerData));
});
```

## 实施模式

### 1. 标准业务操作模式

```javascript
async businessOperation(userId, params) {
  try {
    return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
      // 1. 获取最新数据
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      
      // 2. 业务逻辑验证
      if (!this.validateBusinessRules(playerData, params)) {
        throw new Error('业务规则验证失败');
      }
      
      // 3. 数据修改
      this.updatePlayerData(playerData, params);
      
      // 4. 保存数据
      const serializer = this.playerDataService.getSerializer();
      multi.hSet(playerKey, serializer.serializeForHash(playerData));
      
      // 5. 返回结果
      return this.buildSuccessResult(playerData, params);
    });
  } catch (error) {
    this.logger.error(`[ServiceName] 操作失败 [${userId}]: ${error.message}`);
    
    // 转换为用户友好的错误格式
    return this.buildErrorResult(error);
  }
}
```

### 2. 批量操作模式

```javascript
async batchOperation(userId, items) {
  return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
    const playerData = await this.playerDataService.getPlayerFromHash(userId);
    
    // 先验证所有操作的可行性
    for (const item of items) {
      if (!this.canProcessItem(playerData, item)) {
        throw new Error(`无法处理项目: ${item.name}`);
      }
    }
    
    // 批量处理所有项目
    for (const item of items) {
      this.processItem(playerData, item);
    }
    
    // 统一保存
    const serializer = this.playerDataService.getSerializer();
    multi.hSet(playerKey, serializer.serializeForHash(playerData));
    
    return this.buildBatchResult(items);
  });
}
```

### 3. 跨服务协作模式

```javascript
// 在主服务中协调多个数据修改
async complexOperation(userId, params) {
  return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
    const playerData = await this.playerDataService.getPlayerFromHash(userId);
    
    // 使用其他服务的内部方法，避免事务嵌套
    const coinChange = this.economyService._updateCoinsInTransaction(playerData, -params.cost);
    
    // 直接操作库存数据
    this.inventoryService._updateInventoryInTransaction(playerData, params.items);
    
    // 更新其他相关数据
    this.updateOtherData(playerData, params);
    
    // 统一保存
    const serializer = this.playerDataService.getSerializer();
    multi.hSet(playerKey, serializer.serializeForHash(playerData));
    
    return this.buildResult(playerData, coinChange);
  });
}
```

## 常见陷阱与解决方案

### 1. 事务嵌套陷阱

**问题**：在 `redis.transaction` 或 `executeWithTransaction` 内部调用其他使用事务的方法

**解决方案**：
- 创建内部方法（如 `_updateCoinsInTransaction`）用于事务内操作
- 将外部事务方法标记为 `@deprecated`
- 在事务内直接操作数据对象

### 2. 检查-操作分离陷阱

**问题**：在事务外进行检查，在事务内进行操作，存在时间窗口

**解决方案**：
- 将所有检查移到事务内部
- 在事务内重新获取最新数据进行检查
- 确保检查和操作的原子性

### 3. 数据一致性陷阱

**问题**：多个相关数据的更新不在同一事务中

**解决方案**：
- 识别业务操作的完整边界
- 将所有相关数据更新放在同一事务中
- 使用批量操作模式处理多项数据

### 4. 错误处理陷阱

**问题**：事务内异常处理不当，导致部分数据更新

**解决方案**：
- 在事务内使用 `throw new Error()` 触发回滚
- 在事务外进行错误格式转换
- 保持用户友好的错误提示

## 分布式锁使用场景

### 何时使用分布式锁

1. **跨用户资源竞争**：多个用户竞争有限资源（如限量商品）
2. **全局状态修改**：修改影响所有用户的全局配置
3. **复杂业务流程**：需要多步骤协调的复杂操作

### 分布式锁模式

```javascript
async competitiveOperation(userId, resourceId) {
  const lockKey = `lock:resource:${resourceId}`;
  
  return await this.redis.withLock(lockKey, async () => {
    // 在锁保护下进行操作
    return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
      // 检查资源可用性
      const resource = await this.getGlobalResource(resourceId);
      if (!resource.available) {
        throw new Error('资源不可用');
      }
      
      // 更新用户数据和全局资源
      const playerData = await this.playerDataService.getPlayerFromHash(userId);
      this.updatePlayerData(playerData);
      this.updateGlobalResource(resource);
      
      // 保存数据
      multi.hSet(playerKey, serializer.serializeForHash(playerData));
      multi.set(`resource:${resourceId}`, JSON.stringify(resource));
      
      return result;
    });
  });
}
```

## 代码审查检查清单

### 事务使用检查

- [ ] 是否在事务内调用了其他事务方法？
- [ ] 是否在事务外进行了业务逻辑检查？
- [ ] 是否在事务内重新获取了最新数据？
- [ ] 是否所有相关数据修改都在同一事务中？

### 错误处理检查

- [ ] 是否正确使用 `throw new Error()` 触发事务回滚？
- [ ] 是否在事务外进行了错误格式转换？
- [ ] 是否保持了用户友好的错误提示？

### 性能检查

- [ ] 事务内的操作是否尽可能简洁？
- [ ] 是否避免了不必要的数据库查询？
- [ ] 是否合理使用了批量操作？

### 并发安全检查

- [ ] 是否考虑了高并发场景下的竞态条件？
- [ ] 是否需要使用分布式锁？
- [ ] 是否编写了并发安全测试用例？

## 最佳实践总结

1. **始终在事务内进行完整的业务操作**
2. **避免事务嵌套，使用内部方法替代**
3. **在事务内重新获取最新数据进行检查**
4. **使用统一的错误处理和日志记录模式**
5. **编写并发测试用例验证事务安全性**
6. **定期审查代码，确保遵循事务设计原则**

## 参考示例

本项目中的成功实践：
- `LandManagerService.expandLand` - 标准业务操作模式
- `ShopService.sellAllCrops` - 批量操作模式
- `EconomyService._updateCoinsInTransaction` - 内部方法模式

通过遵循这些原则和模式，可以确保系统的数据一致性和并发安全性，避免常见的事务处理问题。
