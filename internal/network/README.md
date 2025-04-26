# 网络通信模块

本模块负责Go-DDZ游戏服务器的网络通信功能，提供了TCP和WebSocket两种通信方式。

## 目录结构

```
network/
├── codec/             # 编解码器（未实现）
├── packet/            # 消息包定义（未实现）
├── tcp/               # TCP服务器实现
│   ├── tcp_server.go  # TCP服务器
│   └── tcp_session.go # TCP会话
├── websocket/         # WebSocket服务器实现
│   ├── ws_server.go   # WebSocket服务器
│   └── ws_session.go  # WebSocket会话
└── README.md          # 本文档
```

## 设计理念

网络模块设计基于以下几个核心理念：

1. **协议无关性**：通过定义通用的消息和会话接口，使上层业务逻辑不依赖于具体的网络协议
2. **消息驱动**：采用消息驱动架构，使系统松耦合、易扩展
3. **灵活性**：支持TCP和WebSocket两种通信方式，可以根据需求选择
4. **性能优化**：使用goroutine优化并发处理，实现高性能网络通信

## 使用示例

### TCP服务器
```go
// 创建分发器
dispatcher := dispatcher.NewDispatcher()

// 创建TCP服务器
tcpServer := tcp.NewTCPServer(":8081", dispatcher)

// 启动服务器
if err := tcpServer.Start(); err != nil {
    log.Fatalf("启动TCP服务器失败: %v", err)
}

// 停止服务器
tcpServer.Stop()
```

### WebSocket服务器
```go
// 创建分发器
dispatcher := dispatcher.NewDispatcher()

// 创建WebSocket服务器
wsServer := websocket.NewWebSocketServer(":8082", "/ws", dispatcher)

// 启动服务器
if err := wsServer.Start(); err != nil {
    log.Fatalf("启动WebSocket服务器失败: %v", err)
}

// 停止服务器
wsServer.Stop()
```

## 未来计划

1. 实现更完善的编解码器，支持二进制协议
2. 添加性能监控和统计功能
3. 实现更安全的通信机制，支持TLS/SSL
4. 优化会话管理，提高大量连接下的性能 