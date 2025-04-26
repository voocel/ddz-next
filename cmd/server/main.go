package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yourusername/go-ddz/game"
	"github.com/yourusername/go-ddz/internal/dispatcher"
	httpServer "github.com/yourusername/go-ddz/internal/network/http"
	"github.com/yourusername/go-ddz/internal/network/tcp"
	"github.com/yourusername/go-ddz/internal/network/websocket"
)

var (
	tcpAddr  = flag.String("tcp", ":8001", "TCP服务地址")
	wsAddr   = flag.String("ws", ":8002", "WebSocket服务地址")
	wsPath   = flag.String("wspath", "/ws", "WebSocket路径")
	httpAddr = flag.String("http", ":8000", "HTTP服务地址")
)

func main() {
	flag.Parse()

	// 创建游戏管理器
	gameManager := game.NewGameManager()

	// 创建分发器
	msgDispatcher := dispatcher.NewDispatcher()

	// 创建TCP服务器
	tcpServer := tcp.NewTCPServer(*tcpAddr, msgDispatcher)
	if err := tcpServer.Start(); err != nil {
		log.Fatalf("启动TCP服务器失败: %v", err)
	}

	// 创建WebSocket服务器
	wsServer := websocket.NewWebSocketServer(msgDispatcher)

	// 创建游戏处理器并注册
	websocket.NewGameHandlers(gameManager, wsServer)

	go func() {
		if err := wsServer.Start(*wsAddr); err != nil {
			log.Fatalf("启动WebSocket服务器失败: %v", err)
		}
	}()

	// 创建HTTP服务器
	httpConfig := httpServer.ServerConfig{
		Addr: *httpAddr,
	}
	httpSrv := httpServer.NewServer(httpConfig, msgDispatcher, gameManager.GetRoomSystem())

	// 启动HTTP服务器
	go func() {
		if err := httpSrv.Start(); err != nil {
			log.Fatalf("启动HTTP服务器失败: %v", err)
		}
	}()

	log.Println("斗地主游戏服务器已启动")
	log.Printf("TCP服务监听: %s", *tcpAddr)
	log.Printf("WebSocket服务监听: %s%s", *wsAddr, *wsPath)
	log.Printf("HTTP服务监听: %s", *httpAddr)

	// 启动系统更新循环
	go func() {
		// 30FPS更新
		const frameTime = 1.0 / 30.0
		ticker := time.NewTicker(time.Duration(frameTime * float32(time.Second)))
		defer ticker.Stop()

		for range ticker.C {
			gameManager.Update(frameTime)
		}
	}()

	// 等待中断信号
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	// 优雅关闭
	log.Println("正在关闭服务器...")
	tcpServer.Stop()
	// WebSocketServer没有Stop方法，可能需要在未来添加
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	httpSrv.Stop(ctx)
	log.Println("服务器已关闭")
}
