package websocket

import (
	"errors"
	"fmt"
	"sync"
)

var (
	// ErrRouteNotFound 路由未找到错误
	ErrRouteNotFound = errors.New("路由未找到")
)

// Router WebSocket消息路由器
type Router struct {
	handlers map[string]MessageHandler // 路由处理器映射
	mu       sync.RWMutex              // 读写锁
}

// NewRouter 创建新的消息路由器
func NewRouter() *Router {
	return &Router{
		handlers: make(map[string]MessageHandler),
	}
}

// Register 注册消息处理器
func (r *Router) Register(route string, handler MessageHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[route] = handler
}

// RegisterFunc 注册消息处理函数
func (r *Router) RegisterFunc(route string, handlerFunc HandlerFunc) {
	r.Register(route, &funcHandler{handlerFunc})
}

// Route 路由消息
func (r *Router) Route(message *Message) error {
	r.mu.RLock()
	handler, ok := r.handlers[message.Cmd]
	r.mu.RUnlock()

	if !ok {
		return fmt.Errorf("%w: %s", ErrRouteNotFound, message.Cmd)
	}

	return handler.Handle(message)
}

// funcHandler 函数类型的消息处理器
type funcHandler struct {
	fn HandlerFunc
}

// Handle 处理消息
func (h *funcHandler) Handle(message *Message) error {
	return h.fn(message)
}
