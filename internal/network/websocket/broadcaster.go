package websocket

import (
	"log"
	"sync"
)

// RoomBroadcaster 房间广播器
type RoomBroadcaster struct {
	rooms          map[string]map[string]Session // 房间ID -> 会话ID -> 会话
	sessionRooms   map[string]string             // 会话ID -> 房间ID
	mu             sync.RWMutex                  // 读写锁
	sessionManager *SessionManager               // 会话管理器
}

// NewRoomBroadcaster 创建新的房间广播器
func NewRoomBroadcaster() *RoomBroadcaster {
	return &RoomBroadcaster{
		rooms:          make(map[string]map[string]Session),
		sessionRooms:   make(map[string]string),
		sessionManager: GetSessionManager(),
	}
}

// JoinRoom 加入房间
func (b *RoomBroadcaster) JoinRoom(sessionID string, roomID string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	// 获取会话
	session, ok := b.sessionManager.GetSession(sessionID)
	if !ok {
		return false
	}

	// 如果房间不存在，创建新房间
	if _, ok := b.rooms[roomID]; !ok {
		b.rooms[roomID] = make(map[string]Session)
	}

	// 如果会话已在其他房间，先离开
	if oldRoomID, ok := b.sessionRooms[sessionID]; ok {
		if oldRoomID == roomID {
			return true // 已经在该房间中
		}

		// 从旧房间移除
		delete(b.rooms[oldRoomID], sessionID)

		// 如果旧房间为空，删除房间
		if len(b.rooms[oldRoomID]) == 0 {
			delete(b.rooms, oldRoomID)
		}
	}

	// 加入房间
	b.rooms[roomID][sessionID] = session
	b.sessionRooms[sessionID] = roomID

	log.Printf("会话 %s 加入房间 %s", sessionID, roomID)
	return true
}

// LeaveRoom 离开房间
func (b *RoomBroadcaster) LeaveRoom(sessionID string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	// 检查会话是否在房间中
	roomID, ok := b.sessionRooms[sessionID]
	if !ok {
		return false
	}

	// 从房间中移除会话
	delete(b.rooms[roomID], sessionID)
	delete(b.sessionRooms, sessionID)

	// 如果房间为空，删除房间
	if len(b.rooms[roomID]) == 0 {
		delete(b.rooms, roomID)
	}

	log.Printf("会话 %s 离开房间 %s", sessionID, roomID)
	return true
}

// BroadcastToRoom 广播消息给房间所有会话
func (b *RoomBroadcaster) BroadcastToRoom(roomID string, message *Message) {
	b.mu.RLock()
	room, ok := b.rooms[roomID]
	if !ok {
		b.mu.RUnlock()
		return
	}

	// 复制会话列表，避免在遍历时修改
	sessions := make([]Session, 0, len(room))
	for _, session := range room {
		sessions = append(sessions, session)
	}
	b.mu.RUnlock()

	// 广播消息
	for _, session := range sessions {
		if err := session.Send(message); err != nil {
			log.Printf("广播消息到房间 %s 失败: %v", roomID, err)
		}
	}
}

// BroadcastToRoomExcept 广播消息给房间除指定会话外的所有会话
func (b *RoomBroadcaster) BroadcastToRoomExcept(roomID string, exceptSessionID string, message *Message) {
	b.mu.RLock()
	room, ok := b.rooms[roomID]
	if !ok {
		b.mu.RUnlock()
		return
	}

	// 复制会话列表，避免在遍历时修改
	sessions := make([]Session, 0, len(room))
	for sid, session := range room {
		if sid != exceptSessionID {
			sessions = append(sessions, session)
		}
	}
	b.mu.RUnlock()

	// 广播消息
	for _, session := range sessions {
		if err := session.Send(message); err != nil {
			log.Printf("广播消息到房间 %s 失败: %v", roomID, err)
		}
	}
}

// GetRoomSessions 获取房间中的所有会话
func (b *RoomBroadcaster) GetRoomSessions(roomID string) []Session {
	b.mu.RLock()
	defer b.mu.RUnlock()

	room, ok := b.rooms[roomID]
	if !ok {
		return []Session{}
	}

	sessions := make([]Session, 0, len(room))
	for _, session := range room {
		sessions = append(sessions, session)
	}
	return sessions
}

// GetRoomSessionCount 获取房间会话数量
func (b *RoomBroadcaster) GetRoomSessionCount(roomID string) int {
	b.mu.RLock()
	defer b.mu.RUnlock()

	room, ok := b.rooms[roomID]
	if !ok {
		return 0
	}
	return len(room)
}

// GetSessionRoomID 获取会话所在的房间ID
func (b *RoomBroadcaster) GetSessionRoomID(sessionID string) (string, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	roomID, ok := b.sessionRooms[sessionID]
	return roomID, ok
}

// GetRoomCount 获取房间数量
func (b *RoomBroadcaster) GetRoomCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.rooms)
}

// CleanupSession 清理会话
func (b *RoomBroadcaster) CleanupSession(sessionID string) {
	b.LeaveRoom(sessionID)
}

// 全局单例
var (
	globalRoomBroadcaster     *RoomBroadcaster
	globalRoomBroadcasterOnce sync.Once
)

// GetRoomBroadcaster 获取全局房间广播器
func GetRoomBroadcaster() *RoomBroadcaster {
	globalRoomBroadcasterOnce.Do(func() {
		globalRoomBroadcaster = NewRoomBroadcaster()
	})
	return globalRoomBroadcaster
}
