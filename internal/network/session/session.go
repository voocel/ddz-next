package session

import (
	"sync"
	"time"
)

// Session 会话接口
type Session interface {
	// ID 获取会话ID
	ID() string

	// Send 发送消息
	Send(message interface{}) error

	// Close 关闭会话
	Close() error

	// SetAttribute 设置属性
	SetAttribute(key string, value interface{})

	// GetAttribute 获取属性
	GetAttribute(key string) (interface{}, bool)

	// RemoveAttribute 移除属性
	RemoveAttribute(key string)

	// SetUserID 设置用户ID
	SetUserID(userID int64)

	// GetUserID 获取用户ID
	GetUserID() int64

	// SetHeartbeat 更新心跳时间
	SetHeartbeat()

	// LastHeartbeat 获取最后心跳时间
	LastHeartbeat() time.Time
}

// BaseSession 基础会话实现
type BaseSession struct {
	id            string
	userID        int64
	attributes    map[string]interface{}
	lastHeartbeat time.Time
	mu            sync.RWMutex
}

// NewBaseSession 创建基础会话
func NewBaseSession(id string) *BaseSession {
	return &BaseSession{
		id:            id,
		userID:        0,
		attributes:    make(map[string]interface{}),
		lastHeartbeat: time.Now(),
	}
}

// ID 获取会话ID
func (s *BaseSession) ID() string {
	return s.id
}

// SetAttribute 设置属性
func (s *BaseSession) SetAttribute(key string, value interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attributes[key] = value
}

// GetAttribute 获取属性
func (s *BaseSession) GetAttribute(key string) (interface{}, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.attributes[key]
	return value, ok
}

// RemoveAttribute 移除属性
func (s *BaseSession) RemoveAttribute(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.attributes, key)
}

// SetUserID 设置用户ID
func (s *BaseSession) SetUserID(userID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.userID = userID
}

// GetUserID 获取用户ID
func (s *BaseSession) GetUserID() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.userID
}

// SetHeartbeat 更新心跳时间
func (s *BaseSession) SetHeartbeat() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastHeartbeat = time.Now()
}

// LastHeartbeat 获取最后心跳时间
func (s *BaseSession) LastHeartbeat() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastHeartbeat
}

// Send 这个方法需要被子类实现
func (s *BaseSession) Send(message interface{}) error {
	// 基类不实现，由子类实现
	panic("Send method must be implemented by subclass")
}

// Close 这个方法需要被子类实现
func (s *BaseSession) Close() error {
	// 基类不实现，由子类实现
	panic("Close method must be implemented by subclass")
}
