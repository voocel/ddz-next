package websocket

import (
	"errors"
	"log"
	"sync"
	"time"
)

var (
	// ErrSessionNotFound 会话不存在错误
	ErrSessionNotFound = errors.New("会话不存在")
)

// SessionManager WebSocket会话管理器
type SessionManager struct {
	sessions     map[string]Session // 会话映射
	userSessions map[int64]string   // 用户ID到会话ID的映射
	mu           sync.RWMutex       // 读写锁
}

// NewSessionManager 创建新的会话管理器
func NewSessionManager() *SessionManager {
	manager := &SessionManager{
		sessions:     make(map[string]Session),
		userSessions: make(map[int64]string),
	}

	// 启动会话清理
	go manager.cleanInactiveSessions()

	return manager
}

// AddSession 添加会话
func (m *SessionManager) AddSession(session Session) {
	m.mu.Lock()
	defer m.mu.Unlock()

	sessionID := session.ID()
	m.sessions[sessionID] = session

	// 设置会话关闭回调
	if s, ok := session.(*WSSession); ok {
		s.SetCloseCallback(func(sid string) {
			m.RemoveSession(sid)
		})
	}

	log.Printf("新会话已添加: %s", sessionID)
}

// RemoveSession 移除会话
func (m *SessionManager) RemoveSession(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 获取会话
	session, ok := m.sessions[sessionID]
	if !ok {
		return
	}

	// 清理用户会话映射
	userIDVal, ok := session.GetValue("userID")
	if ok {
		if userID, ok := userIDVal.(int64); ok {
			delete(m.userSessions, userID)
		}
	}

	// 删除会话
	delete(m.sessions, sessionID)

	log.Printf("会话已移除: %s", sessionID)
}

// GetSession 获取会话
func (m *SessionManager) GetSession(sessionID string) (Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	return session, ok
}

// GetSessionByUserID 根据用户ID获取会话
func (m *SessionManager) GetSessionByUserID(userID int64) (Session, bool) {
	m.mu.RLock()
	sessionID, ok := m.userSessions[userID]
	if !ok {
		m.mu.RUnlock()
		return nil, false
	}
	m.mu.RUnlock()

	return m.GetSession(sessionID)
}

// BindUserToSession 绑定用户到会话
func (m *SessionManager) BindUserToSession(userID int64, sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 检查会话是否存在
	if _, ok := m.sessions[sessionID]; !ok {
		return
	}

	// 清理旧的绑定
	if oldSessionID, ok := m.userSessions[userID]; ok {
		if oldSession, ok := m.sessions[oldSessionID]; ok {
			oldSession.RemoveValue("userID")
		}
	}

	// 添加新的绑定
	m.userSessions[userID] = sessionID
	m.sessions[sessionID].SetValue("userID", userID)

	log.Printf("用户 %d 已绑定到会话 %s", userID, sessionID)
}

// BroadcastMessage 广播消息给所有会话
func (m *SessionManager) BroadcastMessage(message *Message) {
	m.mu.RLock()
	sessions := make([]Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.RUnlock()

	for _, session := range sessions {
		if err := session.Send(message); err != nil {
			log.Printf("广播消息失败: %v", err)
		}
	}
}

// BroadcastToUsers 广播消息给指定用户
func (m *SessionManager) BroadcastToUsers(userIDs []int64, message *Message) {
	m.mu.RLock()
	sessionIDs := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		if sessionID, ok := m.userSessions[userID]; ok {
			sessionIDs = append(sessionIDs, sessionID)
		}
	}
	m.mu.RUnlock()

	for _, sessionID := range sessionIDs {
		if session, ok := m.GetSession(sessionID); ok {
			if err := session.Send(message); err != nil {
				log.Printf("广播消息失败: %v", err)
			}
		}
	}
}

// GetSessionCount 获取会话数量
func (m *SessionManager) GetSessionCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.sessions)
}

// GetUserCount 获取在线用户数量
func (m *SessionManager) GetUserCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.userSessions)
}

// cleanInactiveSessions 清理不活跃的会话
func (m *SessionManager) cleanInactiveSessions() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		inactiveSessions := make([]string, 0)

		m.mu.RLock()
		for id, session := range m.sessions {
			// 如果会话超过30分钟不活跃，标记为清理
			if now.Sub(session.LastActiveTime()) > 30*time.Minute {
				inactiveSessions = append(inactiveSessions, id)
			}
		}
		m.mu.RUnlock()

		// 清理不活跃的会话
		for _, id := range inactiveSessions {
			if session, ok := m.GetSession(id); ok {
				if err := session.Close(); err != nil {
					log.Printf("关闭不活跃会话 %s 错误: %v", id, err)
				}
			}
		}

		if len(inactiveSessions) > 0 {
			log.Printf("已清理 %d 个不活跃会话", len(inactiveSessions))
		}
	}
}

// 全局单例
var (
	globalSessionManager     *SessionManager
	globalSessionManagerOnce sync.Once
)

// GetSessionManager 获取全局会话管理器
func GetSessionManager() *SessionManager {
	globalSessionManagerOnce.Do(func() {
		globalSessionManager = NewSessionManager()
	})
	return globalSessionManager
}
