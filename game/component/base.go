package component

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

// BaseComponent 所有组件的基础结构
type BaseComponent struct {
	id         string            // 组件唯一ID
	name       string            // 组件名称
	enabled    bool              // 组件是否启用
	createTime time.Time         // 创建时间
	updateTime time.Time         // 最后更新时间
	tags       map[string]string // 组件标签，用于分类和筛选
	mutex      sync.RWMutex      // 读写锁，保证并发安全
}

// NewBaseComponent 创建一个新的基础组件
func NewBaseComponent(name string) *BaseComponent {
	now := time.Now()
	return &BaseComponent{
		id:         uuid.New().String(),
		name:       name,
		enabled:    true,
		createTime: now,
		updateTime: now,
		tags:       make(map[string]string),
	}
}

// GetID 获取组件ID
func (b *BaseComponent) GetID() string {
	return b.id
}

// GetName 获取组件名称
func (b *BaseComponent) GetName() string {
	b.mutex.RLock()
	defer b.mutex.RUnlock()
	return b.name
}

// SetName 设置组件名称
func (b *BaseComponent) SetName(name string) {
	b.mutex.Lock()
	defer b.mutex.Unlock()
	b.name = name
	b.updateTime = time.Now()
}

// IsEnabled 检查组件是否启用
func (b *BaseComponent) IsEnabled() bool {
	b.mutex.RLock()
	defer b.mutex.RUnlock()
	return b.enabled
}

// SetEnabled 设置组件启用状态
func (b *BaseComponent) SetEnabled(enabled bool) {
	b.mutex.Lock()
	defer b.mutex.Unlock()
	b.enabled = enabled
	b.updateTime = time.Now()
}

// GetCreateTime 获取创建时间
func (b *BaseComponent) GetCreateTime() time.Time {
	return b.createTime
}

// GetUpdateTime 获取最后更新时间
func (b *BaseComponent) GetUpdateTime() time.Time {
	b.mutex.RLock()
	defer b.mutex.RUnlock()
	return b.updateTime
}

// AddTag 添加标签
func (b *BaseComponent) AddTag(key, value string) {
	b.mutex.Lock()
	defer b.mutex.Unlock()
	b.tags[key] = value
	b.updateTime = time.Now()
}

// GetTag 获取标签
func (b *BaseComponent) GetTag(key string) (string, bool) {
	b.mutex.RLock()
	defer b.mutex.RUnlock()
	value, exists := b.tags[key]
	return value, exists
}

// RemoveTag 移除标签
func (b *BaseComponent) RemoveTag(key string) {
	b.mutex.Lock()
	defer b.mutex.Unlock()
	delete(b.tags, key)
	b.updateTime = time.Now()
}

// GetTags 获取所有标签
func (b *BaseComponent) GetTags() map[string]string {
	b.mutex.RLock()
	defer b.mutex.RUnlock()

	// 创建tags的副本，避免外部修改
	tagsCopy := make(map[string]string, len(b.tags))
	for k, v := range b.tags {
		tagsCopy[k] = v
	}

	return tagsCopy
}

// Reset 重置组件状态
func (b *BaseComponent) Reset() {
	b.mutex.Lock()
	defer b.mutex.Unlock()
	b.enabled = true
	b.updateTime = time.Now()
	b.tags = make(map[string]string)
}
