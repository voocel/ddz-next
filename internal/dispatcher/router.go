package dispatcher

import (
	"fmt"
	"sync"
)

// Handler 消息处理器接口
type Handler interface {
	// Handle 处理消息
	Handle(message *Message) error
}

// HandlerFunc 函数类型处理器
type HandlerFunc func(message *Message) error

// FuncHandler 基于函数的处理器实现
type FuncHandler struct {
	fn HandlerFunc
}

// NewFuncHandler 创建函数处理器
func NewFuncHandler(fn HandlerFunc) *FuncHandler {
	return &FuncHandler{
		fn: fn,
	}
}

// Handle 实现Handler接口
func (h *FuncHandler) Handle(message *Message) error {
	return h.fn(message)
}

// MiddlewareFunc 中间件函数类型
type MiddlewareFunc func(next HandlerFunc) HandlerFunc

// Router 路由器，负责管理消息路由
type Router struct {
	routes map[string]Handler
	mu     sync.RWMutex
}

// NewRouter 创建新的路由器
func NewRouter() *Router {
	return &Router{
		routes: make(map[string]Handler),
	}
}

// AddRoute 添加路由
func (r *Router) AddRoute(route string, handler Handler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.routes[route] = handler
}

// AddRouteFunc 添加路由函数
func (r *Router) AddRouteFunc(route string, handlerFunc HandlerFunc) {
	r.AddRoute(route, NewFuncHandler(handlerFunc))
}

// Route 路由消息到对应处理器
func (r *Router) Route(route string) (Handler, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	handler, exists := r.routes[route]
	if !exists {
		return nil, fmt.Errorf("no handler registered for route: %s", route)
	}

	return handler, nil
}
