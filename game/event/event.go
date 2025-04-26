package event

import (
	"sync"
)

// Event 事件接口
type Event interface {
	// GetType 获取事件类型
	GetType() string

	// GetData 获取事件数据
	GetData() interface{}
}

// BaseEvent 基础事件
type BaseEvent struct {
	eventType string
	data      interface{}
}

// NewBaseEvent 创建新的基础事件
func NewBaseEvent(eventType string, data interface{}) *BaseEvent {
	return &BaseEvent{
		eventType: eventType,
		data:      data,
	}
}

// GetType 获取事件类型
func (e *BaseEvent) GetType() string {
	return e.eventType
}

// GetData 获取事件数据
func (e *BaseEvent) GetData() interface{} {
	return e.data
}

// EventHandler 事件处理器接口
type EventHandler interface {
	// Handle 处理事件
	Handle(event Event)
}

// EventHandlerFunc 事件处理函数
type EventHandlerFunc func(event Event)

// Handle 实现EventHandler接口
func (f EventHandlerFunc) Handle(event Event) {
	f(event)
}

// EventBus 事件总线
type EventBus struct {
	subscribers map[string][]EventHandler
	mutex       sync.RWMutex
}

// NewEventBus 创建新的事件总线
func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string][]EventHandler),
	}
}

// Subscribe 订阅事件
func (eb *EventBus) Subscribe(eventType string, handler EventHandler) {
	eb.mutex.Lock()
	defer eb.mutex.Unlock()
	eb.subscribers[eventType] = append(eb.subscribers[eventType], handler)
}

// SubscribeFunc 使用函数订阅事件
func (eb *EventBus) SubscribeFunc(eventType string, handler func(event Event)) {
	eb.Subscribe(eventType, EventHandlerFunc(handler))
}

// Unsubscribe 取消订阅事件
func (eb *EventBus) Unsubscribe(eventType string, handler EventHandler) {
	eb.mutex.Lock()
	defer eb.mutex.Unlock()

	handlers, ok := eb.subscribers[eventType]
	if !ok {
		return
	}

	// 过滤掉要取消的处理器
	newHandlers := make([]EventHandler, 0, len(handlers))
	for _, h := range handlers {
		// 简单比较两个接口的指针值
		if h != handler {
			newHandlers = append(newHandlers, h)
		}
	}

	if len(newHandlers) == 0 {
		delete(eb.subscribers, eventType)
	} else {
		eb.subscribers[eventType] = newHandlers
	}
}

// Publish 发布事件
func (eb *EventBus) Publish(event Event) {
	eb.mutex.RLock()
	handlers, ok := eb.subscribers[event.GetType()]
	eb.mutex.RUnlock()

	if !ok {
		return
	}

	// 调用所有处理器
	for _, handler := range handlers {
		handler.Handle(event)
	}
}

// Clear 清空所有订阅
func (eb *EventBus) Clear() {
	eb.mutex.Lock()
	defer eb.mutex.Unlock()
	eb.subscribers = make(map[string][]EventHandler)
}
