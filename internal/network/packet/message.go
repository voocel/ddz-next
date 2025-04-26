package packet

import (
	"encoding/binary"
	"encoding/json"
	"errors"
)

const (
	// HeaderSize 消息头大小：消息长度(4字节) + 消息ID(2字节) + 操作码(2字节)
	HeaderSize = 8
	// MaxMessageSize 最大消息大小 10MB
	MaxMessageSize = 10 * 1024 * 1024
)

// 错误定义
var (
	ErrMessageTooLarge = errors.New("消息体过大")
	ErrInvalidHeader   = errors.New("无效的消息头")
)

// Message 消息结构体
type Message struct {
	ID      uint16 `json:"id"`      // 消息ID
	OpCode  uint16 `json:"op_code"` // 操作码
	Payload []byte `json:"payload"` // 消息内容
}

// NewMessage 创建新消息
func NewMessage(id uint16, opCode uint16, payload []byte) *Message {
	return &Message{
		ID:      id,
		OpCode:  opCode,
		Payload: payload,
	}
}

// Marshal 将消息序列化为二进制
func (m *Message) Marshal() ([]byte, error) {
	payloadLen := len(m.Payload)
	totalLen := HeaderSize + payloadLen

	if totalLen > MaxMessageSize {
		return nil, ErrMessageTooLarge
	}

	data := make([]byte, totalLen)

	// 写入消息长度（整个消息的长度）
	binary.BigEndian.PutUint32(data[0:4], uint32(totalLen))
	// 写入消息ID
	binary.BigEndian.PutUint16(data[4:6], m.ID)
	// 写入操作码
	binary.BigEndian.PutUint16(data[6:8], m.OpCode)
	// 写入消息体
	copy(data[HeaderSize:], m.Payload)

	return data, nil
}

// Unmarshal 从二进制数据解析消息
func Unmarshal(data []byte) (*Message, error) {
	if len(data) < HeaderSize {
		return nil, ErrInvalidHeader
	}

	totalLen := binary.BigEndian.Uint32(data[0:4])

	if totalLen > MaxMessageSize || int(totalLen) != len(data) {
		return nil, ErrInvalidHeader
	}

	// 解析消息ID和操作码
	id := binary.BigEndian.Uint16(data[4:6])
	opCode := binary.BigEndian.Uint16(data[6:8])

	// 提取消息体
	payload := make([]byte, len(data)-HeaderSize)
	copy(payload, data[HeaderSize:])

	return &Message{
		ID:      id,
		OpCode:  opCode,
		Payload: payload,
	}, nil
}

// JsonMarshal 将结构体序列化为JSON格式的payload
func JsonMarshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

// JsonUnmarshal 将JSON格式的payload反序列化为结构体
func JsonUnmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}
