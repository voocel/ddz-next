# 斗地主游戏前端接口文档

## 接口概述

本文档描述了斗地主游戏系统的前端接口设计。接口分为两部分：
1. RESTful API - 用于非实时操作（用户认证、查询房间列表等）
2. WebSocket - 用于实时游戏交互

## 1. RESTful API

### 基础URL
```
http://api.yourdomain.com/v1
```

### 1.1 用户管理

#### 1.1.1 用户注册
- **URL**: `/users/register`
- **方法**: POST
- **请求体**:
```json
{
  "username": "玩家昵称",
  "password": "密码",
  "avatar": "头像URL（可选）"
}
```
- **响应**:
```json
{
  "code": 0,
  "message": "注册成功",
  "data": {
    "user_id": 10001,
    "username": "玩家昵称",
    "token": "认证令牌"
  }
}
```

#### 1.1.2 用户登录
- **URL**: `/users/login`
- **方法**: POST
- **请求体**:
```json
{
  "username": "玩家昵称",
  "password": "密码"
}
```
- **响应**:
```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "user_id": 10001,
    "username": "玩家昵称",
    "avatar": "头像URL",
    "token": "认证令牌"
  }
}
```

#### 1.1.3 获取用户信息
- **URL**: `/users/profile`
- **方法**: GET
- **请求头**: `Authorization: Bearer {token}`
- **响应**:
```json
{
  "code": 0,
  "message": "成功",
  "data": {
    "user_id": 10001,
    "username": "玩家昵称",
    "avatar": "头像URL",
    "score": 5000,
    "win_count": 10,
    "lose_count": 5,
    "game_count": 15
  }
}
```

### 1.2 房间管理

#### 1.2.1 获取房间列表
- **URL**: `/rooms`
- **方法**: GET
- **请求头**: `Authorization: Bearer {token}`
- **参数**:
  - `page`: 页码，默认1
  - `size`: 每页数量，默认10
  - `status`: 房间状态，waiting=等待中，playing=游戏中
- **响应**:
```json
{
  "code": 0,
  "message": "成功",
  "data": {
    "total": 25,
    "rooms": [
      {
        "room_id": "R1001",
        "name": "快乐斗地主",
        "owner_id": 10001,
        "owner_name": "房主昵称",
        "player_count": 2,
        "max_players": 3,
        "status": "waiting",
        "is_private": false,
        "base_score": 100,
        "game_count": 10,
        "current_game": 0
      }
    ]
  }
}
```

#### 1.2.2 创建房间
- **URL**: `/rooms`
- **方法**: POST
- **请求头**: `Authorization: Bearer {token}`
- **请求体**:
```json
{
  "name": "房间名称",
  "password": "房间密码（可选）",
  "max_players": 3,
  "base_score": 100,
  "game_count": 10
}
```
- **响应**:
```json
{
  "code": 0,
  "message": "创建成功",
  "data": {
    "room_id": "R1001",
    "name": "房间名称",
    "is_private": true,
    "password": "房间密码"
  }
}
```

#### 1.2.3 获取房间详情
- **URL**: `/rooms/{room_id}`
- **方法**: GET
- **请求头**: `Authorization: Bearer {token}`
- **响应**:
```json
{
  "code": 0,
  "message": "成功",
  "data": {
    "room_id": "R1001",
    "name": "快乐斗地主",
    "owner_id": 10001,
    "owner_name": "房主昵称",
    "status": "waiting",
    "is_private": false,
    "base_score": 100,
    "game_count": 10,
    "current_game": 0,
    "create_time": "2023-05-20T14:30:00Z",
    "players": [
      {
        "user_id": 10001,
        "username": "玩家1",
        "avatar": "头像URL",
        "ready": true
      },
      {
        "user_id": 10002,
        "username": "玩家2",
        "avatar": "头像URL",
        "ready": false
      }
    ]
  }
}
```

#### 1.2.4 加入房间
- **URL**: `/rooms/{room_id}/join`
- **方法**: POST
- **请求头**: `Authorization: Bearer {token}`
- **请求体**:
```json
{
  "password": "房间密码（私密房间必填）"
}
```
- **响应**:
```json
{
  "code": 0,
  "message": "加入成功",
  "data": {
    "room_id": "R1001",
    "name": "快乐斗地主",
    "players": [
      {
        "user_id": 10001,
        "username": "玩家1",
        "avatar": "头像URL",
        "ready": true
      },
      {
        "user_id": 10002,
        "username": "玩家2",
        "avatar": "头像URL",
        "ready": false
      }
    ]
  }
}
```

#### 1.2.5 离开房间
- **URL**: `/rooms/{room_id}/leave`
- **方法**: POST
- **请求头**: `Authorization: Bearer {token}`
- **响应**:
```json
{
  "code": 0,
  "message": "已离开房间"
}
```

#### 1.2.6 准备/取消准备
- **URL**: `/rooms/{room_id}/ready`
- **方法**: POST
- **请求头**: `Authorization: Bearer {token}`
- **请求体**:
```json
{
  "ready": true  // true=准备，false=取消准备
}
```
- **响应**:
```json
{
  "code": 0,
  "message": "准备完成"
}
```

#### 1.2.7 开始游戏（仅房主）
- **URL**: `/rooms/{room_id}/start`
- **方法**: POST
- **请求头**: `Authorization: Bearer {token}`
- **响应**:
```json
{
  "code": 0,
  "message": "游戏开始"
}
```

## 2. WebSocket 接口

### 连接

WebSocket连接URL：
```
ws://api.yourdomain.com/ws?token={token}
```

### 2.1 消息格式

所有WebSocket消息采用JSON格式，基本结构为：

**客户端发送消息**:
```json
{
  "cmd": "命令名称",
  "data": {
    // 命令参数
  }
}
```

**服务器响应消息**:
```json
{
  "cmd": "命令名称",
  "code": 0,          // 0表示成功，非0表示错误
  "message": "消息说明",
  "data": {
    // 响应数据
  }
}
```

### 2.2 心跳机制

客户端需要定期发送心跳消息以保持连接：

**发送**:
```json
{
  "cmd": "ping",
  "data": {
    "timestamp": 1621500000
  }
}
```

**接收**:
```json
{
  "cmd": "pong",
  "code": 0,
  "data": {
    "timestamp": 1621500001
  }
}
```

### 2.3 游戏命令

#### 2.3.1 叫分

**发送**:
```json
{
  "cmd": "call_score",
  "data": {
    "room_id": "R1001",
    "score": 3  // 0=不叫，1-3=叫分
  }
}
```

**接收（广播）**:
```json
{
  "cmd": "player_called",
  "code": 0,
  "data": {
    "user_id": 10001,
    "username": "玩家1",
    "score": 3
  }
}
```

#### 2.3.2 出牌

**发送**:
```json
{
  "cmd": "play_cards",
  "data": {
    "room_id": "R1001",
    "cards": [
      {"suit": 1, "value": 3},
      {"suit": 2, "value": 3}
    ]
  }
}
```

**接收（广播）**:
```json
{
  "cmd": "player_played",
  "code": 0,
  "data": {
    "user_id": 10001,
    "username": "玩家1",
    "cards": [
      {"suit": 1, "value": 3},
      {"suit": 2, "value": 3}
    ],
    "card_type": "pair",  // 牌型
    "remaining": 15       // 剩余牌数
  }
}
```

#### 2.3.3 不出牌

**发送**:
```json
{
  "cmd": "pass",
  "data": {
    "room_id": "R1001"
  }
}
```

**接收（广播）**:
```json
{
  "cmd": "player_passed",
  "code": 0,
  "data": {
    "user_id": 10001,
    "username": "玩家1"
  }
}
```

### 2.4 游戏事件

#### 2.4.1 游戏开始

```json
{
  "cmd": "game_started",
  "data": {
    "room_id": "R1001",
    "game_number": 1,
    "players": [
      {
        "user_id": 10001,
        "username": "玩家1",
        "position": 0
      },
      {
        "user_id": 10002,
        "username": "玩家2",
        "position": 1
      },
      {
        "user_id": 10003,
        "username": "玩家3",
        "position": 2
      }
    ],
    "first_player": 10001,
    "cards": [  // 玩家自己的牌
      {"suit": 1, "value": 3},
      {"suit": 2, "value": 3},
      // ... 其他牌
    ]
  }
}
```

#### 2.4.2 叫分阶段

```json
{
  "cmd": "call_score_stage",
  "data": {
    "room_id": "R1001",
    "current_player": 10001,
    "timeout": 15,  // 倒计时秒数
    "scores": [  // 已叫分情况
      {
        "user_id": 10001,
        "score": 0
      }
    ],
    "max_score": 0  // 当前最高分
  }
}
```

#### 2.4.3 确定地主

```json
{
  "cmd": "landlord_confirmed",
  "data": {
    "room_id": "R1001",
    "landlord_id": 10001,
    "landlord_name": "玩家1",
    "score": 3,
    "bottom_cards": [  // 地主牌，只有地主能看到具体内容
      {"suit": 1, "value": 10},
      {"suit": 2, "value": 12},
      {"suit": 3, "value": 1}
    ]
  }
}
```

#### 2.4.4 轮到玩家出牌

```json
{
  "cmd": "player_turn",
  "data": {
    "room_id": "R1001",
    "current_player": 10001,
    "timeout": 20,  // 倒计时秒数
    "is_first": true,  // 是否首轮出牌
    "last_player": 0,  // 上个出牌玩家ID，0表示没有
    "last_cards": []   // 上个出牌的牌，空表示没有
  }
}
```

#### 2.4.5 游戏结束

```json
{
  "cmd": "game_over",
  "data": {
    "room_id": "R1001",
    "winner_id": 10001,
    "winner_name": "玩家1",
    "winner_role": "landlord",  // landlord=地主，farmer=农民
    "score": 3,
    "multiple": 2,  // 倍数
    "players": [
      {
        "user_id": 10001,
        "username": "玩家1",
        "role": "landlord",
        "score_change": 600,
        "total_score": 5600,
        "cards": [  // 剩余的牌
          {"suit": 1, "value": 1}
        ]
      },
      {
        "user_id": 10002,
        "username": "玩家2",
        "role": "farmer",
        "score_change": -300,
        "total_score": 4700,
        "cards": [  // 剩余的牌
          {"suit": 2, "value": 5},
          {"suit": 3, "value": 7}
        ]
      },
      {
        "user_id": 10003,
        "username": "玩家3",
        "role": "farmer",
        "score_change": -300,
        "total_score": 4800,
        "cards": [  // 剩余的牌
          {"suit": 4, "value": 9},
          {"suit": 1, "value": 11}
        ]
      }
    ]
  }
}
```

### 2.5 房间事件

#### 2.5.1 玩家加入房间

```json
{
  "cmd": "player_joined",
  "data": {
    "room_id": "R1001",
    "user_id": 10003,
    "username": "玩家3",
    "avatar": "头像URL",
    "ready": false,
    "players": [  // 房间内所有玩家
      {
        "user_id": 10001,
        "username": "玩家1",
        "avatar": "头像URL",
        "ready": true
      },
      {
        "user_id": 10002,
        "username": "玩家2",
        "avatar": "头像URL",
        "ready": false
      },
      {
        "user_id": 10003,
        "username": "玩家3",
        "avatar": "头像URL",
        "ready": false
      }
    ]
  }
}
```

#### 2.5.2 玩家离开房间

```json
{
  "cmd": "player_left",
  "data": {
    "room_id": "R1001",
    "user_id": 10003,
    "username": "玩家3",
    "players": [  // 剩余玩家
      {
        "user_id": 10001,
        "username": "玩家1",
        "avatar": "头像URL",
        "ready": true
      },
      {
        "user_id": 10002,
        "username": "玩家2",
        "avatar": "头像URL",
        "ready": false
      }
    ]
  }
}
```

#### 2.5.3 玩家准备状态变更

```json
{
  "cmd": "player_ready_changed",
  "data": {
    "room_id": "R1001",
    "user_id": 10002,
    "username": "玩家2",
    "ready": true
  }
}
```

#### 2.5.4 房主变更

```json
{
  "cmd": "room_owner_changed",
  "data": {
    "room_id": "R1001",
    "owner_id": 10002,
    "owner_name": "玩家2"
  }
}
```

## 3. 错误码

| 错误码 | 描述 |
|-------|------|
| 0 | 成功 |
| 1001 | 未认证或认证失败 |
| 1002 | 参数错误 |
| 2001 | 用户不存在 |
| 2002 | 密码错误 |
| 3001 | 房间不存在 |
| 3002 | 房间已满 |
| 3003 | 密码错误 |
| 3004 | 玩家已在房间中 |
| 3005 | 玩家不在房间中 |
| 3006 | 非房主无法开始游戏 |
| 3007 | 玩家数量不足，无法开始游戏 |
| 3008 | 不是所有玩家都已准备 |
| 4001 | 非当前玩家回合 |
| 4002 | 出牌不符合规则 |
| 4003 | 玩家没有足够的牌 |
| 4004 | 首轮出牌不能过牌 |
| 4005 | 地主牌已分配，无法叫分 | 