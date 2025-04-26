package system

import (
	"sync"

	"github.com/yourusername/go-ddz/game/entity"
)

// System 系统接口
type System interface {
	// Update 更新系统状态
	Update(dt float32)

	// AddEntity 添加实体
	AddEntity(entity entity.Entity)

	// RemoveEntity 移除实体
	RemoveEntity(entityID int64)

	// GetEntities 获取所有实体
	GetEntities() []entity.Entity
}

// BaseSystem 基础系统
type BaseSystem struct {
	entities map[int64]entity.Entity
	mu       sync.RWMutex
}

// NewBaseSystem 创建新的基础系统
func NewBaseSystem() *BaseSystem {
	return &BaseSystem{
		entities: make(map[int64]entity.Entity),
	}
}

// AddEntity 添加实体
func (s *BaseSystem) AddEntity(entity entity.Entity) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entities[entity.GetID()] = entity
}

// RemoveEntity 移除实体
func (s *BaseSystem) RemoveEntity(entityID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entities, entityID)
}

// GetEntities 获取所有实体
func (s *BaseSystem) GetEntities() []entity.Entity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entities := make([]entity.Entity, 0, len(s.entities))
	for _, entity := range s.entities {
		entities = append(entities, entity)
	}
	return entities
}

// GetEntityByID 根据ID获取实体
func (s *BaseSystem) GetEntityByID(entityID int64) (entity.Entity, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entity, ok := s.entities[entityID]
	return entity, ok
}
