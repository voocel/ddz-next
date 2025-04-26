// Package websocket 提供了基于WebSocket协议的网络通信功能
package websocket

import (
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
	"github.com/yourusername/go-ddz/internal/dispatcher" // 修改为实际包路径
)

// 消息类型常量
const (
	// MessageTypeRequest 请求消息
	MessageTypeRequest = 1
	// MessageTypeResponse 响应消息
	MessageTypeResponse = 2
	// MessageTypeNotify 通知消息
	MessageTypeNotify = 3
	// MessageTypeEvent 事件消息
	MessageTypeEvent = 4
)

// 系统路由常量，按照API文档命名 (cmd格式：模块名/方法名)
const (
	// CmdPing 心跳请求
	CmdPing = "system/ping"
	// CmdPong 心跳响应
	CmdPong = "system/pong"
	// CmdLogin 登录（内部使用）
	CmdLogin = "system/login"
	// CmdLogout 登出（内部使用）
	CmdLogout = "system/logout"
)

// 游戏命令常量，按照API文档命名
const (
	// 斗地主游戏命令
	CmdEnterRoom = "ddz/enterRoom" // 加入/重连房间
	CmdReady     = "ddz/ready"     // 玩家准备
	CmdCall      = "ddz/call"      // 叫地主
	CmdRob       = "ddz/rob"       // 抢地主
	CmdPlay      = "ddz/play"      // 出牌
	CmdPass      = "ddz/pass"      // 过牌 (不要)
	CmdTrust     = "ddz/trust"     // 托管/取消托管
	CmdReConnect = "ddz/reConnect" // 断线重连
)

// 游戏事件类型常量 (服务器推送type字段)
const (
	// 房间消息类型
	TypeRoomInfo   = "room_info"   // 房间信息
	TypePlayerInfo = "player_info" // 玩家信息
	TypeReady      = "ready"       // 准备
	TypeDeal       = "deal"        // 发牌
	TypeCall       = "call"        // 叫地主
	TypeRob        = "rob"         // 抢地主
	TypeIsCanPlay  = "is_can_play" // 可以出牌
	TypePlay       = "play"        // 出牌
	TypePass       = "pass"        // 过牌
	TypeTrust      = "trust"       // 托管
	TypeEnd        = "end"         // 游戏结束
)

// Message WebSocket消息结构
type Message struct {
	// ID 消息唯一标识（内部使用）
	ID string `json:"-"`
	// Cmd 消息命令，格式: 模块名/方法名
	Cmd string `json:"cmd,omitempty"`
	// Param 消息参数对象
	Param json.RawMessage `json:"param,omitempty"`
	// Type 消息类型标识（服务器推送时使用）
	Type string `json:"type,omitempty"`
	// Result 推送消息结果（服务器推送时使用）
	Result json.RawMessage `json:"result,omitempty"`
	// Data 消息数据 （兼容dispatcher包的Message）
	Data json.RawMessage `json:"-"`
	// Code 错误码，用于错误响应
	Code int `json:"code,omitempty"`
	// Message 错误信息，用于错误响应
	Message string `json:"message,omitempty"`
	// Timestamp 时间戳（内部使用）
	Timestamp int64 `json:"-"`
	// SessionID 会话ID（内部使用）
	SessionID string `json:"-"`
}

// Session WebSocket会话接口
type Session interface {
	// ID 获取会话ID
	ID() string
	// Send 发送消息
	Send(message interface{}) error
	// Close 关闭会话
	Close() error
	// SetValue 设置会话值
	SetValue(key string, value interface{})
	// GetValue 获取会话值
	GetValue(key string) (interface{}, bool)
	// RemoveValue 删除会话值
	RemoveValue(key string)
	// UpdateActive 更新活动时间
	UpdateActive()
	// LastActiveTime 获取最后活动时间
	LastActiveTime() time.Time
	// LastActive 实现dispatcher.Session接口
	LastActive() time.Time
}

// MessageHandler 消息处理器接口
type MessageHandler interface {
	// Handle 处理消息
	Handle(message *Message) error
}

// HandlerFunc 消息处理函数类型
type HandlerFunc func(message *Message) error

// WebSocketConn WebSocket连接接口，用于测试时模拟
type WebSocketConn interface {
	// ReadMessage 读取消息
	ReadMessage() (int, []byte, error)
	// WriteMessage 写入消息
	WriteMessage(messageType int, data []byte) error
	// Close 关闭连接
	Close() error
}

// 确保gorilla的websocket.Conn实现了我们的WebSocketConn接口
var _ WebSocketConn = (*websocket.Conn)(nil)

// 将dispatcher.Message转换为websocket.Message
func ConvertFromDispatcherMessage(msg *dispatcher.Message) *Message {
	return &Message{
		ID:        msg.ID,
		Cmd:       msg.Route, // 使用Route作为Cmd
		Param:     msg.Data,  // 使用Data作为Param
		Timestamp: msg.Timestamp,
		SessionID: msg.SessionID,
	}
}
