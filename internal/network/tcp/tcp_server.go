package tcp

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"github.com/yourusername/go-ddz/internal/dispatcher"
)

// TCPServer TCP服务器
type TCPServer struct {
	addr       string
	listener   net.Listener
	dispatcher *dispatcher.Dispatcher
	sessions   map[string]*TCPSession
	mu         sync.RWMutex
	running    bool
	wg         sync.WaitGroup
}

// NewTCPServer 创建新的TCP服务器
func NewTCPServer(addr string, dispatcher *dispatcher.Dispatcher) *TCPServer {
	return &TCPServer{
		addr:       addr,
		dispatcher: dispatcher,
		sessions:   make(map[string]*TCPSession),
	}
}

// Start 启动服务器
func (s *TCPServer) Start() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("创建TCP监听器失败: %w", err)
	}
	s.listener = listener
	s.running = true

	log.Printf("TCP服务器启动，监听地址: %s", s.addr)

	// 启动会话清理协程
	go s.cleanupSessions()

	// 接受新连接
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.acceptLoop()
	}()

	return nil
}

// Stop 停止服务器
func (s *TCPServer) Stop() error {
	s.running = false

	// 关闭监听器
	if s.listener != nil {
		if err := s.listener.Close(); err != nil {
			return fmt.Errorf("关闭TCP监听器失败: %w", err)
		}
	}

	// 关闭所有会话
	s.mu.Lock()
	for _, session := range s.sessions {
		session.Close()
	}
	s.sessions = make(map[string]*TCPSession)
	s.mu.Unlock()

	// 等待所有协程结束
	s.wg.Wait()
	log.Printf("TCP服务器已停止")
	return nil
}

// acceptLoop 接受新连接的循环
func (s *TCPServer) acceptLoop() {
	for s.running {
		conn, err := s.listener.Accept()
		if err != nil {
			if s.running {
				log.Printf("接受连接失败: %v", err)
			}
			continue
		}

		// 创建新会话
		sessionID := fmt.Sprintf("tcp_%d", time.Now().UnixNano())
		session := NewTCPSession(sessionID, conn, s.handleMessage, s.removeSession)

		// 添加到会话管理器
		s.mu.Lock()
		s.sessions[sessionID] = session
		s.mu.Unlock()

		// 添加到分发器
		s.dispatcher.AddSession(session)

		// 启动会话
		go session.Start()
	}
}

// handleMessage 处理来自会话的消息
func (s *TCPServer) handleMessage(sessionID string, data []byte) {
	var message dispatcher.Message
	if err := json.Unmarshal(data, &message); err != nil {
		log.Printf("解析消息失败: %v", err)
		return
	}

	// 获取会话
	session, ok := s.dispatcher.GetSession(sessionID)
	if !ok {
		log.Printf("会话不存在: %s", sessionID)
		return
	}

	// 分发消息
	if err := s.dispatcher.HandleMessage(session, &message); err != nil {
		log.Printf("处理消息失败: %v", err)
	}
}

// removeSession 从服务器删除会话
func (s *TCPServer) removeSession(sessionID string) {
	s.mu.Lock()
	delete(s.sessions, sessionID)
	s.mu.Unlock()

	// 从分发器移除
	s.dispatcher.RemoveSession(sessionID)
}

// cleanupSessions 清理过期会话
func (s *TCPServer) cleanupSessions() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for s.running {
		<-ticker.C

		now := time.Now()
		var sessionsToRemove []string

		s.mu.RLock()
		for id, session := range s.sessions {
			// 如果会话超过5分钟没有活动，关闭它
			if now.Sub(session.LastActive()) > 5*time.Minute {
				sessionsToRemove = append(sessionsToRemove, id)
			}
		}
		s.mu.RUnlock()

		// 移除过期会话
		for _, id := range sessionsToRemove {
			log.Printf("移除过期会话: %s", id)
			s.removeSession(id)
		}
	}
}
