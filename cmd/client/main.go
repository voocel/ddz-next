package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

var (
	addr   = flag.String("addr", "localhost:8002", "服务器地址")
	useWs  = flag.Bool("ws", true, "使用WebSocket连接")
	wsPath = flag.String("wspath", "/ws", "WebSocket路径")
)

type Message struct {
	ID        string      `json:"id"`
	Type      int         `json:"type"`
	Route     string      `json:"route"`
	Data      interface{} `json:"data"`
	Error     string      `json:"error,omitempty"`
	Timestamp int64       `json:"timestamp"`
	SessionID string      `json:"session_id,omitempty"`
}

// MessageType 消息类型
const (
	TypeRequest  = 1 // 请求消息
	TypeResponse = 2 // 响应消息
	TypeNotify   = 3 // 通知消息
)

func main() {
	flag.Parse()

	// 创建客户端
	if *useWs {
		startWebSocketClient()
	} else {
		fmt.Println("TCP客户端暂未实现")
	}
}

func startWebSocketClient() {
	// 建立WebSocket连接
	url := fmt.Sprintf("ws://%s%s", *addr, *wsPath)
	fmt.Printf("正在连接到 %s...\n", url)

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		log.Fatalf("连接失败: %v", err)
	}
	defer conn.Close()

	fmt.Println("连接成功!")

	// 处理接收消息
	go func() {
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				log.Println("读取错误:", err)
				return
			}

			var msg Message
			if err := json.Unmarshal(message, &msg); err != nil {
				log.Printf("解析消息失败: %v\n", err)
				continue
			}

			fmt.Printf("\n收到消息: %s\n> ", formatMessage(msg))
		}
	}()

	// 发送心跳
	go func() {
		for {
			// 创建心跳消息
			heartbeat := Message{
				Type:  TypeRequest,
				Route: "heartbeat",
			}

			data, err := json.Marshal(heartbeat)
			if err != nil {
				log.Printf("序列化心跳消息失败: %v\n", err)
				continue
			}

			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				log.Printf("发送心跳失败: %v\n", err)
				return
			}

			// 休眠30秒
			<-time.After(30 * time.Second)
		}
	}()

	// 捕获中断信号
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)

	// 读取用户输入
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Println("命令格式: <路由> <消息内容>")
	fmt.Println("示例: login {\"username\":\"user1\",\"password\":\"123456\"}")
	fmt.Println("或者输入预设命令: login, create, join, ready, start")
	fmt.Println("输入 exit 退出")

	fmt.Print("> ")
	for scanner.Scan() {
		input := scanner.Text()

		if input == "exit" {
			break
		}

		// 处理预设命令
		if handlePresetCommand(conn, input) {
			fmt.Print("> ")
			continue
		}

		// 解析用户输入
		parts := strings.SplitN(input, " ", 2)
		if len(parts) < 2 {
			fmt.Println("输入格式错误，请使用: <路由> <消息内容>")
			fmt.Print("> ")
			continue
		}

		route := parts[0]
		dataStr := parts[1]

		// 解析JSON数据
		var data interface{}
		if err := json.Unmarshal([]byte(dataStr), &data); err != nil {
			// 如果不是有效的JSON，当作字符串处理
			data = dataStr
		}

		// 创建消息
		msg := Message{
			Type:  TypeRequest,
			Route: route,
			Data:  data,
		}

		// 序列化消息
		msgData, err := json.Marshal(msg)
		if err != nil {
			fmt.Printf("序列化消息失败: %v\n", err)
			fmt.Print("> ")
			continue
		}

		// 发送消息
		if err := conn.WriteMessage(websocket.TextMessage, msgData); err != nil {
			fmt.Printf("发送消息失败: %v\n", err)
			fmt.Print("> ")
			continue
		}

		fmt.Printf("已发送: %s\n", string(msgData))
		fmt.Print("> ")
	}

	// 发送关闭消息
	err = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	if err != nil {
		log.Println("写入关闭消息失败:", err)
	}

	select {
	case <-interrupt:
		fmt.Println("接收到中断信号，正在关闭...")
		err := conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		if err != nil {
			log.Println("写入关闭消息失败:", err)
		}
	default:
	}
}

// 处理预设命令
func handlePresetCommand(conn *websocket.Conn, cmd string) bool {
	var msg Message

	switch cmd {
	case "login":
		msg = Message{
			Type:  TypeRequest,
			Route: "login",
			Data: map[string]interface{}{
				"username": "user1",
				"password": "123456",
			},
		}
	case "create":
		msg = Message{
			Type:  TypeRequest,
			Route: "create_room",
			Data: map[string]interface{}{
				"name":        "测试房间",
				"max_players": 3,
			},
		}
	case "join":
		msg = Message{
			Type:  TypeRequest,
			Route: "join_room",
			Data: map[string]interface{}{
				"room_id": "room_123",
			},
		}
	case "ready":
		msg = Message{
			Type:  TypeRequest,
			Route: "player_ready",
			Data: map[string]interface{}{
				"ready": true,
			},
		}
	case "start":
		msg = Message{
			Type:  TypeRequest,
			Route: "start_game",
			Data:  map[string]interface{}{},
		}
	default:
		return false
	}

	// 序列化并发送消息
	msgData, err := json.Marshal(msg)
	if err != nil {
		fmt.Printf("序列化消息失败: %v\n", err)
		return true
	}

	if err := conn.WriteMessage(websocket.TextMessage, msgData); err != nil {
		fmt.Printf("发送消息失败: %v\n", err)
		return true
	}

	fmt.Printf("已发送: %s\n", string(msgData))
	return true
}

// 格式化消息输出
func formatMessage(msg Message) string {
	// 将Data转为美观的JSON
	var dataStr string
	if msg.Data != nil {
		dataBytes, err := json.MarshalIndent(msg.Data, "", "  ")
		if err != nil {
			dataStr = fmt.Sprintf("%v", msg.Data)
		} else {
			dataStr = string(dataBytes)
		}
	}

	return fmt.Sprintf("ID: %s\n类型: %d\n路由: %s\n数据: %s\n错误: %s",
		msg.ID, msg.Type, msg.Route, dataStr, msg.Error)
}
