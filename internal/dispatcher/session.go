package dispatcher

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Session 表示一个客户端会话
type Session interface {
	// ID 返回会话ID
	ID() string
	// Send 发送消息
	Send(message interface{}) error
	// Close 关闭会话
	Close() error
	// SetValue 设置会话属性
	SetValue(key string, value interface{})
	// GetValue 获取会话属性
	GetValue(key string) (interface{}, bool)
	// LastActive 返回最后活动时间
	LastActive() time.Time
	// UpdateActive 更新活动时间
	UpdateActive()
}

// BaseSession 基础会话实现
type BaseSession struct {
	id         string
	values     map[string]interface{}
	valuesMu   sync.RWMutex
	lastActive time.Time
	ctx        context.Context
	cancelFunc context.CancelFunc
}

// NewBaseSession 创建新的基础会话
func NewBaseSession(id string) *BaseSession {
	ctx, cancel := context.WithCancel(context.Background())
	return &BaseSession{
		id:         id,
		values:     make(map[string]interface{}),
		lastActive: time.Now(),
		ctx:        ctx,
		cancelFunc: cancel,
	}
}

// ID 返回会话ID
func (s *BaseSession) ID() string {
	return s.id
}

// SetValue 设置会话属性
func (s *BaseSession) SetValue(key string, value interface{}) {
	s.valuesMu.Lock()
	defer s.valuesMu.Unlock()
	s.values[key] = value
}

// GetValue 获取会话属性
func (s *BaseSession) GetValue(key string) (interface{}, bool) {
	s.valuesMu.RLock()
	defer s.valuesMu.RUnlock()
	val, ok := s.values[key]
	return val, ok
}

// LastActive 返回最后活动时间
func (s *BaseSession) LastActive() time.Time {
	return s.lastActive
}

// UpdateActive 更新活动时间
func (s *BaseSession) UpdateActive() {
	s.lastActive = time.Now()
}

// Context 返回会话上下文
func (s *BaseSession) Context() context.Context {
	return s.ctx
}

// Cancel 取消会话上下文
func (s *BaseSession) Cancel() {
	s.cancelFunc()
}

// Send 发送消息
func (s *BaseSession) Send(message interface{}) error {
	// 基础会话不支持直接发送消息
	return errors.New("基础会话不支持发送消息")
}

// SessionManager 会话管理器
type SessionManager struct {
	sessions map[string]Session
	mu       sync.RWMutex
}

// NewSessionManager 创建新的会话管理器
func NewSessionManager() *SessionManager {
	return &SessionManager{
		sessions: make(map[string]Session),
	}
}

// AddSession 添加会话
func (m *SessionManager) AddSession(session Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[session.ID()] = session
}

// RemoveSession 移除会话
func (m *SessionManager) RemoveSession(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if session, exists := m.sessions[sessionID]; exists {
		session.Close()
		delete(m.sessions, sessionID)
	}
}

// GetSession 获取会话
func (m *SessionManager) GetSession(sessionID string) (Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, ok := m.sessions[sessionID]
	return session, ok
}

// BroadcastMessage 广播消息给所有会话
func (m *SessionManager) BroadcastMessage(message interface{}) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, session := range m.sessions {
		if err := session.Send(message); err != nil {
			// 记录错误但继续广播
			// 可以考虑在这里添加日志
		}
	}
	return nil
}
