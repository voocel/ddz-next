package state

import (
	"time"

	"github.com/yourusername/go-ddz/game/component"
	"github.com/yourusername/go-ddz/game/entity"
	"github.com/yourusername/go-ddz/game/rule"
)

// 游戏状态上下文中的键名
const (
	KeyPlayers            = "players"
	KeyCurrentPlayerIndex = "currentPlayerIndex"
	KeyLastPlayedCards    = "lastPlayedCards"
	KeyLastPlayerIndex    = "lastPlayerIndex"
	KeyBottomCards        = "bottomCards"
	KeyCallScores         = "callScores"
	KeyLandlordIndex      = "landlordIndex"
	KeyGameRule           = "gameRule"
	KeyBaseScore          = "baseScore"
	KeyBombCount          = "bombCount"
	KeyStartTime          = "startTime"
	KeyPassCount          = "passCount"
)

// WaitingState 等待状态
type WaitingState struct {
	BaseState
}

// NewWaitingState 创建等待状态
func NewWaitingState() *WaitingState {
	return &WaitingState{
		BaseState: *NewBaseState("Waiting"),
	}
}

// Enter 进入等待状态
func (s *WaitingState) Enter(ctx Context) {
	// 重置游戏数据
	ctx.SetData(KeyCurrentPlayerIndex, 0)
	ctx.SetData(KeyLastPlayedCards, []component.Card{})
	ctx.SetData(KeyLastPlayerIndex, -1)
	ctx.SetData(KeyBottomCards, []component.Card{})
	ctx.SetData(KeyCallScores, []int{0, 0, 0})
	ctx.SetData(KeyLandlordIndex, -1)
	ctx.SetData(KeyBombCount, 0)
	ctx.SetData(KeyPassCount, 0)
}

// Update 更新等待状态
func (s *WaitingState) Update(ctx Context) {
	// 检查是否所有玩家都已准备好
	playersReady := true
	players := ctx.GetData(KeyPlayers).([]entity.Entity)

	for _, player := range players {
		playerComp := player.GetComponent("Player").(*component.PlayerComponent)
		if !playerComp.IsReady {
			playersReady = false
			break
		}
	}

	// 如果所有玩家都准备好了，进入发牌状态
	if playersReady && len(players) >= 3 {
		// 获取状态机并切换状态
		if stateMachine, ok := ctx.GetData("stateMachine").(*StateMachine); ok {
			stateMachine.ChangeState("Dealing")
		}
	}
}

// Exit 退出等待状态
func (s *WaitingState) Exit(ctx Context) {
	// 无需特殊处理
}

// DealingState 发牌状态
type DealingState struct {
	BaseState
}

// NewDealingState 创建发牌状态
func NewDealingState() *DealingState {
	return &DealingState{
		BaseState: *NewBaseState("Dealing"),
	}
}

// Enter 进入发牌状态
func (s *DealingState) Enter(ctx Context) {
	// 获取游戏规则引擎
	gameRule := ctx.GetData(KeyGameRule).(*rule.GameRule)

	// 获取玩家数量
	players := ctx.GetData(KeyPlayers).([]entity.Entity)
	playerCount := len(players)

	// 发牌
	playerCards, bottomCards, err := gameRule.DealCards(playerCount)
	if err != nil {
		// 发牌失败，返回等待状态
		if stateMachine, ok := ctx.GetData("stateMachine").(*StateMachine); ok {
			stateMachine.ChangeState("Waiting")
		}
		return
	}

	// 分发牌给玩家
	for i, player := range players {
		// 将卡牌添加到玩家的卡牌组件中
		cardComponent := player.GetComponent("Card").(*component.CardComponent)
		cardComponent.AddCards(playerCards[i])
		cardComponent.Sort() // 排序卡牌
	}

	// 保存底牌
	ctx.SetData(KeyBottomCards, bottomCards)

	// 进入叫分状态
	if stateMachine, ok := ctx.GetData("stateMachine").(*StateMachine); ok {
		stateMachine.ChangeState("Bidding")
	}
}

// Update 更新发牌状态
func (s *DealingState) Update(ctx Context) {
	// 发牌状态是一次性的，无需更新
}

// Exit 退出发牌状态
func (s *DealingState) Exit(ctx Context) {
	// 无需特殊处理
}

// BiddingState 叫分状态
type BiddingState struct {
	BaseState
	callTimeout time.Duration
}

// NewBiddingState 创建叫分状态
func NewBiddingState() *BiddingState {
	return &BiddingState{
		BaseState:   *NewBaseState("Bidding"),
		callTimeout: 15 * time.Second, // 默认15秒叫分时间
	}
}

// Enter 进入叫分状态
func (s *BiddingState) Enter(ctx Context) {
	// 设置当前玩家索引为随机值
	currentPlayerIndex := 0 // 可以是随机的，这里简化为从0开始
	ctx.SetData(KeyCurrentPlayerIndex, currentPlayerIndex)

	// 重置叫分记录
	playerCount := len(ctx.GetData(KeyPlayers).([]entity.Entity))
	callScores := make([]int, playerCount)
	ctx.SetData(KeyCallScores, callScores)

	// 设置开始时间
	ctx.SetData(KeyStartTime, time.Now())
}

// Update 更新叫分状态
func (s *BiddingState) Update(ctx Context) {
	// 检查叫分是否超时
	startTime := ctx.GetData(KeyStartTime).(time.Time)
	if time.Since(startTime) > s.callTimeout {
		// 超时自动不叫
		s.handleCallScore(ctx, 0)
	}

	// 检查是否所有玩家都已叫分
	callScores := ctx.GetData(KeyCallScores).([]int)
	allCalled := true
	for _, score := range callScores {
		if score < 0 { // -1表示尚未叫分
			allCalled = false
			break
		}
	}

	// 如果所有玩家都已叫分，确定地主并进入游戏阶段
	if allCalled {
		gameRule := ctx.GetData(KeyGameRule).(*rule.GameRule)
		landlordIndex := gameRule.DetermineLandlord(callScores)
		ctx.SetData(KeyLandlordIndex, landlordIndex)

		// 将底牌给地主
		players := ctx.GetData(KeyPlayers).([]entity.Entity)
		landlordEntity := players[landlordIndex]

		// 获取地主的游戏状态组件
		gameStateComp := landlordEntity.GetComponent("GameState").(*component.PlayerGameStateComponent)
		bottomCards := ctx.GetData(KeyBottomCards).([]component.Card)

		// 将底牌添加到地主的卡牌中
		cardComponent := landlordEntity.GetComponent("Card").(*component.CardComponent)
		cardComponent.AddCards(bottomCards)
		cardComponent.Sort() // 重新排序

		// 设置地主角色
		gameStateComp.SetRole(component.RoleLandlord)

		// 设置当前玩家为地主，开始出牌
		ctx.SetData(KeyCurrentPlayerIndex, landlordIndex)

		// 进入出牌阶段
		if stateMachine, ok := ctx.GetData("stateMachine").(*StateMachine); ok {
			stateMachine.ChangeState("Playing")
		}
	}
}

// handleCallScore 处理叫分
func (s *BiddingState) handleCallScore(ctx Context, score int) {
	currentPlayerIndex := ctx.GetData(KeyCurrentPlayerIndex).(int)
	callScores := ctx.GetData(KeyCallScores).([]int)

	// 获取当前最高分
	highestScore := 0
	for _, s := range callScores {
		if s > highestScore {
			highestScore = s
		}
	}

	// 验证叫分是否有效
	gameRule := ctx.GetData(KeyGameRule).(*rule.GameRule)
	if !gameRule.ValidateCallScore(score, highestScore) {
		// 无效叫分，默认为不叫
		score = 0
	}

	// 记录当前玩家的叫分
	callScores[currentPlayerIndex] = score
	ctx.SetData(KeyCallScores, callScores)

	// 移动到下一个玩家
	playerCount := len(ctx.GetData(KeyPlayers).([]entity.Entity))
	nextPlayerIndex := (currentPlayerIndex + 1) % playerCount
	ctx.SetData(KeyCurrentPlayerIndex, nextPlayerIndex)

	// 重置计时器
	ctx.SetData(KeyStartTime, time.Now())
}

// Exit 退出叫分状态
func (s *BiddingState) Exit(ctx Context) {
	// 无需特殊处理
}

// PlayingState 出牌状态
type PlayingState struct {
	BaseState
	playTimeout time.Duration
}

// NewPlayingState 创建出牌状态
func NewPlayingState() *PlayingState {
	return &PlayingState{
		BaseState:   *NewBaseState("Playing"),
		playTimeout: 30 * time.Second, // 默认30秒出牌时间
	}
}

// Enter 进入出牌状态
func (s *PlayingState) Enter(ctx Context) {
	// 设置游戏开始时间
	ctx.SetData(KeyStartTime, time.Now())

	// 重置计数器
	ctx.SetData(KeyBombCount, 0)
	ctx.SetData(KeyPassCount, 0)

	// 清空上一轮出牌记录
	ctx.SetData(KeyLastPlayedCards, []component.Card{})
	ctx.SetData(KeyLastPlayerIndex, -1)
}

// Update 更新出牌状态
func (s *PlayingState) Update(ctx Context) {
	// 检查是否有玩家的牌已打完
	players := ctx.GetData(KeyPlayers).([]entity.Entity)
	for i, player := range players {
		cardComponent := player.GetComponent("Card").(*component.CardComponent)
		if cardComponent.Count() == 0 {
			// 有玩家打完牌，游戏结束
			if stateMachine, ok := ctx.GetData("stateMachine").(*StateMachine); ok {
				// 记录获胜玩家索引
				ctx.SetData("winnerIndex", i)
				stateMachine.ChangeState("GameOver")
			}
			return
		}
	}

	// 检查出牌是否超时
	startTime := ctx.GetData(KeyStartTime).(time.Time)
	if time.Since(startTime) > s.playTimeout {
		// 自动不出牌（过）
		s.handlePass(ctx)
	}
}

// handlePlay 处理出牌
func (s *PlayingState) handlePlay(ctx Context, cards []component.Card) bool {
	currentPlayerIndex := ctx.GetData(KeyCurrentPlayerIndex).(int)
	lastPlayedCards := ctx.GetData(KeyLastPlayedCards).([]component.Card)
	lastPlayerIndex := ctx.GetData(KeyLastPlayerIndex).(int)

	// 判断是否是第一手牌
	isFirstPlay := len(lastPlayedCards) == 0 || currentPlayerIndex == lastPlayerIndex

	// 验证出牌是否有效
	gameRule := ctx.GetData(KeyGameRule).(*rule.GameRule)
	valid, err := gameRule.ValidatePlay(cards, lastPlayedCards, isFirstPlay)

	if err != nil || !valid {
		return false
	}

	// 从玩家手牌中移除这些牌
	players := ctx.GetData(KeyPlayers).([]entity.Entity)
	playerEntity := players[currentPlayerIndex]
	cardComponent := playerEntity.GetComponent("Card").(*component.CardComponent)

	if !cardComponent.RemoveCards(cards) {
		// 移除失败，说明玩家没有这些牌
		return false
	}

	// 检查是否打出了炸弹或王炸
	analyzer := gameRule.GetCardAnalyzer()
	if combination, ok := analyzer.Analyze(cards); ok {
		if combination.Type == rule.CombinationBomb || combination.Type == rule.CombinationRocketBomb {
			// 增加炸弹计数
			bombCount := ctx.GetData(KeyBombCount).(int)
			ctx.SetData(KeyBombCount, bombCount+1)
		}
	}

	// 更新最后出牌记录
	ctx.SetData(KeyLastPlayedCards, cards)
	ctx.SetData(KeyLastPlayerIndex, currentPlayerIndex)

	// 重置过牌计数
	ctx.SetData(KeyPassCount, 0)

	// 移动到下一个玩家
	playerCount := len(players)
	nextPlayerIndex := (currentPlayerIndex + 1) % playerCount
	ctx.SetData(KeyCurrentPlayerIndex, nextPlayerIndex)

	// 重置计时器
	ctx.SetData(KeyStartTime, time.Now())

	return true
}

// handlePass 处理过牌
func (s *PlayingState) handlePass(ctx Context) {
	currentPlayerIndex := ctx.GetData(KeyCurrentPlayerIndex).(int)
	lastPlayerIndex := ctx.GetData(KeyLastPlayerIndex).(int)

	// 如果是新的一轮（没有人出过牌），不能过
	if lastPlayerIndex == -1 {
		return
	}

	// 如果是上家出的牌，不能过（必须出牌）
	if lastPlayerIndex == currentPlayerIndex {
		return
	}

	// 累加过牌计数
	passCount := ctx.GetData(KeyPassCount).(int)
	passCount++
	ctx.SetData(KeyPassCount, passCount)

	// 移动到下一个玩家
	players := ctx.GetData(KeyPlayers).([]entity.Entity)
	playerCount := len(players)
	nextPlayerIndex := (currentPlayerIndex + 1) % playerCount
	ctx.SetData(KeyCurrentPlayerIndex, nextPlayerIndex)

	// 如果所有人都过牌，新一轮由上家出牌
	if passCount >= playerCount-1 {
		ctx.SetData(KeyCurrentPlayerIndex, lastPlayerIndex)
		ctx.SetData(KeyLastPlayedCards, []component.Card{})
		ctx.SetData(KeyLastPlayerIndex, -1)
		ctx.SetData(KeyPassCount, 0)
	}

	// 重置计时器
	ctx.SetData(KeyStartTime, time.Now())
}

// Exit 退出出牌状态
func (s *PlayingState) Exit(ctx Context) {
	// 无需特殊处理
}

// GameOverState 游戏结束状态
type GameOverState struct {
	BaseState
}

// NewGameOverState 创建游戏结束状态
func NewGameOverState() *GameOverState {
	return &GameOverState{
		BaseState: *NewBaseState("GameOver"),
	}
}

// Enter 进入游戏结束状态
func (s *GameOverState) Enter(ctx Context) {
	// 计算得分
	winnerIndex := ctx.GetData("winnerIndex").(int)
	landlordIndex := ctx.GetData(KeyLandlordIndex).(int)
	callScore := ctx.GetData(KeyCallScores).([]int)[landlordIndex]
	bombCount := ctx.GetData(KeyBombCount).(int)
	baseScore := ctx.GetData(KeyBaseScore).(int)

	// 获取游戏规则
	gameRule := ctx.GetData(KeyGameRule).(*rule.GameRule)

	// 计算本局得分
	score := gameRule.CalculateScore(baseScore, callScore, bombCount)

	// 地主是否获胜
	isLandlordWin := winnerIndex == landlordIndex

	// 分发得分
	players := ctx.GetData(KeyPlayers).([]entity.Entity)
	for i, playerEntity := range players {
		// 获取玩家游戏状态组件而不是基本组件
		gameStateComp := playerEntity.GetComponent("GameState").(*component.PlayerGameStateComponent)

		if isLandlordWin {
			// 地主获胜，地主得分，农民扣分
			if i == landlordIndex {
				gameStateComp.SetScore(score * 2) // 地主得到两倍分数
			} else {
				gameStateComp.SetScore(-score) // 农民扣分
			}
		} else {
			// 农民获胜，地主扣分，农民得分
			if i == landlordIndex {
				gameStateComp.SetScore(-score * 2) // 地主扣除两倍分数
			} else {
				gameStateComp.SetScore(score) // 农民得分
			}
		}
	}
}

// Update 更新游戏结束状态
func (s *GameOverState) Update(ctx Context) {
	// 可以添加一个等待时间，然后回到等待状态
	startTime := ctx.GetData(KeyStartTime).(time.Time)
	if time.Since(startTime) > 5*time.Second {
		// 5秒后回到等待状态，准备下一局
		if stateMachine, ok := ctx.GetData("stateMachine").(*StateMachine); ok {
			stateMachine.ChangeState("Waiting")
		}
	}
}

// Exit 退出游戏结束状态
func (s *GameOverState) Exit(ctx Context) {
	// 重置玩家状态
	players := ctx.GetData(KeyPlayers).([]entity.Entity)
	for _, playerEntity := range players {
		// 重置玩家基本组件
		playerComponent := playerEntity.GetComponent("Player").(*component.PlayerComponent)
		playerComponent.Reset()

		// 重置玩家游戏状态组件
		gameStateComp := playerEntity.GetComponent("GameState").(*component.PlayerGameStateComponent)
		gameStateComp.Reset()

		// 重置玩家卡牌组件
		cardComponent := playerEntity.GetComponent("Card").(*component.CardComponent)
		cardComponent.Clear()
	}
}
