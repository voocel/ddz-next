package websocket

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrCodeInternal 内部服务器错误码
const ErrCodeInternal = CodeInternalServerError

// NewClientMessage 创建客户端请求消息
func NewClientMessage(cmd string, param interface{}) (*Message, error) {
	var rawParam json.RawMessage
	var err error

	if p, ok := param.(json.RawMessage); ok {
		rawParam = p
	} else {
		rawParam, err = json.Marshal(param)
		if err != nil {
			return nil, fmt.Errorf("序列化参数失败: %w", err)
		}
	}

	return &Message{
		ID:        uuid.New().String(),
		Cmd:       cmd,
		Param:     rawParam,
		Timestamp: time.Now().Unix(),
	}, nil
}

// NewServerPush 创建服务器推送消息
func NewServerPush(msgType string, result interface{}) (*Message, error) {
	var rawResult json.RawMessage
	var err error

	if r, ok := result.(json.RawMessage); ok {
		rawResult = r
	} else {
		rawResult, err = json.Marshal(result)
		if err != nil {
			return nil, fmt.Errorf("序列化结果失败: %w", err)
		}
	}

	return &Message{
		ID:        uuid.New().String(),
		Type:      msgType,
		Result:    rawResult,
		Timestamp: time.Now().Unix(),
	}, nil
}

// NewServerPushOrEmpty 创建服务器推送消息，出错时返回空数据而不是错误
func NewServerPushOrEmpty(msgType string, result interface{}) *Message {
	msg, err := NewServerPush(msgType, result)
	if err != nil {
		return &Message{
			ID:        uuid.New().String(),
			Type:      msgType,
			Result:    json.RawMessage(`{}`),
			Timestamp: time.Now().Unix(),
		}
	}
	return msg
}

// NewErrorResponse 创建错误响应消息
func NewErrorResponse(code int, message string) *Message {
	return &Message{
		ID:        uuid.New().String(),
		Code:      code,
		Message:   message,
		Timestamp: time.Now().Unix(),
	}
}

// NewErrorResponseWithData 创建带有数据的错误响应
func NewErrorResponseWithData(code int, message string, data interface{}) (*Message, error) {
	var rawResult json.RawMessage
	var err error

	if r, ok := data.(json.RawMessage); ok {
		rawResult = r
	} else {
		rawResult, err = json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("序列化数据失败: %w", err)
		}
	}

	return &Message{
		ID:        uuid.New().String(),
		Code:      code,
		Message:   message,
		Result:    rawResult,
		Timestamp: time.Now().Unix(),
	}, nil
}

// NewErrorResponseWithCode 创建带有错误码的错误响应消息
func NewErrorResponseWithCode(id string, cmd string, errCode int) *Message {
	return &Message{
		ID:        id,
		Cmd:       cmd,
		Code:      errCode,
		Message:   GetErrorMessage(errCode),
		Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
	}
}

// ParseParam 解析消息参数到指定结构
func (m *Message) ParseParam(v interface{}) error {
	if len(m.Param) == 0 {
		return fmt.Errorf("消息参数为空")
	}
	return json.Unmarshal(m.Param, v)
}

// ParseResult 解析消息结果到指定结构
func (m *Message) ParseResult(v interface{}) error {
	if len(m.Result) == 0 {
		return fmt.Errorf("消息结果为空")
	}
	return json.Unmarshal(m.Result, v)
}
