package system

import (
	"errors"
	"fmt"

	"github.com/yourusername/go-ddz/game/component"
	"github.com/yourusername/go-ddz/game/entity"
)

// 常见错误
var (
	ErrComponentNotFound   = errors.New("组件不存在")
	ErrInvalidComponent    = errors.New("组件类型无效")
	ErrInvalidPlayer       = errors.New("无效的玩家")
	ErrInvalidRoom         = errors.New("无效的房间")
	ErrPlayerNotInRoom     = errors.New("玩家不在房间中")
	ErrRoomIsFull          = errors.New("房间已满")
	ErrRoomNotFound        = errors.New("房间不存在")
	ErrNotRoomOwner        = errors.New("不是房主")
	ErrGameAlreadyStarted  = errors.New("游戏已经开始")
	ErrGameNotStarted      = errors.New("游戏未开始")
	ErrOperationNotAllowed = errors.New("操作不允许")
)

// GetRoomComponent 安全获取房间组件
func GetRoomComponent(e entity.Entity) (*component.RoomComponent, error) {
	if e == nil {
		return nil, ErrInvalidRoom
	}

	comp := e.GetComponent("Room")
	if comp == nil {
		return nil, ErrComponentNotFound
	}

	roomComp, ok := comp.(*component.RoomComponent)
	if !ok {
		return nil, ErrInvalidComponent
	}

	return roomComp, nil
}

// GetPlayerComponent 安全获取玩家组件
func GetPlayerComponent(e entity.Entity) (*component.PlayerComponent, error) {
	if e == nil {
		return nil, ErrInvalidPlayer
	}

	comp := e.GetComponent("Player")
	if comp == nil {
		return nil, ErrComponentNotFound
	}

	playerComp, ok := comp.(*component.PlayerComponent)
	if !ok {
		return nil, ErrInvalidComponent
	}

	return playerComp, nil
}

// GetPlayerCardComponent 安全获取玩家卡牌组件
func GetPlayerCardComponent(e entity.Entity) (*component.PlayerCardComponent, error) {
	if e == nil {
		return nil, ErrInvalidPlayer
	}

	comp := e.GetComponent("PlayerCard")
	if comp == nil {
		return nil, ErrComponentNotFound
	}

	cardComp, ok := comp.(*component.PlayerCardComponent)
	if !ok {
		return nil, ErrInvalidComponent
	}

	return cardComp, nil
}

// GetPlayerGameStateComponent 安全获取玩家游戏状态组件
func GetPlayerGameStateComponent(e entity.Entity) (*component.PlayerGameStateComponent, error) {
	if e == nil {
		return nil, ErrInvalidPlayer
	}

	comp := e.GetComponent("GameState")
	if comp == nil {
		return nil, ErrComponentNotFound
	}

	stateComp, ok := comp.(*component.PlayerGameStateComponent)
	if !ok {
		return nil, ErrInvalidComponent
	}

	return stateComp, nil
}

// GenerateRoomID 生成房间ID
func GenerateRoomID(seed int) string {
	return fmt.Sprintf("R%06d", seed)
}
