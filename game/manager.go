package game

import (
	"sync"

	"github.com/yourusername/go-ddz/game/event"
	"github.com/yourusername/go-ddz/game/system"
)

// GameManager 游戏管理器
type GameManager struct {
	roomSystem  *system.RoomSystem
	gameSystems map[string]*system.GameSystem
	userIDGen   int64
	userIDMutex sync.Mutex
	mu          sync.RWMutex
	eventBus    *event.EventBus
}

// NewGameManager 创建新的游戏管理器
func NewGameManager() *GameManager {
	eventBus := event.NewEventBus()

	return &GameManager{
		roomSystem:  system.NewRoomSystem(eventBus),
		gameSystems: make(map[string]*system.GameSystem),
		userIDGen:   1000,
		eventBus:    eventBus,
	}
}

// GenerateUserID 生成用户ID
func (gm *GameManager) GenerateUserID() int64 {
	gm.userIDMutex.Lock()
	defer gm.userIDMutex.Unlock()

	gm.userIDGen++
	return gm.userIDGen
}

// GetOrCreateGameSystem 获取或创建游戏系统
func (gm *GameManager) GetOrCreateGameSystem(roomID string, baseScore int) *system.GameSystem {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	if gameSystem, ok := gm.gameSystems[roomID]; ok {
		return gameSystem
	}

	// 创建新的游戏系统
	gameSystem := system.NewGameSystem(roomID, baseScore, gm.eventBus)
	gm.gameSystems[roomID] = gameSystem

	return gameSystem
}

// RemoveGameSystem 删除游戏系统
func (gm *GameManager) RemoveGameSystem(roomID string) {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	delete(gm.gameSystems, roomID)
}

// Update 更新所有系统
func (gm *GameManager) Update(dt float32) {
	// 更新房间系统
	gm.roomSystem.Update(dt)

	// 更新游戏系统
	gm.mu.RLock()
	defer gm.mu.RUnlock()

	for _, gameSystem := range gm.gameSystems {
		gameSystem.Update(dt)
	}
}

// GetRoomSystem 获取房间系统
func (gm *GameManager) GetRoomSystem() *system.RoomSystem {
	return gm.roomSystem
}

// GetEventBus 获取事件总线
func (gm *GameManager) GetEventBus() *event.EventBus {
	return gm.eventBus
}
