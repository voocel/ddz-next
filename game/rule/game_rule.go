package rule

import (
	"errors"
	"math/rand"

	"github.com/yourusername/go-ddz/game/component"
)

// 游戏错误定义
var (
	ErrInvalidPlay        = errors.New("无效的出牌")
	ErrCannotBeatLastPlay = errors.New("无法压过上家出牌")
	ErrInvalidCallScore   = errors.New("无效的叫分")
	ErrNotYourTurn        = errors.New("不是你的回合")
	ErrGameNotInProgress  = errors.New("游戏尚未开始")
	ErrInvalidPlayerCount = errors.New("玩家数量不正确")
	ErrPlayerNotReady     = errors.New("玩家未准备好")
)

// GameRule 游戏规则引擎
type GameRule struct {
	analyzer         *CardAnalyzer
	minPlayers       int
	maxPlayers       int
	callScoreOptions []int // 叫分选项，通常是 [1, 2, 3]
}

// NewGameRule 创建游戏规则引擎
func NewGameRule() *GameRule {
	return &GameRule{
		analyzer:         NewCardAnalyzer(),
		minPlayers:       3,
		maxPlayers:       3,
		callScoreOptions: []int{1, 2, 3},
	}
}

// DealCards 发牌，返回每个玩家的牌和底牌
func (r *GameRule) DealCards(playerCount int) ([][]component.Card, []component.Card, error) {
	if playerCount < r.minPlayers || playerCount > r.maxPlayers {
		return nil, nil, ErrInvalidPlayerCount
	}

	// 创建一副完整的牌
	deck := component.CreateDeck(true)

	// 洗牌
	deck = component.ShuffleDeck(deck)

	// 分发牌
	playerCards := make([][]component.Card, playerCount)
	for i := 0; i < playerCount; i++ {
		playerCards[i] = make([]component.Card, 0, 17)
	}

	// 预留3张底牌
	bottomCards := make([]component.Card, 0, 3)

	// 轮流发牌
	cardIndex := 0
	for i := 0; i < 17; i++ { // 每个玩家17张牌
		for j := 0; j < playerCount; j++ {
			playerCards[j] = append(playerCards[j], deck[cardIndex])
			cardIndex++
		}
	}

	// 剩余的牌作为底牌
	for i := cardIndex; i < len(deck); i++ {
		bottomCards = append(bottomCards, deck[i])
	}

	return playerCards, bottomCards, nil
}

// ValidateCallScore 验证叫分是否有效
func (r *GameRule) ValidateCallScore(score int, maxCalledScore int) bool {
	// 验证分数是否在有效范围内
	validScore := false
	for _, option := range r.callScoreOptions {
		if score == option {
			validScore = true
			break
		}
	}

	// 可以不叫（分数为0）
	if score == 0 {
		return true
	}

	// 分数必须有效且大于已叫最高分
	return validScore && score > maxCalledScore
}

// ValidatePlay 验证出牌是否有效
func (r *GameRule) ValidatePlay(cards []component.Card, lastPlayedCards []component.Card, isFirstPlay bool) (bool, error) {
	// 分析当前出的牌
	combination, valid := r.analyzer.Analyze(cards)
	if !valid {
		return false, ErrInvalidPlay
	}

	// 如果是第一手牌，则有效
	if isFirstPlay || len(lastPlayedCards) == 0 {
		return true, nil
	}

	// 分析上一手牌
	lastCombination, valid := r.analyzer.Analyze(lastPlayedCards)
	if !valid {
		// 理论上不应该发生
		return false, errors.New("内部错误：上一手牌无效")
	}

	// 判断是否能压过上家
	if r.analyzer.CanBeat(combination, lastCombination) {
		return true, nil
	}

	return false, ErrCannotBeatLastPlay
}

// DetermineLandlord 根据叫分结果确定地主
func (r *GameRule) DetermineLandlord(callScores []int) int {
	// 找出叫分最高的玩家作为地主
	highestScore := -1
	landlordIndex := -1

	for i, score := range callScores {
		if score > highestScore {
			highestScore = score
			landlordIndex = i
		}
	}

	// 如果没有人叫分，随机选择一个玩家作为地主
	if landlordIndex == -1 {
		landlordIndex = rand.Intn(len(callScores))
	}

	return landlordIndex
}

// CalculateScore 计算得分
func (r *GameRule) CalculateScore(baseScore int, callScore int, bombCount int) int {
	// 基础分 * 叫分 * 2^炸弹数
	multiplier := 1
	for i := 0; i < bombCount; i++ {
		multiplier *= 2
	}

	return baseScore * callScore * multiplier
}

// GetCardAnalyzer 获取牌型分析器
func (r *GameRule) GetCardAnalyzer() *CardAnalyzer {
	return r.analyzer
}
