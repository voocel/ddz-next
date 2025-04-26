package websocket

// 错误码常量
const (
	// 成功
	CodeSuccess = 0

	// 客户端通用错误 (400-499)
	CodeBadRequest       = 400 // 参数错误
	CodeUnauthorized     = 401 // 未授权
	CodeForbidden        = 403 // 操作被拒绝
	CodeNotFound         = 404 // 资源不存在
	CodeMethodNotAllowed = 405 // 方法不允许
	CodeTimeout          = 408 // 超时
	CodeConflict         = 409 // 冲突

	// 服务器错误 (500-599)
	CodeInternalServerError = 500 // 服务器内部错误
	CodeServiceUnavailable  = 503 // 服务不可用
	CodeDatabaseError       = 510 // 数据库错误

	// 游戏业务错误 (1000-1999)
	CodeRoomFull           = 1000 // 房间已满
	CodeRoomNotFound       = 1001 // 房间不存在
	CodeRoomStatusError    = 1002 // 房间状态错误
	CodePlayerNotInRoom    = 1003 // 玩家不在房间中
	CodePlayerAlreadyReady = 1004 // 玩家已准备
	CodeNotYourTurn        = 1005 // 不是你的回合
	CodeInvalidCardPlay    = 1006 // 无效的出牌
	CodeGameNotStarted     = 1007 // 游戏未开始
	CodeGameAlreadyStarted = 1008 // 游戏已开始
	CodeNotEnoughPlayers   = 1009 // 玩家不足
)

// 错误消息映射
var errorMessages = map[int]string{
	CodeSuccess:             "成功",
	CodeBadRequest:          "参数错误",
	CodeUnauthorized:        "未授权",
	CodeForbidden:           "操作被拒绝",
	CodeNotFound:            "资源不存在",
	CodeMethodNotAllowed:    "方法不允许",
	CodeTimeout:             "超时",
	CodeConflict:            "冲突",
	CodeInternalServerError: "服务器内部错误",
	CodeServiceUnavailable:  "服务不可用",
	CodeDatabaseError:       "数据库错误",
	CodeRoomFull:            "房间已满",
	CodeRoomNotFound:        "房间不存在",
	CodeRoomStatusError:     "房间状态错误",
	CodePlayerNotInRoom:     "玩家不在房间中",
	CodePlayerAlreadyReady:  "玩家已准备",
	CodeNotYourTurn:         "不是你的回合",
	CodeInvalidCardPlay:     "无效的出牌",
	CodeGameNotStarted:      "游戏未开始",
	CodeGameAlreadyStarted:  "游戏已开始",
	CodeNotEnoughPlayers:    "玩家不足",
}

// GetErrorMessage 根据错误码获取错误消息
func GetErrorMessage(code int) string {
	if msg, ok := errorMessages[code]; ok {
		return msg
	}
	return "未知错误"
}
