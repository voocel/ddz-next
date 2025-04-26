package websocket

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/yourusername/go-ddz/internal/dispatcher" // 修改为实际包路径
)

// ServerConfig WebSocket服务器配置
type ServerConfig struct {
	// ReadBufferSize 读缓冲区大小
	ReadBufferSize int
	// WriteBufferSize 写缓冲区大小
	WriteBufferSize int
	// HandshakeTimeout 握手超时时间
	HandshakeTimeout time.Duration
	// Path WebSocket路径
	Path string
	// AllowOrigins 允许的源列表，为空表示允许所有
	AllowOrigins []string
}

// DefaultConfig 默认配置
func DefaultConfig() ServerConfig {
	return ServerConfig{
		ReadBufferSize:   4096,
		WriteBufferSize:  4096,
		HandshakeTimeout: 10 * time.Second,
		Path:             "/ws",
	}
}

// Server WebSocket服务器
type Server struct {
	config         ServerConfig
	upgrader       websocket.Upgrader
	httpServer     *http.Server
	dispatcher     *dispatcher.Dispatcher // 使用公共的Dispatcher
	sessionManager *SessionManager
	wg             sync.WaitGroup
}

// NewServer 创建新的WebSocket服务器
func NewServer(config ServerConfig, disp *dispatcher.Dispatcher) *Server {
	upgrader := websocket.Upgrader{
		ReadBufferSize:   config.ReadBufferSize,
		WriteBufferSize:  config.WriteBufferSize,
		HandshakeTimeout: config.HandshakeTimeout,
		CheckOrigin: func(r *http.Request) bool {
			// 如果未指定允许的源，则允许所有源
			if len(config.AllowOrigins) == 0 {
				return true
			}

			origin := r.Header.Get("Origin")
			for _, allowedOrigin := range config.AllowOrigins {
				if origin == allowedOrigin {
					return true
				}
			}
			return false
		},
	}

	return &Server{
		config:         config,
		upgrader:       upgrader,
		dispatcher:     disp, // 使用传入的Dispatcher
		sessionManager: GetSessionManager(),
	}
}

// NewWebSocketServer 创建默认配置的WebSocket服务器
func NewWebSocketServer(disp *dispatcher.Dispatcher) *Server {
	return NewServer(DefaultConfig(), disp)
}

// wsHandler WebSocket连接处理函数
func (s *Server) wsHandler(w http.ResponseWriter, r *http.Request) {
	// 升级HTTP连接为WebSocket连接
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("升级WebSocket连接失败: %v", err)
		return
	}

	// 创建会话
	session := NewSession(conn)

	// 添加到会话管理器
	s.sessionManager.AddSession(session)

	// 同时添加到公共Dispatcher的会话管理器
	s.dispatcher.AddSession(session)

	// 启动会话 - 使用消息转换函数将WebSocket消息转发到Dispatcher
	session.Start(func(msg *Message) error {
		// 将websocket消息转换为dispatcher消息
		dispatcherMsg := s.convertToDispatcherMessage(msg)
		return s.dispatcher.HandleMessage(session, dispatcherMsg)
	})

	log.Printf("新WebSocket连接已建立: %s", session.ID())
}

// 将websocket消息转换为dispatcher消息
func (s *Server) convertToDispatcherMessage(msg *Message) *dispatcher.Message {
	return &dispatcher.Message{
		ID:        msg.ID,
		Type:      1,           // 默认请求类型
		Route:     msg.Cmd,     // 使用Cmd作为Route
		Data:      msg.Param,   // 使用Param作为Data
		Error:     msg.Message, // 使用Message作为Error
		Timestamp: msg.Timestamp,
		SessionID: msg.SessionID,
	}
}

// Start 启动WebSocket服务器
func (s *Server) Start(addr string) error {
	// 创建HTTP服务器
	mux := http.NewServeMux()
	mux.HandleFunc(s.config.Path, s.wsHandler)

	s.httpServer = &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	log.Printf("WebSocket服务器启动，监听地址: %s%s", addr, s.config.Path)
	return s.httpServer.ListenAndServe()
}

// Stop 停止WebSocket服务器
func (s *Server) Stop() error {
	if s.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		log.Println("正在关闭WebSocket服务器...")
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}

// GetSessionManager 获取会话管理器
func (s *Server) GetSessionManager() *SessionManager {
	return s.sessionManager
}

// RegisterHandler 注册消息处理器 - 转发到公共Dispatcher
func (s *Server) RegisterHandler(route string, handler MessageHandler) {
	// 创建适配器将websocket的Handler转为dispatcher的Handler
	s.dispatcher.RegisterHandlerFunc(route, func(msg *dispatcher.Message) error {
		// 将dispatcher消息转换回websocket消息
		wsMsg := &Message{
			ID:        msg.ID,
			Cmd:       msg.Route, // 使用Route作为Cmd
			Param:     msg.Data,  // 使用Data作为Param
			Code:      0,         // 默认成功
			Message:   msg.Error, // 使用Error作为Message
			Timestamp: msg.Timestamp,
			SessionID: msg.SessionID,
		}
		return handler.Handle(wsMsg)
	})
}

// RegisterHandlerFunc 注册消息处理函数 - 转发到公共Dispatcher
func (s *Server) RegisterHandlerFunc(route string, handlerFunc HandlerFunc) {
	// 创建适配器将websocket的HandlerFunc转为dispatcher的HandlerFunc
	s.dispatcher.RegisterHandlerFunc(route, func(msg *dispatcher.Message) error {
		// 将dispatcher消息转换回websocket消息
		wsMsg := &Message{
			ID:        msg.ID,
			Cmd:       msg.Route, // 使用Route作为Cmd
			Param:     msg.Data,  // 使用Data作为Param
			Code:      0,         // 默认成功
			Message:   msg.Error, // 使用Error作为Message
			Timestamp: msg.Timestamp,
			SessionID: msg.SessionID,
		}
		return handlerFunc(wsMsg)
	})
}

// BroadcastMessage 广播消息给所有会话 - 使用公共Dispatcher广播
func (s *Server) BroadcastMessage(message *Message) {
	dispatcherMsg := s.convertToDispatcherMessage(message)
	s.dispatcher.BroadcastMessage(dispatcherMsg)
}

// BroadcastToUsers 广播消息给指定用户 - 使用会话管理器的方法
func (s *Server) BroadcastToUsers(userIDs []int64, message *Message) {
	s.sessionManager.BroadcastToUsers(userIDs, message)
}
