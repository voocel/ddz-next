package websocket

import (
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/yourusername/go-ddz/internal/dispatcher"
)

var (
	// ErrSessionClosed 会话已关闭错误
	ErrSessionClosed = errors.New("会话已关闭")
	// ErrWriteTimeout 写入超时错误
	ErrWriteTimeout = errors.New("写入超时")
)

// 会话状态
const (
	// SessionStatusInit 初始状态
	SessionStatusInit = 0
	// SessionStatusConnected 已连接
	SessionStatusConnected = 1
	// SessionStatusClosed 已关闭
	SessionStatusClosed = 2
)

// WSSession 实现Session接口的WebSocket会话
type WSSession struct {
	id            string                 // 会话ID
	conn          WebSocketConn          // WebSocket连接
	status        int                    // 会话状态
	values        map[string]interface{} // 会话值存储
	lastActive    time.Time              // 最后活动时间
	writeChan     chan *Message          // 写入通道
	closeChan     chan struct{}          // 关闭通道
	mu            sync.RWMutex           // 读写锁
	writeTimeout  time.Duration          // 写入超时
	closeCallback func(string)           // 关闭回调
}

// NewSession 创建新的WebSocket会话
func NewSession(conn WebSocketConn) *WSSession {
	id := uuid.New().String()
	return &WSSession{
		id:           id,
		conn:         conn,
		status:       SessionStatusInit,
		values:       make(map[string]interface{}),
		lastActive:   time.Now(),
		writeChan:    make(chan *Message, 100),
		closeChan:    make(chan struct{}),
		writeTimeout: 5 * time.Second,
	}
}

// ID 获取会话ID
func (s *WSSession) ID() string {
	return s.id
}

// Start 启动会话
func (s *WSSession) Start(handler func(*Message) error) {
	s.mu.Lock()
	if s.status != SessionStatusInit {
		s.mu.Unlock()
		return
	}
	s.status = SessionStatusConnected
	s.mu.Unlock()

	// 启动写入协程
	go s.writeLoop()

	// 启动读取协程
	go s.readLoop(handler)
}

// SetCloseCallback 设置关闭回调
func (s *WSSession) SetCloseCallback(callback func(string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeCallback = callback
}

// Send 发送消息
func (s *WSSession) Send(message interface{}) error {
	s.mu.RLock()
	if s.status != SessionStatusConnected {
		s.mu.RUnlock()
		return ErrSessionClosed
	}
	s.mu.RUnlock()

	// 更新最后活动时间
	s.UpdateActive()

	var wsMsg *Message

	// 根据消息类型进行适当转换
	switch msg := message.(type) {
	case *Message:
		// 已经是WebSocket消息类型
		wsMsg = msg
	case *dispatcher.Message:
		// 转换Dispatcher消息为WebSocket消息
		wsMsg = &Message{
			ID:        msg.ID,
			Cmd:       msg.Route,
			Param:     msg.Data,
			Code:      0,
			Message:   msg.Error,
			Timestamp: msg.Timestamp,
			SessionID: msg.SessionID,
		}
	default:
		return errors.New("不支持的消息类型")
	}

	// 设置会话ID
	wsMsg.SessionID = s.id

	// 发送消息到写入通道
	select {
	case s.writeChan <- wsMsg:
		return nil
	case <-time.After(s.writeTimeout):
		return ErrWriteTimeout
	}
}

// Close 关闭会话
func (s *WSSession) Close() error {
	s.mu.Lock()
	if s.status == SessionStatusClosed {
		s.mu.Unlock()
		return nil
	}
	s.status = SessionStatusClosed
	close(s.closeChan)
	callback := s.closeCallback
	s.mu.Unlock()

	// 关闭连接
	var err error
	if s.conn != nil {
		err = s.conn.Close()
	}

	// 执行关闭回调
	if callback != nil {
		callback(s.id)
	}

	return err
}

// SetValue 设置会话值
func (s *WSSession) SetValue(key string, value interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[key] = value
}

// GetValue 获取会话值
func (s *WSSession) GetValue(key string) (interface{}, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.values[key]
	return value, ok
}

// RemoveValue 删除会话值
func (s *WSSession) RemoveValue(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, key)
}

// UpdateActive 更新活动时间
func (s *WSSession) UpdateActive() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastActive = time.Now()
}

// LastActiveTime 获取最后活动时间
func (s *WSSession) LastActiveTime() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastActive
}

// LastActive 返回最后活动时间（兼容dispatcher.Session接口）
func (s *WSSession) LastActive() time.Time {
	return s.LastActiveTime()
}

// 读取循环
func (s *WSSession) readLoop(handler func(*Message) error) {
	defer func() {
		if err := s.Close(); err != nil {
			log.Printf("关闭会话错误: %v", err)
		}
	}()

	for {
		// 读取消息
		_, data, err := s.conn.ReadMessage()
		if err != nil {
			log.Printf("读取消息错误: %v", err)
			return
		}

		// 更新活动时间
		s.UpdateActive()

		// 解析消息
		var message Message
		if err := json.Unmarshal(data, &message); err != nil {
			log.Printf("解析消息错误: %v", err)
			continue
		}

		// 设置会话ID
		message.SessionID = s.id

		// 处理消息
		if err := handler(&message); err != nil {
			log.Printf("处理消息错误: %v", err)
			// 返回错误响应，使用新的错误常量
			errMsg := NewErrorResponseWithCode(message.ID, message.Cmd, ErrCodeInternal)
			s.Send(errMsg)
		}
	}
}

// 写入循环
func (s *WSSession) writeLoop() {
	defer func() {
		if err := s.Close(); err != nil {
			log.Printf("关闭会话错误: %v", err)
		}
	}()

	for {
		select {
		case message := <-s.writeChan:
			// 序列化消息
			data, err := json.Marshal(message)
			if err != nil {
				log.Printf("序列化消息错误: %v", err)
				continue
			}

			// 写入消息
			if err := s.conn.WriteMessage(1, data); err != nil {
				log.Printf("写入消息错误: %v", err)
				return
			}
		case <-s.closeChan:
			return
		}
	}
}
