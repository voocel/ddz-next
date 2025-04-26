package ai

import (
	"sort"

	"github.com/yourusername/go-ddz/game/component"
	"github.com/yourusername/go-ddz/game/rule"
)

// SimpleAI 简单AI实现
type SimpleAI struct {
	cardEngine *rule.CardEngine
}

// NewSimpleAI 创建新的简单AI
func NewSimpleAI() *SimpleAI {
	return &SimpleAI{
		cardEngine: rule.NewCardEngine(),
	}
}

// CallLandlord 叫地主策略
// 返回叫分 (0-3)
func (ai *SimpleAI) CallLandlord(cards []component.Card) int {
	// 计算牌的总权值
	totalWeight := 0
	for _, card := range cards {
		totalWeight += component.GetCardWeight(card.Value)
	}

	// 统计关键牌
	bombCount := 0
	aceCount := 0
	twoCount := 0
	jokerCount := 0

	// 计算每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++

		// 统计关键牌
		if card.Value == component.ValueA {
			aceCount++
		} else if card.Value == component.Value2 {
			twoCount++
		} else if card.Value == component.ValueSmallJoker || card.Value == component.ValueBigJoker {
			jokerCount++
		}
	}

	// 统计炸弹数量
	for _, count := range valueCounts {
		if count == 4 {
			bombCount++
		}
	}

	// 根据牌力叫分
	score := 0

	// 有火箭
	if jokerCount == 2 {
		score += 2
	}

	// 有炸弹
	score += bombCount

	// 有足够的控制牌
	controlScore := aceCount/2 + twoCount + jokerCount

	// 根据总权值和关键牌决定叫分
	if totalWeight > 270 || (bombCount >= 2 && controlScore >= 3) {
		score = 3
	} else if totalWeight > 240 || (bombCount >= 1 && controlScore >= 3) {
		score = max(score, 2)
	} else if totalWeight > 210 || controlScore >= 3 {
		score = max(score, 1)
	}

	return score
}

// ChooseCards 出牌策略
// lastCards: 上家出的牌，为nil表示首次出牌
// cards: 手牌
// 返回要出的牌索引
func (ai *SimpleAI) ChooseCards(lastCombo *rule.CardCombo, cards []component.Card) []int {
	// 首次出牌
	if lastCombo == nil {
		return ai.chooseFirstPlay(cards)
	}

	// 尝试打过上家的牌
	return ai.tryBeatCards(lastCombo, cards)
}

// chooseFirstPlay 首次出牌策略
func (ai *SimpleAI) chooseFirstPlay(cards []component.Card) []int {
	// 复制卡牌并排序
	sortedCards := make([]component.Card, len(cards))
	copy(sortedCards, cards)
	sort.Slice(sortedCards, func(i, j int) bool {
		return component.GetCardWeight(sortedCards[i].Value) < component.GetCardWeight(sortedCards[j].Value)
	})

	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range sortedCards {
		valueCounts[card.Value]++
	}

	// 1. 尝试出单张
	for _, card := range sortedCards {
		if valueCounts[card.Value] == 1 {
			return []int{getCardIndex(cards, card)}
		}
	}

	// 2. 尝试出对子
	for i, card := range sortedCards {
		if i+1 < len(sortedCards) && card.Value == sortedCards[i+1].Value {
			idx1 := getCardIndex(cards, card)
			idx2 := getCardIndex(cards, sortedCards[i+1])
			return []int{idx1, idx2}
		}
	}

	// 3. 尝试出三张
	for i, card := range sortedCards {
		if i+2 < len(sortedCards) && card.Value == sortedCards[i+1].Value && card.Value == sortedCards[i+2].Value {
			idx1 := getCardIndex(cards, card)
			idx2 := getCardIndex(cards, sortedCards[i+1])
			idx3 := getCardIndex(cards, sortedCards[i+2])
			return []int{idx1, idx2, idx3}
		}
	}

	// 4. 尝试出顺子
	straightIndices := ai.findStraight(cards)
	if len(straightIndices) > 0 {
		return straightIndices
	}

	// 5. 尝试出三带一
	for i, card := range sortedCards {
		if i+2 < len(sortedCards) && card.Value == sortedCards[i+1].Value && card.Value == sortedCards[i+2].Value {
			idx1 := getCardIndex(cards, card)
			idx2 := getCardIndex(cards, sortedCards[i+1])
			idx3 := getCardIndex(cards, sortedCards[i+2])

			// 找一个单张带上
			for _, singleCard := range sortedCards {
				if valueCounts[singleCard.Value] == 1 {
					idx4 := getCardIndex(cards, singleCard)
					return []int{idx1, idx2, idx3, idx4}
				} else if valueCounts[singleCard.Value] >= 2 && singleCard.Value != card.Value {
					// 带一张对子中的牌
					idx4 := getCardIndex(cards, singleCard)
					return []int{idx1, idx2, idx3, idx4}
				}
			}
		}
	}

	// 6. 默认出第一张牌
	return []int{0}
}

// tryBeatCards 尝试打过上家的牌
func (ai *SimpleAI) tryBeatCards(lastCombo *rule.CardCombo, cards []component.Card) []int {
	// 尝试所有可能的牌型组合
	for i := 0; i < len(cards); i++ {
		for j := i + 1; j <= len(cards); j++ {
			// 选择连续的子区间
			testCards := cards[i:j]
			combo, err := ai.cardEngine.ValidateCardCombo(testCards)

			if err == nil {
				// 检查是否能打过上家的牌
				canBeat, err := ai.cardEngine.CanBeat(lastCombo, combo)
				if err == nil && canBeat {
					// 找到能打过的组合，转换为索引
					indices := make([]int, len(testCards))
					for k := range testCards {
						indices[k] = i + k
					}
					return indices
				}
			}
		}
	}

	// 特殊情况: 尝试炸弹
	bombIndices := ai.findBomb(cards)
	if len(bombIndices) > 0 && lastCombo.ComboType != rule.ComboRocket {
		return bombIndices
	}

	// 特殊情况: 尝试王炸
	rocketIndices := ai.findRocket(cards)
	if len(rocketIndices) > 0 {
		return rocketIndices
	}

	// 无法打过，不出
	return []int{}
}

// findStraight 寻找顺子
func (ai *SimpleAI) findStraight(cards []component.Card) []int {
	// 复制卡牌并排序
	sortedCards := make([]component.Card, len(cards))
	copy(sortedCards, cards)
	sort.Slice(sortedCards, func(i, j int) bool {
		return component.GetCardWeight(sortedCards[i].Value) < component.GetCardWeight(sortedCards[j].Value)
	})

	// 找到可能的顺子
	for start := 0; start < len(sortedCards)-4; start++ {
		straight := make([]component.Card, 0, 5)
		straight = append(straight, sortedCards[start])

		for i := start + 1; i < len(sortedCards); i++ {
			// 顺子不能有2和王
			if sortedCards[i].Value == component.Value2 ||
				sortedCards[i].Value == component.ValueSmallJoker ||
				sortedCards[i].Value == component.ValueBigJoker {
				break
			}

			// 忽略重复点数
			if len(straight) > 0 && sortedCards[i].Value == straight[len(straight)-1].Value {
				continue
			}

			// 检查是否连续
			if len(straight) > 0 &&
				component.GetCardWeight(sortedCards[i].Value) !=
					component.GetCardWeight(straight[len(straight)-1].Value)+1 {
				break
			}

			straight = append(straight, sortedCards[i])

			// 找到5张以上的顺子
			if len(straight) >= 5 {
				// 转换为索引
				indices := make([]int, len(straight))
				for j, card := range straight {
					indices[j] = getCardIndex(cards, card)
				}
				return indices
			}
		}
	}

	return []int{}
}

// findBomb 寻找炸弹
func (ai *SimpleAI) findBomb(cards []component.Card) []int {
	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	valueCards := make(map[component.CardValue][]component.Card)

	for _, card := range cards {
		valueCounts[card.Value]++
		valueCards[card.Value] = append(valueCards[card.Value], card)
	}

	// 寻找炸弹
	for value, count := range valueCounts {
		if count == 4 {
			// 找到炸弹，转换为索引
			indices := make([]int, 4)
			for i, card := range valueCards[value] {
				indices[i] = getCardIndex(cards, card)
			}
			return indices
		}
	}

	return []int{}
}

// findRocket 寻找王炸
func (ai *SimpleAI) findRocket(cards []component.Card) []int {
	// 寻找大小王
	hasSmall := false
	hasBig := false
	smallIdx := -1
	bigIdx := -1

	for i, card := range cards {
		if card.Value == component.ValueSmallJoker {
			hasSmall = true
			smallIdx = i
		} else if card.Value == component.ValueBigJoker {
			hasBig = true
			bigIdx = i
		}
	}

	if hasSmall && hasBig {
		return []int{smallIdx, bigIdx}
	}

	return []int{}
}

// getCardIndex 获取卡牌在数组中的索引
func getCardIndex(cards []component.Card, targetCard component.Card) int {
	for i, card := range cards {
		if card.ID() == targetCard.ID() {
			return i
		}
	}
	return -1
}

// max 返回两个整数中的较大值
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
