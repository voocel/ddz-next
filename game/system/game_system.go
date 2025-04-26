package system

import (
	"errors"
	"sync"
	"time"

	"github.com/yourusername/go-ddz/game/component"
	"github.com/yourusername/go-ddz/game/entity"
	"github.com/yourusername/go-ddz/game/event"
	"github.com/yourusername/go-ddz/game/rule"
)

// 游戏事件类型
const (
	EventGameInit         = "game.init"          // 游戏初始化
	EventGameStart        = "game.start"         // 游戏开始
	EventGameEnd          = "game.end"           // 游戏结束
	EventDealCards        = "game.deal_cards"    // 发牌
	EventCallLandlord     = "game.call_landlord" // 叫地主
	EventPlayCards        = "game.play_cards"    // 出牌
	EventPlayerPass       = "game.player_pass"   // 玩家不出
	EventPlayerTimeout    = "game.timeout"       // 玩家超时
	EventRoundEnd         = "game.round_end"     // 一轮结束
	EventShowCards        = "game.show_cards"    // 明牌
	EventGiveUp           = "game.give_up"       // 放弃游戏
	EventPlayerDisconnect = "game.disconnect"    // 玩家断线
)

// 游戏阶段
type GameStage int

const (
	GameStageInit         GameStage = iota // 初始化阶段
	GameStageDealCards                     // 发牌阶段
	GameStageCallLandlord                  // 叫地主阶段
	GameStagePlay                          // 出牌阶段
	GameStageSettlement                    // 结算阶段
	GameStageEnd                           // 结束阶段
)

// CallScoreEvent 叫分事件
type CallScoreEvent struct {
	*event.BaseEvent
	PlayerID int64
	Score    int
}

// PlayCardsEvent 出牌事件
type PlayCardsEvent struct {
	*event.BaseEvent
	PlayerID int64
	Cards    []component.Card
}

// PassEvent 不出事件
type PassEvent struct {
	*event.BaseEvent
	PlayerID int64
}

// GameOverEvent 游戏结束事件
type GameOverEvent struct {
	*event.BaseEvent
	WinnerID      int64
	IsLandlordWin bool
	Score         int
}

// GameSystem 游戏系统
type GameSystem struct {
	BaseSystem
	roomID        string           // 房间ID
	stage         GameStage        // 当前游戏阶段
	players       []entity.Entity  // 玩家列表
	currentPlayer int              // 当前玩家索引
	landlordIndex int              // 地主玩家索引
	baseScore     int              // 基础分数
	multiple      int              // 倍数
	startTime     time.Time        // 游戏开始时间
	roundTimeout  time.Duration    // 回合超时时间
	lastPlayTime  time.Time        // 上次出牌时间
	lastCards     *rule.CardCombo  // 上次出的牌
	isFirstPlay   bool             // 是否首次出牌
	cardEngine    *rule.CardEngine // 牌型引擎
	eventBus      *event.EventBus  // 事件总线
	mu            sync.RWMutex     // 读写锁
}

// NewGameSystem 创建新的游戏系统
func NewGameSystem(roomID string, baseScore int, eventBus *event.EventBus) *GameSystem {
	return &GameSystem{
		BaseSystem:   *NewBaseSystem(),
		roomID:       roomID,
		stage:        GameStageInit,
		players:      make([]entity.Entity, 0, 3),
		baseScore:    baseScore,
		multiple:     1,
		roundTimeout: 30 * time.Second,
		cardEngine:   rule.NewCardEngine(),
		eventBus:     eventBus,
	}
}

// AddPlayer 添加玩家
func (s *GameSystem) AddPlayer(player entity.Entity) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查玩家是否已经在游戏中
	for _, p := range s.players {
		if p.GetID() == player.GetID() {
			return
		}
	}

	// 添加玩家
	s.players = append(s.players, player)
	s.AddEntity(player)
}

// RemovePlayer 移除玩家
func (s *GameSystem) RemovePlayer(playerID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 查找玩家索引
	index := -1
	for i, player := range s.players {
		if player.GetID() == playerID {
			index = i
			break
		}
	}

	// 如果找不到玩家，直接返回
	if index < 0 {
		return
	}

	// 移除玩家
	s.players = append(s.players[:index], s.players[index+1:]...)
	s.RemoveEntity(playerID)

	// 如果游戏正在进行中，则触发玩家断线事件
	if s.stage > GameStageInit && s.stage < GameStageEnd {
		s.eventBus.Publish(event.NewBaseEvent(EventPlayerDisconnect, map[string]interface{}{
			"roomID":   s.roomID,
			"playerID": playerID,
		}))
	}
}

// StartGame 开始游戏
func (s *GameSystem) StartGame() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查玩家数量
	if len(s.players) != 3 {
		return false
	}

	// 重置游戏状态
	s.stage = GameStageDealCards
	s.multiple = 1
	s.currentPlayer = 0
	s.landlordIndex = -1
	s.lastCards = nil
	s.isFirstPlay = true
	s.startTime = time.Now()

	// 初始化玩家牌组件
	for _, player := range s.players {
		cardComp := component.NewPlayerCardComponent()
		player.AddComponent("PlayerCard", cardComp)

		// 初始化玩家游戏状态
		gameStateComp := component.NewPlayerGameStateComponent()
		player.AddComponent("GameState", gameStateComp)
	}

	// 发牌
	s.dealCards()

	// 触发游戏开始事件
	s.eventBus.Publish(event.NewBaseEvent(EventGameStart, map[string]interface{}{
		"roomID":    s.roomID,
		"startTime": s.startTime,
		"players":   s.getPlayerIDs(),
	}))

	return true
}

// EndGame 结束游戏
func (s *GameSystem) EndGame() {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查游戏是否已经结束
	if s.stage == GameStageEnd {
		return
	}

	// 设置游戏阶段为结束
	s.stage = GameStageEnd

	// 重置玩家状态
	for _, player := range s.players {
		// 清理玩家牌组件
		if player.HasComponent("PlayerCard") {
			player.RemoveComponent("PlayerCard")
		}

		// 清理玩家游戏状态组件
		if player.HasComponent("GameState") {
			player.RemoveComponent("GameState")
		}
	}

	// 触发游戏结束事件
	s.eventBus.Publish(event.NewBaseEvent(EventGameEnd, map[string]interface{}{
		"roomID":  s.roomID,
		"endTime": time.Now(),
		"players": s.getPlayerIDs(),
	}))
}

// dealCards 发牌
func (s *GameSystem) dealCards() {
	// 使用牌型引擎生成随机牌
	playerCards, landlordCards := s.cardEngine.DealCards()

	// 分配给玩家
	for i, player := range s.players {
		cardComp, err := GetPlayerCardComponent(player)
		if err == nil {
			cardComp.SetCards(playerCards[i])
		}
	}

	// 设置地主牌
	s.cardEngine.SetLandlordCards(landlordCards)

	// 触发发牌事件
	s.eventBus.Publish(event.NewBaseEvent(EventDealCards, map[string]interface{}{
		"roomID":        s.roomID,
		"landlordCards": landlordCards,
	}))

	// 切换到叫地主阶段
	s.stage = GameStageCallLandlord

	// 随机选择第一个叫地主的玩家
	s.currentPlayer = time.Now().Nanosecond() % 3
	s.lastPlayTime = time.Now()

	// 触发叫地主事件
	s.eventBus.Publish(event.NewBaseEvent(EventCallLandlord, map[string]interface{}{
		"roomID":        s.roomID,
		"playerID":      s.players[s.currentPlayer].GetID(),
		"timeout":       s.roundTimeout,
		"landlordCards": landlordCards,
	}))
}

// CallLandlord 叫地主
func (s *GameSystem) CallLandlord(playerID int64, score int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查游戏阶段
	if s.stage != GameStageCallLandlord {
		return errors.New("当前不是叫地主阶段")
	}

	// 检查是否轮到该玩家
	if s.players[s.currentPlayer].GetID() != playerID {
		return errors.New("不是该玩家的回合")
	}

	// 检查分数是否有效
	if score < 0 || score > 3 {
		return errors.New("无效的叫分")
	}

	// 获取玩家游戏状态
	stateComp, err := GetPlayerGameStateComponent(s.players[s.currentPlayer])
	if err != nil {
		return err
	}

	// 记录叫分
	stateComp.CallScore = score

	// 如果叫3分，直接成为地主
	if score == 3 {
		s.setLandlord(s.currentPlayer)
		return nil
	}

	// 移动到下一个玩家
	nextPlayer := (s.currentPlayer + 1) % 3
	callCount := 1

	// 查找下一个未叫分的玩家
	for callCount < 3 {
		nextStateComp, err := GetPlayerGameStateComponent(s.players[nextPlayer])
		if err != nil {
			nextPlayer = (nextPlayer + 1) % 3
			callCount++
			continue
		}

		// 如果下一个玩家已经叫过分，并且当前玩家的分数小于等于下一个玩家的分数，跳过
		if nextStateComp.CallScore >= 0 && score <= nextStateComp.CallScore {
			// 如果所有玩家都叫过分了，找出叫分最高的作为地主
			if callCount == 2 {
				s.determineLandlord()
				return nil
			}

			nextPlayer = (nextPlayer + 1) % 3
			callCount++
			continue
		}

		// 找到下一个可以叫分的玩家
		break
	}

	// 如果所有玩家都叫过分了，找出叫分最高的作为地主
	if callCount == 3 {
		s.determineLandlord()
		return nil
	}

	// 更新当前玩家
	s.currentPlayer = nextPlayer
	s.lastPlayTime = time.Now()

	// 触发叫地主事件
	s.eventBus.Publish(event.NewBaseEvent(EventCallLandlord, map[string]interface{}{
		"roomID":        s.roomID,
		"playerID":      s.players[s.currentPlayer].GetID(),
		"timeout":       s.roundTimeout,
		"landlordCards": s.cardEngine.GetLandlordCards(),
	}))

	return nil
}

// determineLandlord 确定地主
func (s *GameSystem) determineLandlord() {
	// 查找叫分最高的玩家
	maxScore := -1
	maxIndex := -1

	for i, player := range s.players {
		stateComp, err := GetPlayerGameStateComponent(player)
		if err != nil {
			continue
		}

		if stateComp.CallScore > maxScore {
			maxScore = stateComp.CallScore
			maxIndex = i
		}
	}

	// 如果没有人叫分或平局，随机选择一个玩家作为地主
	if maxIndex == -1 || maxScore == 0 {
		maxIndex = time.Now().Nanosecond() % 3
	}

	// 设置地主
	s.setLandlord(maxIndex)
}

// setLandlord 设置地主
func (s *GameSystem) setLandlord(index int) {
	// 更新地主索引
	s.landlordIndex = index

	// 获取地主玩家
	landlord := s.players[index]
	landlordID := landlord.GetID()

	// 获取地主牌组件
	cardComp, err := GetPlayerCardComponent(landlord)
	if err != nil {
		return // 处理错误，不能设置地主
	}

	// 将地主牌加入地主的牌中
	landlordCards := s.cardEngine.GetLandlordCards()
	cardComp.AddCards(landlordCards)

	// 更新玩家身份
	for i, player := range s.players {
		stateComp, err := GetPlayerGameStateComponent(player)
		if err != nil {
			continue
		}

		if i == index {
			stateComp.Role = component.RoleLandlord
		} else {
			stateComp.Role = component.RoleFarmer
		}
	}

	// 切换到出牌阶段
	s.stage = GameStagePlay
	s.currentPlayer = index
	s.lastPlayTime = time.Now()
	s.isFirstPlay = true

	// 触发出牌事件
	s.eventBus.Publish(event.NewBaseEvent(EventPlayCards, map[string]interface{}{
		"roomID":        s.roomID,
		"playerID":      landlordID,
		"timeout":       s.roundTimeout,
		"isFirstPlay":   true,
		"landlordID":    landlordID,
		"landlordCards": landlordCards,
	}))
}

// PlayCards 出牌
func (s *GameSystem) PlayCards(playerID int64, cardIndices []int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查游戏阶段
	if s.stage != GameStagePlay {
		return errors.New("当前不是出牌阶段")
	}

	// 检查是否轮到该玩家
	if s.players[s.currentPlayer].GetID() != playerID {
		return errors.New("不是该玩家的回合")
	}

	// 获取玩家牌组件
	cardComp, err := GetPlayerCardComponent(s.players[s.currentPlayer])
	if err != nil {
		return err
	}

	// 如果传入的是空数组，表示不出牌
	if len(cardIndices) == 0 {
		// 首次出牌不能不出
		if s.isFirstPlay {
			return errors.New("首次出牌不能不出")
		}

		return s.playerPass(playerID)
	}

	// 获取要出的牌
	cards, err := cardComp.GetCardsByIndices(cardIndices)
	if err != nil {
		return err
	}

	// 检查牌型是否合法
	combo, err := s.cardEngine.ValidateCardCombo(cards)
	if err != nil {
		return err
	}

	// 如果不是首次出牌，需要检查是否能够打过上家的牌
	if !s.isFirstPlay && s.lastCards != nil {
		// 检查是否能够打过上家的牌
		canBeat, err := s.cardEngine.CanBeat(s.lastCards, combo)
		if err != nil {
			return err
		}

		if !canBeat {
			return errors.New("无法打过上家的牌")
		}
	}

	// 出牌
	if err := cardComp.PlayCards(cardIndices); err != nil {
		return err
	}

	// 更新游戏状态
	s.lastCards = combo
	s.isFirstPlay = false
	s.lastPlayTime = time.Now()

	// 检查玩家是否已经出完牌
	if cardComp.GetCardCount() == 0 {
		// 游戏结束，当前玩家胜利
		return s.gameOver(s.currentPlayer)
	}

	// 移动到下一个玩家
	s.moveToNextPlayer()

	return nil
}

// playerPass 不出牌
func (s *GameSystem) playerPass(playerID int64) error {
	// 触发玩家不出事件
	s.eventBus.Publish(event.NewBaseEvent(EventPlayerPass, map[string]interface{}{
		"roomID":   s.roomID,
		"playerID": playerID,
	}))

	// 移动到下一个玩家
	nextIndex := (s.currentPlayer + 1) % 3

	// 如果下一个玩家就是出上一手牌的玩家，则这一轮结束，开始新的一轮
	if nextIndex == s.getLastPlayerIndex() {
		// 触发一轮结束事件
		s.eventBus.Publish(event.NewBaseEvent(EventRoundEnd, map[string]interface{}{
			"roomID":   s.roomID,
			"playerID": s.players[nextIndex].GetID(),
		}))

		// 开始新的一轮
		s.isFirstPlay = true
		s.lastCards = nil
	}

	// 移动到下一个玩家
	s.moveToNextPlayer()

	return nil
}

// getLastPlayerIndex 获取上一手牌的玩家索引
func (s *GameSystem) getLastPlayerIndex() int {
	if s.isFirstPlay {
		return s.currentPlayer
	}

	for i := 0; i < 3; i++ {
		index := (s.currentPlayer - i - 1 + 3) % 3

		// 如果找到了非空的上家牌，说明这个玩家是上一个出牌的
		if index != s.currentPlayer {
			return index
		}
	}

	return s.currentPlayer
}

// moveToNextPlayer 移动到下一个玩家
func (s *GameSystem) moveToNextPlayer() {
	// 更新当前玩家
	s.currentPlayer = (s.currentPlayer + 1) % 3
	s.lastPlayTime = time.Now()

	// 触发出牌事件
	s.eventBus.Publish(event.NewBaseEvent(EventPlayCards, map[string]interface{}{
		"roomID":      s.roomID,
		"playerID":    s.players[s.currentPlayer].GetID(),
		"timeout":     s.roundTimeout,
		"isFirstPlay": s.isFirstPlay,
		"lastCards":   s.lastCards,
	}))
}

// gameOver 游戏结束
func (s *GameSystem) gameOver(winnerIndex int) error {
	// 获取赢家身份
	stateComp, err := GetPlayerGameStateComponent(s.players[winnerIndex])
	if err != nil {
		return err
	}
	isLandlordWin := stateComp.Role == component.RoleLandlord

	// 计算倍数和分数
	s.calculateScores(isLandlordWin)

	// 切换到结算阶段
	s.stage = GameStageSettlement

	// 触发游戏结束事件
	s.eventBus.Publish(event.NewBaseEvent(EventGameEnd, map[string]interface{}{
		"roomID":        s.roomID,
		"winnerID":      s.players[winnerIndex].GetID(),
		"isLandlordWin": isLandlordWin,
		"multiple":      s.multiple,
		"scores":        s.getPlayerScores(),
	}))

	return nil
}

// calculateScores 计算分数
func (s *GameSystem) calculateScores(isLandlordWin bool) {
	// 基础分 x 倍数
	baseScore := s.baseScore * s.multiple

	// 根据胜利方计算每个玩家的得分
	for _, player := range s.players {
		stateComp, err := GetPlayerGameStateComponent(player)
		if err != nil {
			continue
		}

		if stateComp.Role == component.RoleLandlord {
			if isLandlordWin {
				// 地主胜利，获得2倍分数
				stateComp.Score = 2 * baseScore
			} else {
				// 地主失败，扣除2倍分数
				stateComp.Score = -2 * baseScore
			}
		} else {
			if isLandlordWin {
				// 农民失败，扣除分数
				stateComp.Score = -baseScore
			} else {
				// 农民胜利，获得分数
				stateComp.Score = baseScore
			}
		}
	}
}

// GetStage 获取当前游戏阶段
func (s *GameSystem) GetStage() GameStage {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.stage
}

// GetCurrentPlayerID 获取当前玩家ID
func (s *GameSystem) GetCurrentPlayerID() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.currentPlayer < 0 || s.currentPlayer >= len(s.players) {
		return 0
	}

	return s.players[s.currentPlayer].GetID()
}

// GetLandlordID 获取地主玩家ID
func (s *GameSystem) GetLandlordID() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.landlordIndex < 0 || s.landlordIndex >= len(s.players) {
		return 0
	}

	return s.players[s.landlordIndex].GetID()
}

// getPlayerIDs 获取所有玩家ID
func (s *GameSystem) getPlayerIDs() []int64 {
	ids := make([]int64, len(s.players))

	for i, player := range s.players {
		ids[i] = player.GetID()
	}

	return ids
}

// getPlayerScores 获取所有玩家分数
func (s *GameSystem) getPlayerScores() map[int64]int {
	scores := make(map[int64]int)

	for _, player := range s.players {
		stateComp, err := GetPlayerGameStateComponent(player)
		if err != nil {
			continue
		}
		scores[player.GetID()] = stateComp.Score
	}

	return scores
}

// Update 更新游戏系统
func (s *GameSystem) Update(dt float32) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 如果游戏未处于活动状态，不进行更新
	if s.stage <= GameStageInit || s.stage >= GameStageEnd {
		return
	}

	// 更新游戏逻辑，处理超时
	now := time.Now()

	// 处理玩家超时
	if s.stage == GameStageCallLandlord || s.stage == GameStagePlay {
		// 检查当前玩家是否超时
		if s.currentPlayer >= 0 && s.currentPlayer < len(s.players) && now.Sub(s.lastPlayTime) > s.roundTimeout {
			// 发布超时事件
			s.eventBus.Publish(event.NewBaseEvent(EventPlayerTimeout, map[string]interface{}{
				"roomID":   s.roomID,
				"playerID": s.players[s.currentPlayer].GetID(),
				"stage":    s.stage,
			}))

			// 根据当前阶段执行默认操作
			if s.stage == GameStageCallLandlord {
				// 默认不叫地主
				s.CallLandlord(s.players[s.currentPlayer].GetID(), 0)
			} else if s.stage == GameStagePlay {
				// 默认不出牌
				s.playerPass(s.players[s.currentPlayer].GetID())
			}

			// 更新最后操作时间
			s.lastPlayTime = now
		}
	}

	// 检查游戏是否已结束（比如所有玩家都断线）
	activePlayers := 0
	for _, player := range s.players {
		_, err := GetPlayerGameStateComponent(player)
		if err == nil && !isPlayerDisconnected(player) {
			activePlayers++
		}
	}

	// 如果只剩一个活跃玩家，结束游戏
	if activePlayers <= 1 && s.stage > GameStageInit && s.stage < GameStageEnd {
		// 找出剩余的玩家
		var winnerIndex int = -1
		for i, player := range s.players {
			_, err := GetPlayerGameStateComponent(player)
			if err == nil && !isPlayerDisconnected(player) {
				winnerIndex = i
				break
			}
		}

		// 结束游戏
		if winnerIndex >= 0 {
			s.gameOver(winnerIndex)
		} else {
			// 所有玩家都断线，强制结束游戏
			s.stage = GameStageEnd
		}
	}
}

// isPlayerDisconnected 检查玩家是否断线
func isPlayerDisconnected(player entity.Entity) bool {
	// 通过检查玩家最后活动时间或其他标志判断是否断线
	// 这里仅供示例，实际逻辑需要根据你的会话管理系统来实现

	// 检查玩家是否有断线标记组件
	if comp := player.GetComponent("Disconnect"); comp != nil {
		return true
	}

	return false
}
