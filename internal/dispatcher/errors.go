package dispatcher

import (
	"errors"
	"fmt"
)

// 预定义错误码
const (
	ErrCodeUnknown          = 1000 // 未知错误
	ErrCodeInvalidMessage   = 1001 // 无效消息
	ErrCodeInvalidHandler   = 1002 // 无效处理器
	ErrCodeInvalidSession   = 1003 // 无效会话
	ErrCodeNotImplemented   = 1004 // 未实现
	ErrCodeInternalError    = 1005 // 内部错误
	ErrCodeInvalidRequest   = 1006 // 无效请求
	ErrCodeInvalidOperation = 1007 // 无效操作
)

// 预定义错误
var (
	ErrInvalidMessage  = errors.New("无效消息")
	ErrRouteNotFound   = errors.New("路由未找到")
	ErrInvalidSession  = errors.New("无效会话")
	ErrSessionClosed   = errors.New("会话已关闭")
	ErrHandlerNotFound = errors.New("处理器未找到")
)

// ErrorResponseData 错误响应数据
type ErrorResponseData struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Error 定义自定义错误类型
type Error struct {
	Code    int
	Message string
}

// Error 实现error接口
func (e *Error) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

// NewError 创建新的错误
func NewError(code int, message string) *Error {
	return &Error{
		Code:    code,
		Message: message,
	}
}

// NewErrorResponseData 创建新的错误响应数据
func NewErrorResponseData(code int, message string) *ErrorResponseData {
	return &ErrorResponseData{
		Code:    code,
		Message: message,
	}
}

// NewErrorResponseMsg 创建错误响应消息
func NewErrorResponseMsg(requestID string, route string, code int, message string) *Message {
	errResp := NewErrorResponseData(code, message)

	resp := NewResponse(requestID, route, errResp)
	resp.Error = message
	return resp
}
