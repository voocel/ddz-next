package entity

import (
	"sync"
)

// Entity 实体接口
type Entity interface {
	// GetID 获取实体ID
	GetID() int64

	// AddComponent 添加组件
	AddComponent(componentName string, component interface{})

	// GetComponent 获取组件
	GetComponent(componentName string) interface{}

	// RemoveComponent 移除组件
	RemoveComponent(componentName string)

	// HasComponent 检查是否有组件
	HasComponent(componentName string) bool

	// GetComponents 获取所有组件
	GetComponents() map[string]interface{}
}

// BaseEntity 基础实体
type BaseEntity struct {
	id         int64
	components map[string]interface{}
	mutex      sync.RWMutex
}

// NewBaseEntity 创建新的基础实体
func NewBaseEntity(id int64) *BaseEntity {
	return &BaseEntity{
		id:         id,
		components: make(map[string]interface{}),
	}
}

// GetID 获取实体ID
func (e *BaseEntity) GetID() int64 {
	return e.id
}

// AddComponent 添加组件
func (e *BaseEntity) AddComponent(componentName string, component interface{}) {
	e.mutex.Lock()
	defer e.mutex.Unlock()
	e.components[componentName] = component
}

// GetComponent 获取组件
func (e *BaseEntity) GetComponent(componentName string) interface{} {
	e.mutex.RLock()
	defer e.mutex.RUnlock()
	return e.components[componentName]
}

// RemoveComponent 移除组件
func (e *BaseEntity) RemoveComponent(componentName string) {
	e.mutex.Lock()
	defer e.mutex.Unlock()
	delete(e.components, componentName)
}

// HasComponent 检查是否有组件
func (e *BaseEntity) HasComponent(componentName string) bool {
	e.mutex.RLock()
	defer e.mutex.RUnlock()
	_, ok := e.components[componentName]
	return ok
}

// GetComponents 获取所有组件
func (e *BaseEntity) GetComponents() map[string]interface{} {
	e.mutex.RLock()
	defer e.mutex.RUnlock()

	// 创建组件的副本
	components := make(map[string]interface{}, len(e.components))
	for name, comp := range e.components {
		components[name] = comp
	}

	return components
}
