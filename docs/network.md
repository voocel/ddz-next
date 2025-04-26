# Go-DDZ 网络通信框架文档

## 1. 架构概述

Go-DDZ 游戏服务器采用了一种基于消息分发的架构，支持 TCP 和 WebSocket 协议。核心组件包括：

- **消息分发器**：处理和路由所有消息
- **会话管理器**：管理客户端连接会话
- **路由器**：将消息路由到相应的处理函数
- **TCP/WebSocket 服务器**：处理底层通信协议

整体架构如下：

```
客户端 <---> TCP/WebSocket服务器 <---> 会话管理器 <---> 消息分发器 <---> 路由器 <---> 消息处理器
```

## 2. 消息协议

### 2.1 消息格式

消息采用JSON格式，基本结构如下：

```json
{
  "id": "唯一消息ID",
  "type": 1,         // 消息类型：1=请求，2=响应，3=通知
  "route": "login",  // 消息路由
  "data": {},        // 消息数据（根据路由不同而不同）
  "error": "",       // 错误信息（仅在响应消息中可能出现）
  "timestamp": 1618823653000,  // 时间戳
  "session_id": "xxx"  // 会话ID（服务器使用）
}
```

### 2.2 消息类型

- **请求消息 (Type=1)**：客户端发送给服务器的请求
- **响应消息 (Type=2)**：服务器对客户端请求的响应
- **通知消息 (Type=3)**：服务器主动推送给客户端的通知

### 2.3 预定义路由

系统预定义了一些标准路由：

- **heartbeat**：心跳消息
- **login**：登录
- **create_room**：创建房间
- **join_room**：加入房间
- **leave_room**：离开房间
- **player_ready**：玩家准备
- **start_game**：开始游戏
- **play_cards**：出牌
- **pass**：过牌
- **chat**：聊天消息

## 3. 服务器组件

### 3.1 消息分发器 (Dispatcher)

消息分发器负责管理路由和会话，是整个框架的核心。主要功能：

- 注册消息处理器
- 管理客户端会话
- 分发消息到对应处理器
- 支持中间件机制

```go
// 创建分发器
dispatcher := dispatcher.NewDispatcher()

// 注册处理器
dispatcher.RegisterHandlerFunc("login", func(message *dispatcher.Message) error {
    // 处理登录逻辑
    return nil
})
```

### 3.2 会话管理器 (SessionManager)

会话管理器负责管理所有客户端连接：

- 添加和移除会话
- 根据ID获取会话
- 广播消息给所有会话

### 3.3 路由器 (Router)

路由器负责将消息路由到正确的处理函数：

- 添加路由规则
- 根据路由查找处理器

### 3.4 TCP 服务器

TCP服务器负责处理TCP连接和协议相关操作：

- 启动/停止服务
- 接受新连接
- 管理TCP会话

### 3.5 WebSocket 服务器

WebSocket服务器提供WebSocket协议支持：

- 基于HTTP服务器
- 处理WebSocket握手
- 管理WebSocket会话

## 4. 客户端通信

### 4.1 建立连接

客户端可以选择通过TCP或WebSocket与服务器建立连接：

**WebSocket**:
```javascript
const socket = new WebSocket('ws://server-address:8082/ws');
```

**TCP**:
```
直接建立TCP连接到服务器地址:8081
```

### 4.2 消息发送

客户端发送消息示例：

```javascript
// 发送登录请求
socket.send(JSON.stringify({
  type: 1,
  route: "login",
  data: {
    username: "user1",
    password: "123456"
  }
}));
```

### 4.3 消息接收

客户端接收消息示例：

```javascript
socket.onmessage = function(event) {
  const message = JSON.parse(event.data);
  
  // 处理不同类型的消息
  switch(message.type) {
    case 2: // 响应消息
      handleResponse(message);
      break;
    case 3: // 通知消息
      handleNotification(message);
      break;
  }
};
```

## 5. 扩展和定制

### 5.1 中间件

框架支持中间件机制，可以在消息处理前后添加自定义逻辑：

```go
// 添加日志中间件
dispatcher.Use(func(next dispatcher.HandlerFunc) dispatcher.HandlerFunc {
    return func(message *dispatcher.Message) error {
        log.Printf("收到消息: %s", message.Route)
        err := next(message)
        log.Printf("处理完成: %s, 错误: %v", message.Route, err)
        return err
    }
})
```

### 5.2 自定义协议编解码

如需自定义协议编解码器，可以扩展现有的TCP和WebSocket会话实现。

## 6. 示例

### 6.1 服务器示例

```go
func main() {
    // 创建分发器
    msgDispatcher := dispatcher.NewDispatcher()

    // 注册处理器
    msgDispatcher.RegisterHandlerFunc("login", handleLogin)
    msgDispatcher.RegisterHandlerFunc("create_room", handleCreateRoom)

    // 启动TCP服务器
    tcpServer := tcp.NewTCPServer(":8081", msgDispatcher)
    tcpServer.Start()

    // 启动WebSocket服务器
    wsServer := websocket.NewWebSocketServer(":8082", "/ws", msgDispatcher)
    wsServer.Start()

    // 等待中断信号
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh

    // 关闭服务器
    tcpServer.Stop()
    wsServer.Stop()
}
```

### 6.2 客户端示例

```javascript
// 前端WebSocket客户端示例
const socket = new WebSocket('ws://localhost:8082/ws');

socket.onopen = function() {
    console.log("连接成功");
    
    // 发送登录请求
    socket.send(JSON.stringify({
        type: 1,
        route: "login",
        data: {
            username: "user1",
            password: "password"
        }
    }));
};

socket.onmessage = function(event) {
    const message = JSON.parse(event.data);
    console.log("收到消息:", message);
};

socket.onclose = function() {
    console.log("连接关闭");
};
```

## 7. 性能考虑

- 会话管理采用并发安全的Map实现
- TCP读写循环使用goroutine并发处理
- 过期会话自动清理
- 消息路由使用高效的Map查找

## 8. 安全注意事项

- 生产环境中应启用TLS/SSL
- 实现消息验证和授权机制
- 限制消息大小和频率，防止DoS攻击
- 实现IP白名单和黑名单机制 