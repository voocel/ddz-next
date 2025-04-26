# WebSocket游戏事件广播系统

本文档描述了斗地主游戏的WebSocket事件广播系统架构和实现。

## 核心组件

### 1. 会话管理 (session_manager.go)

- **Session**: 表示一个WebSocket连接会话，包含用户信息和消息发送通道
- **SessionManager**: 管理所有连接的会话，提供添加、移除和查找会话的功能
- 每个会话有读写泵(ReadPump/WritePump)，负责异步处理WebSocket消息收发

### 2. 房间广播器 (broadcaster.go)

- **Broadcaster**: 用于管理房间会话和广播消息
- 支持将玩家加入/离开房间
- 提供房间级别的消息广播能力
- 支持获取房间内的所有会话信息

### 3. 消息格式 (message.go)

- 定义统一的消息格式，支持请求、响应、事件和错误消息类型
- 消息处理和路由机制，基于消息类型和命令进行分发
- 错误处理和代码定义

### 4. 游戏事件广播器 (game_event_broadcaster.go)

- 监听游戏事件系统的事件，将游戏事件转换为WebSocket消息
- 支持的游戏事件：
  - 游戏开始/结束
  - 发牌
  - 叫地主
  - 出牌/不出
  - 玩家超时
  - 玩家断线
  - 房间创建/加入/离开
  - 玩家准备状态变更

## 事件流程

1. 游戏系统（GameSystem）通过事件总线（EventBus）发布游戏事件
2. 游戏事件广播器（GameEventBroadcaster）订阅这些事件并处理
3. 广播器将事件转换为WebSocket消息，并通过Broadcaster发送到相应的房间
4. 每个玩家的WebSocket会话（Session）接收消息并转发给客户端

## 消息类型

- **请求消息（request）**: 客户端发送的请求，包含命令和数据
- **响应消息（response）**: 服务器对请求的响应
- **事件消息（event）**: 服务器主动推送的事件通知
- **错误消息（error）**: 错误响应，包含错误码和错误信息

## 使用示例

### 初始化游戏事件广播器

```go
// 创建事件总线
eventBus := event.NewEventBus()

// 创建游戏事件广播器
broadcaster := websocket.GetGameEventBroadcaster(eventBus)

// 游戏系统使用相同的事件总线
gameSystem := system.NewGameSystem(roomID, baseScore, eventBus)
```

### 发布游戏事件

```go
// 在游戏系统中发布事件
s.eventBus.Publish(event.NewBaseEvent(EventGameStart, map[string]interface{}{
    "roomID":    s.roomID,
    "startTime": s.startTime,
    "players":   s.getPlayerIDs(),
}))
```

### 处理游戏事件并广播

```go
// 在GameEventBroadcaster中处理事件
func (eb *GameEventBroadcaster) onGameStart(e event.Event) {
    data := e.GetData().(map[string]interface{})
    roomID := data["roomID"].(string)
    
    // 创建WebSocket消息
    message := NewEventMessage("game.start", map[string]interface{}{
        "room_id": roomID,
        // ...其他数据
    })
    
    // 广播消息到房间
    eb.broadcaster.BroadcastToRoom(roomID, message)
}
```

## 注意事项

1. **并发安全**: 所有的会话和房间操作都使用互斥锁保证线程安全
2. **异步处理**: 消息收发使用通道和goroutine异步处理，提高性能
3. **会话清理**: 当连接关闭时，自动清理会话并从房间中移除
4. **心跳检测**: 使用Ping/Pong机制确保连接活跃
5. **超时处理**: 设置读写超时，避免无响应连接占用资源 