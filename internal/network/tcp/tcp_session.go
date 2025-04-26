package tcp

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"github.com/yourusername/go-ddz/internal/dispatcher"
)

// MessageHandler 消息处理函数
type MessageHandler func(sessionID string, data []byte)

// SessionCloseCallback 会话关闭回调
type SessionCloseCallback func(sessionID string)

// TCPSession TCP会话
type TCPSession struct {
	id             string
	conn           net.Conn
	messageHandler MessageHandler
	closeCallback  SessionCloseCallback
	sendChan       chan []byte
	closed         bool
	closeMutex     sync.RWMutex
	lastActive     time.Time
	values         map[string]interface{}
	valuesMutex    sync.RWMutex
}

// NewTCPSession 创建TCP会话
func NewTCPSession(id string, conn net.Conn, messageHandler MessageHandler, closeCallback SessionCloseCallback) *TCPSession {
	return &TCPSession{
		id:             id,
		conn:           conn,
		messageHandler: messageHandler,
		closeCallback:  closeCallback,
		sendChan:       make(chan []byte, 100), // 缓冲区大小可以根据需要调整
		lastActive:     time.Now(),
		values:         make(map[string]interface{}),
	}
}

// ID 实现Session接口
func (s *TCPSession) ID() string {
	return s.id
}

// Send 发送消息
func (s *TCPSession) Send(message interface{}) error {
	var data []byte
	var err error

	// 根据消息类型进行适当转换
	switch msg := message.(type) {
	case *dispatcher.Message:
		// dispatcher.Message类型，直接序列化
		data, err = json.Marshal(msg)
	case []byte:
		// 字节数组类型，直接使用
		data = msg
	case string:
		// 字符串类型，转为字节
		data = []byte(msg)
	default:
		// 其他类型，尝试JSON序列化
		data, err = json.Marshal(msg)
	}

	if err != nil {
		return err
	}

	return s.SendRaw(data)
}

// SendRaw 发送原始数据
func (s *TCPSession) SendRaw(data []byte) error {
	if s.IsClosed() {
		return errors.New("会话已关闭")
	}

	// 更新活动时间
	s.UpdateActive()

	// 发送数据
	select {
	case s.sendChan <- data:
		return nil
	default:
		return errors.New("发送队列已满")
	}
}

// Close 关闭会话
func (s *TCPSession) Close() error {
	s.closeMutex.Lock()
	defer s.closeMutex.Unlock()

	if s.closed {
		return nil
	}

	s.closed = true
	close(s.sendChan)

	// 关闭连接
	if err := s.conn.Close(); err != nil {
		return err
	}

	// 调用关闭回调
	if s.closeCallback != nil {
		s.closeCallback(s.id)
	}

	return nil
}

// IsClosed 检查会话是否已关闭
func (s *TCPSession) IsClosed() bool {
	s.closeMutex.RLock()
	defer s.closeMutex.RUnlock()
	return s.closed
}

// SetValue 设置会话属性
func (s *TCPSession) SetValue(key string, value interface{}) {
	s.valuesMutex.Lock()
	defer s.valuesMutex.Unlock()
	s.values[key] = value
}

// GetValue 获取会话属性
func (s *TCPSession) GetValue(key string) (interface{}, bool) {
	s.valuesMutex.RLock()
	defer s.valuesMutex.RUnlock()
	val, ok := s.values[key]
	return val, ok
}

// LastActive 返回最后活动时间
func (s *TCPSession) LastActive() time.Time {
	return s.lastActive
}

// UpdateActive 更新活动时间
func (s *TCPSession) UpdateActive() {
	s.lastActive = time.Now()
}

// Start 启动会话
func (s *TCPSession) Start() {
	// 启动读写协程
	go s.readLoop()
	go s.writeLoop()
}

// readLoop 读取循环
func (s *TCPSession) readLoop() {
	defer s.Close()

	reader := bufio.NewReader(s.conn)

	// 使用简单的行分隔协议
	for {
		// 使用 \n 作为消息分隔符
		data, err := reader.ReadBytes('\n')
		if err != nil {
			if err != io.EOF {
				log.Printf("读取错误: %v", err)
			}
			return
		}

		// 更新活动时间
		s.UpdateActive()

		// 消息处理
		if len(data) > 0 && s.messageHandler != nil {
			s.messageHandler(s.id, data[:len(data)-1]) // 去除换行符
		}
	}
}

// writeLoop 写入循环
func (s *TCPSession) writeLoop() {
	defer s.Close()

	for data := range s.sendChan {
		// 添加换行符作为分隔符
		if len(data) > 0 && data[len(data)-1] != '\n' {
			data = append(data, '\n')
		}

		// 写入数据
		if _, err := s.conn.Write(data); err != nil {
			log.Printf("写入错误: %v", err)
			return
		}
	}
}
