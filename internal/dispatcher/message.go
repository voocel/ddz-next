package dispatcher

import (
	"encoding/json"
	"time"
)

// MessageType 消息类型
type MessageType int

const (
	// TypeUnknown 未知消息类型
	TypeUnknown MessageType = iota
	// TypeRequest 请求消息
	TypeRequest
	// TypeResponse 响应消息
	TypeResponse
	// TypeNotify 通知消息
	TypeNotify
)

// 预定义路由常量
const (
	RouteError      = "error"       // 错误路由
	RouteHeartbeat  = "heartbeat"   // 心跳路由
	RouteLogin      = "login"       // 登录路由
	RouteLogout     = "logout"      // 登出路由
	RouteCreateRoom = "create_room" // 创建房间路由
	RouteJoinRoom   = "join_room"   // 加入房间路由
	RouteLeaveRoom  = "leave_room"  // 离开房间路由
	RouteStartGame  = "start_game"  // 开始游戏路由
	RoutePlayCards  = "play_cards"  // 出牌路由
	RoutePass       = "pass"        // 过牌路由
	RouteChat       = "chat"        // 聊天路由

	// 房间相关路由
	RouteRoomList    = "room_list"    // 房间列表
	RouteRoomInfo    = "room_info"    // 房间信息
	RoutePlayerReady = "player_ready" // 玩家准备

	// 游戏相关路由
	RouteGameStart  = "game_start"  // 游戏开始
	RouteGameOver   = "game_over"   // 游戏结束
	RouteDealCards  = "deal_cards"  // 发牌
	RouteBid        = "bid"         // 叫分
	RouteGameStatus = "game_status" // 游戏状态
	RoutePlayerTurn = "player_turn" // 玩家回合
)

// Message 通用消息结构
type Message struct {
	// 消息ID
	ID string `json:"id"`
	// 消息类型
	Type MessageType `json:"type"`
	// 消息路由
	Route string `json:"route"`
	// 消息数据
	Data json.RawMessage `json:"data"`
	// 错误信息
	Error string `json:"error,omitempty"`
	// 时间戳
	Timestamp int64 `json:"timestamp"`
	// 消息来源会话ID
	SessionID string `json:"session_id,omitempty"`
}

// NewMessage 创建新消息
func NewMessage(msgType MessageType, route string, data interface{}) *Message {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		// 序列化失败时使用空数据
		dataBytes = []byte("{}")
	}

	return &Message{
		ID:        generateID(),
		Type:      msgType,
		Route:     route,
		Data:      dataBytes,
		Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
	}
}

// NewRequest 创建请求消息
func NewRequest(route string, data interface{}) *Message {
	return NewMessage(TypeRequest, route, data)
}

// NewResponse 创建响应消息
func NewResponse(requestID string, route string, data interface{}) *Message {
	msg := NewMessage(TypeResponse, route, data)
	msg.ID = requestID
	return msg
}

// NewErrorResponse 创建错误响应消息
func NewErrorResponse(requestID string, route string, errMsg string) *Message {
	msg := NewMessage(TypeResponse, route, nil)
	msg.ID = requestID
	msg.Error = errMsg
	return msg
}

// NewNotify 创建通知消息
func NewNotify(route string, data interface{}) *Message {
	return NewMessage(TypeNotify, route, data)
}

// generateID 生成唯一ID
func generateID() string {
	// 简化起见，这里使用时间戳
	// 实际项目中可能需要更复杂的ID生成策略
	return time.Now().Format("20060102150405.000") + "_" + randString(8)
}

// randString 生成随机字符串
func randString(n int) string {
	// 简化示例，应替换为更好的随机实现
	const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, n)
	for i := range result {
		result[i] = letterBytes[time.Now().UnixNano()%int64(len(letterBytes))]
		time.Sleep(1 * time.Nanosecond)
	}
	return string(result)
}
