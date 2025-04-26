package dispatcher

import (
	"log"
	"sync"
)

// Dispatcher 消息分发器
type Dispatcher struct {
	router         *Router
	sessionManager *SessionManager
	middlewares    []MiddlewareFunc
	mu             sync.RWMutex
}

// NewDispatcher 创建新的消息分发器
func NewDispatcher() *Dispatcher {
	return &Dispatcher{
		router:         NewRouter(),
		sessionManager: NewSessionManager(),
		middlewares:    make([]MiddlewareFunc, 0),
	}
}

// RegisterHandler 注册消息处理器
func (d *Dispatcher) RegisterHandler(route string, handler Handler) {
	d.router.AddRoute(route, handler)
}

// RegisterHandlerFunc 注册消息处理函数
func (d *Dispatcher) RegisterHandlerFunc(route string, handlerFunc HandlerFunc) {
	d.router.AddRouteFunc(route, handlerFunc)
}

// Use 添加中间件
func (d *Dispatcher) Use(middleware MiddlewareFunc) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.middlewares = append(d.middlewares, middleware)
}

// AddSession 添加会话
func (d *Dispatcher) AddSession(session Session) {
	d.sessionManager.AddSession(session)
}

// RemoveSession 移除会话
func (d *Dispatcher) RemoveSession(sessionID string) {
	d.sessionManager.RemoveSession(sessionID)
}

// GetSession 获取会话
func (d *Dispatcher) GetSession(sessionID string) (Session, bool) {
	return d.sessionManager.GetSession(sessionID)
}

// BroadcastMessage 广播消息
func (d *Dispatcher) BroadcastMessage(message interface{}) error {
	return d.sessionManager.BroadcastMessage(message)
}

// Dispatch 分发消息
func (d *Dispatcher) Dispatch(message *Message) error {
	if message == nil {
		return ErrInvalidMessage
	}

	handler, err := d.router.Route(message.Route)
	if err != nil {
		return err
	}

	// 应用中间件
	handlerFunc := handler.Handle
	d.mu.RLock()
	middlewares := make([]MiddlewareFunc, len(d.middlewares))
	copy(middlewares, d.middlewares)
	d.mu.RUnlock()

	// 逆序应用中间件
	wrappedHandler := func(msg *Message) error {
		return handlerFunc(msg)
	}

	for i := len(middlewares) - 1; i >= 0; i-- {
		middleware := middlewares[i]
		prev := wrappedHandler
		wrappedHandler = func(msg *Message) error {
			nextHandler := func(nextMsg *Message) error {
				return prev(nextMsg)
			}
			return middleware(nextHandler)(msg)
		}
	}

	// 处理消息
	return wrappedHandler(message)
}

// HandleMessage 处理并路由消息到对应处理器
func (d *Dispatcher) HandleMessage(session Session, message interface{}) error {
	var msg *Message
	var ok bool

	if msg, ok = message.(*Message); !ok {
		return ErrInvalidMessage
	}

	if msg == nil {
		return ErrInvalidMessage
	}

	// 设置消息会话ID
	msg.SessionID = session.ID()

	// 更新会话最后活动时间
	session.UpdateActive()

	// 分发消息
	if err := d.Dispatch(msg); err != nil {
		log.Printf("消息处理错误: %v, 路由: %s", err, msg.Route)

		// 如果是请求类型消息，返回错误响应
		if msg.Type == TypeRequest {
			errMsg := NewErrorResponse(msg.ID, msg.Route, err.Error())
			return session.Send(errMsg)
		}
		return err
	}

	return nil
}
