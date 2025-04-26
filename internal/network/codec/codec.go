package codec

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"

	"github.com/yourusername/go-ddz/internal/network/packet"
)

// 错误定义
var (
	ErrIncompletePacket = errors.New("不完整的数据包")
	ErrTooLargePacket   = errors.New("数据包过大")
)

// Codec 编解码器接口
type Codec interface {
	// Encode 将消息编码为二进制数据
	Encode(message *packet.Message) ([]byte, error)

	// Decode 从二进制数据解码消息
	Decode(data []byte) (*packet.Message, error)

	// DecodeFromReader 从Reader解码消息
	DecodeFromReader(reader io.Reader) (*packet.Message, error)
}

// DefaultCodec 默认编解码器实现
type DefaultCodec struct{}

// NewDefaultCodec 创建默认编解码器
func NewDefaultCodec() *DefaultCodec {
	return &DefaultCodec{}
}

// Encode 将消息编码为二进制数据
func (c *DefaultCodec) Encode(message *packet.Message) ([]byte, error) {
	return message.Marshal()
}

// Decode 从二进制数据解码消息
func (c *DefaultCodec) Decode(data []byte) (*packet.Message, error) {
	return packet.Unmarshal(data)
}

// DecodeFromReader 从Reader解码消息
func (c *DefaultCodec) DecodeFromReader(reader io.Reader) (*packet.Message, error) {
	// 读取消息头
	headerBuf := make([]byte, packet.HeaderSize)
	if _, err := io.ReadFull(reader, headerBuf); err != nil {
		return nil, ErrIncompletePacket
	}

	// 解析消息长度
	totalLen := binary.BigEndian.Uint32(headerBuf[0:4])
	if totalLen > packet.MaxMessageSize {
		return nil, ErrTooLargePacket
	}

	// 读取完整消息
	messageBuf := make([]byte, totalLen)
	copy(messageBuf[0:packet.HeaderSize], headerBuf)

	// 读取消息体
	if totalLen > packet.HeaderSize {
		if _, err := io.ReadFull(reader, messageBuf[packet.HeaderSize:]); err != nil {
			return nil, ErrIncompletePacket
		}
	}

	return packet.Unmarshal(messageBuf)
}

// JSONCodec JSON编解码器
type JSONCodec struct {
	DefaultCodec
}

// NewJSONCodec 创建JSON编解码器
func NewJSONCodec() *JSONCodec {
	return &JSONCodec{}
}

// EncodeJSON 将对象编码为JSON消息
func (c *JSONCodec) EncodeJSON(id, opCode uint16, obj interface{}) (*packet.Message, error) {
	data, err := packet.JsonMarshal(obj)
	if err != nil {
		return nil, err
	}
	return packet.NewMessage(id, opCode, data), nil
}

// DecodeJSON 将JSON消息解码为对象
func (c *JSONCodec) DecodeJSON(message *packet.Message, obj interface{}) error {
	return packet.JsonUnmarshal(message.Payload, obj)
}

// ReadMessage 从缓冲区读取消息
func ReadMessage(buf *bytes.Buffer) (*packet.Message, error) {
	if buf.Len() < packet.HeaderSize {
		return nil, ErrIncompletePacket
	}

	// 解析消息头但不移动读取位置
	headerData := buf.Bytes()[:packet.HeaderSize]
	totalLen := binary.BigEndian.Uint32(headerData[0:4])

	if totalLen > packet.MaxMessageSize {
		return nil, ErrTooLargePacket
	}

	// 确保缓冲区内有完整的消息
	if buf.Len() < int(totalLen) {
		return nil, ErrIncompletePacket
	}

	// 读取完整消息
	msgData := make([]byte, totalLen)
	io.ReadFull(buf, msgData)

	return packet.Unmarshal(msgData)
}
