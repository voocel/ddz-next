package http

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/yourusername/go-ddz/game/system"
	"github.com/yourusername/go-ddz/internal/dispatcher"
)

// Server HTTP服务器
type Server struct {
	router       *Router
	addr         string
	readTimeout  time.Duration
	writeTimeout time.Duration
	idleTimeout  time.Duration
	httpServer   *http.Server
	dispatcher   *dispatcher.Dispatcher
	roomSystem   *system.RoomSystem
}

// ServerConfig HTTP服务器配置
type ServerConfig struct {
	Addr         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

// NewServer 创建HTTP服务器
func NewServer(config ServerConfig, dispatcher *dispatcher.Dispatcher, roomSystem *system.RoomSystem) *Server {
	if config.ReadTimeout == 0 {
		config.ReadTimeout = 10 * time.Second
	}
	if config.WriteTimeout == 0 {
		config.WriteTimeout = 10 * time.Second
	}
	if config.IdleTimeout == 0 {
		config.IdleTimeout = 30 * time.Second
	}

	router := NewRouter()

	server := &Server{
		router:       router,
		addr:         config.Addr,
		readTimeout:  config.ReadTimeout,
		writeTimeout: config.WriteTimeout,
		idleTimeout:  config.IdleTimeout,
		dispatcher:   dispatcher,
		roomSystem:   roomSystem,
	}

	// 注册路由
	server.registerRoutes()

	return server
}

// registerRoutes 注册路由
func (s *Server) registerRoutes() {
	// 创建中间件
	authMiddleware := NewAuthMiddleware()

	// 创建控制器
	userController := NewUserController(s.dispatcher)
	roomController := NewRoomController(s.dispatcher)

	// 设置房间系统
	roomController.SetRoomSystem(s.roomSystem)

	// 用户相关路由 - 按照API文档路径定义
	userGroup := s.router.Group("/user")
	{
		// 注册
		userGroup.Post("/register", userController.Register)
		// 登录
		userGroup.Post("/login", userController.Login)
		// 注销
		userGroup.Post("/logout", userController.Logout, authMiddleware)
		// 获取用户信息
		userGroup.Get("/profile", userController.GetProfile, authMiddleware)
	}

	// 房间相关路由 - 按照API文档路径定义
	roomsGroup := s.router.Group("/rooms")
	{
		// 获取房间列表
		roomsGroup.Get("", roomController.ListRooms, authMiddleware)
		// 创建房间
		roomsGroup.Post("", roomController.CreateRoom, authMiddleware)
		// 获取房间详情
		roomsGroup.Get("/{room_id}", roomController.GetRoomDetail, authMiddleware)
		// 加入房间
		roomsGroup.Post("/{room_id}/join", roomController.JoinRoom, authMiddleware)
		// 离开房间
		roomsGroup.Post("/{room_id}/leave", roomController.LeaveRoom, authMiddleware)
		// 准备/取消准备
		roomsGroup.Post("/{room_id}/ready", roomController.SetReady, authMiddleware)
		// 开始游戏
		roomsGroup.Post("/{room_id}/start", roomController.StartGame, authMiddleware)
	}
}

// Start 启动HTTP服务器
func (s *Server) Start() error {
	s.httpServer = &http.Server{
		Addr:         s.addr,
		Handler:      s.router,
		ReadTimeout:  s.readTimeout,
		WriteTimeout: s.writeTimeout,
		IdleTimeout:  s.idleTimeout,
	}

	log.Printf("HTTP服务器开始监听 %s", s.addr)
	return s.httpServer.ListenAndServe()
}

// Stop 停止HTTP服务器
func (s *Server) Stop(ctx context.Context) error {
	log.Println("正在关闭HTTP服务器...")
	return s.httpServer.Shutdown(ctx)
}
