package websocket

import (
	"log"
	"sync"
)

// GameEventBroadcaster 游戏事件广播器
type GameEventBroadcaster struct {
	roomBroadcaster *RoomBroadcaster
}

// PlayerInfo 玩家信息
type PlayerInfo struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	Avatar   string `json:"avatar,omitempty"`
	Ready    bool   `json:"ready"`
	Position int    `json:"position,omitempty"`
	Cards    int    `json:"cards,omitempty"` // 剩余卡牌数量
}

// Card 卡牌
type Card struct {
	Suit  int `json:"suit"`  // 花色：0-黑桃，1-红桃，2-梅花，3-方块，4-王
	Value int `json:"value"` // 点数：3-10，J(11)，Q(12)，K(13)，A(14)，2(15)，小王(16)，大王(17)
}

// NewGameEventBroadcaster 创建新的游戏事件广播器
func NewGameEventBroadcaster() *GameEventBroadcaster {
	return &GameEventBroadcaster{
		roomBroadcaster: GetRoomBroadcaster(),
	}
}

// BroadcastGameStart 广播游戏开始事件
func (b *GameEventBroadcaster) BroadcastGameStart(roomID string, gameNumber int, players []PlayerInfo, bottomCards []Card) {
	data := map[string]interface{}{
		"room_id":      roomID,
		"game_number":  gameNumber,
		"players":      players,
		"bottom_cards": bottomCards,
	}

	message := NewServerPushOrEmpty(TypeDeal, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播游戏开始事件 - 房间: %s, 游戏局数: %d", roomID, gameNumber)
}

// BroadcastGameEnd 广播游戏结束事件
func (b *GameEventBroadcaster) BroadcastGameEnd(roomID string, winnerID int64, isLandlordWin bool, score int, playerScores map[int64]int) {
	data := map[string]interface{}{
		"room_id":         roomID,
		"winner_id":       winnerID,
		"is_landlord_win": isLandlordWin,
		"score":           score,
		"player_scores":   playerScores,
	}

	message := NewServerPushOrEmpty(TypeEnd, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播游戏结束事件 - 房间: %s, 胜者ID: %d", roomID, winnerID)
}

// BroadcastPlayerJoin 广播玩家加入事件
func (b *GameEventBroadcaster) BroadcastPlayerJoin(roomID string, player PlayerInfo) {
	data := map[string]interface{}{
		"room_id": roomID,
		"player":  player,
	}

	message := NewServerPushOrEmpty(TypePlayerInfo, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播玩家加入事件 - 房间: %s, 玩家ID: %d", roomID, player.UserID)
}

// BroadcastPlayerLeave 广播玩家离开事件
func (b *GameEventBroadcaster) BroadcastPlayerLeave(roomID string, userID int64) {
	data := map[string]interface{}{
		"room_id": roomID,
		"user_id": userID,
	}

	message := NewServerPushOrEmpty(TypePlayerInfo, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播玩家离开事件 - 房间: %s, 玩家ID: %d", roomID, userID)
}

// BroadcastPlayerReady 广播玩家准备事件
func (b *GameEventBroadcaster) BroadcastPlayerReady(roomID string, userID int64, ready bool) {
	data := map[string]interface{}{
		"room_id": roomID,
		"user_id": userID,
		"ready":   ready,
	}

	message := NewServerPushOrEmpty(TypeReady, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播玩家准备事件 - 房间: %s, 玩家ID: %d, 准备状态: %v", roomID, userID, ready)
}

// BroadcastPlayerTurn 广播玩家回合事件
func (b *GameEventBroadcaster) BroadcastPlayerTurn(roomID string, userID int64, isFirstPlay bool, timeoutSeconds int, lastCards *[]Card) {
	data := map[string]interface{}{
		"room_id":       roomID,
		"user_id":       userID,
		"is_first_play": isFirstPlay,
		"timeout":       timeoutSeconds,
	}

	if lastCards != nil {
		data["last_cards"] = *lastCards
	}

	message := NewServerPushOrEmpty(TypeIsCanPlay, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播玩家回合事件 - 房间: %s, 玩家ID: %d", roomID, userID)
}

// BroadcastPlayerPlayed 广播玩家出牌事件
func (b *GameEventBroadcaster) BroadcastPlayerPlayed(roomID string, userID int64, cards []Card, remainingCards int) {
	data := map[string]interface{}{
		"room_id":         roomID,
		"user_id":         userID,
		"cards":           cards,
		"remaining_cards": remainingCards,
	}

	message := NewServerPushOrEmpty(TypePlay, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播玩家出牌事件 - 房间: %s, 玩家ID: %d, 牌数: %d", roomID, userID, len(cards))
}

// BroadcastPlayerPass 广播玩家过牌事件
func (b *GameEventBroadcaster) BroadcastPlayerPass(roomID string, userID int64) {
	data := map[string]interface{}{
		"room_id": roomID,
		"user_id": userID,
	}

	message := NewServerPushOrEmpty(TypePass, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播玩家过牌事件 - 房间: %s, 玩家ID: %d", roomID, userID)
}

// BroadcastCallScore 广播叫分事件
func (b *GameEventBroadcaster) BroadcastCallScore(roomID string, userID int64, score int, currentMaxScore int) {
	data := map[string]interface{}{
		"room_id":           roomID,
		"user_id":           userID,
		"score":             score,
		"current_max_score": currentMaxScore,
	}

	message := NewServerPushOrEmpty(TypeCall, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播叫分事件 - 房间: %s, 玩家ID: %d, 分数: %d", roomID, userID, score)
}

// BroadcastLandlordAssign 广播指定地主事件
func (b *GameEventBroadcaster) BroadcastLandlordAssign(roomID string, landlordID int64, score int, bottomCards []Card) {
	data := map[string]interface{}{
		"room_id":      roomID,
		"landlord_id":  landlordID,
		"score":        score,
		"bottom_cards": bottomCards,
	}

	message := NewServerPushOrEmpty(TypeIsCanPlay, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播指定地主事件 - 房间: %s, 地主ID: %d, 分数: %d", roomID, landlordID, score)
}

// BroadcastRoomOwnerChange 广播房主变更事件
func (b *GameEventBroadcaster) BroadcastRoomOwnerChange(roomID string, ownerID int64) {
	data := map[string]interface{}{
		"room_id":  roomID,
		"owner_id": ownerID,
	}

	message := NewServerPushOrEmpty(TypeRoomInfo, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播房主变更事件 - 房间: %s, 新房主ID: %d", roomID, ownerID)
}

// BroadcastPlayerTrust 广播玩家托管状态变更事件
func (b *GameEventBroadcaster) BroadcastPlayerTrust(roomID string, userID int64, isTrust bool) {
	data := map[string]interface{}{
		"room_id":  roomID,
		"uid":      userID,
		"is_trust": boolToInt(isTrust),
	}

	message := NewServerPushOrEmpty(TypeTrust, data)
	b.roomBroadcaster.BroadcastToRoom(roomID, message)
	log.Printf("广播玩家托管状态事件 - 房间: %s, 玩家ID: %d, 托管状态: %v", roomID, userID, isTrust)
}

// boolToInt 将布尔值转换为整数
func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

// 全局单例
var (
	gameEventBroadcaster     *GameEventBroadcaster
	gameEventBroadcasterOnce sync.Once
)

// GetGameEventBroadcaster 获取全局游戏事件广播器
func GetGameEventBroadcaster() *GameEventBroadcaster {
	gameEventBroadcasterOnce.Do(func() {
		gameEventBroadcaster = NewGameEventBroadcaster()
	})
	return gameEventBroadcaster
}
