package component

// Component 组件接口
type Component interface {
	// GetName 获取组件名称
	GetName() string
}

// EntityRelated 与实体关联的组件接口
type EntityRelated interface {
	Component
	// GetEntityID 获取关联的实体ID
	GetEntityID() int64
	// SetEntityID 设置关联的实体ID
	SetEntityID(id int64)
}
