package component

import (
	"errors"
)

// 错误定义
var (
	ErrInvalidCardIndex = errors.New("无效的卡牌索引")
)

// PlayerCardComponent 玩家卡牌组件
type PlayerCardComponent struct {
	BaseComponent
	Cards       []Card // 玩家持有的卡牌
	PlayedCards []Card // 玩家已出的卡牌
}

// NewPlayerCardComponent 创建玩家卡牌组件
func NewPlayerCardComponent() *PlayerCardComponent {
	return &PlayerCardComponent{
		BaseComponent: *NewBaseComponent("PlayerCard"),
		Cards:         make([]Card, 0, 20),
		PlayedCards:   make([]Card, 0, 20),
	}
}

// SetCards 设置卡牌
func (c *PlayerCardComponent) SetCards(cards []Card) {
	c.Cards = cards
}

// AddCards 添加卡牌
func (c *PlayerCardComponent) AddCards(cards []Card) {
	c.Cards = append(c.Cards, cards...)
}

// GetCards 获取所有卡牌
func (c *PlayerCardComponent) GetCards() []Card {
	return c.Cards
}

// GetCardsByIndices 根据索引获取卡牌
func (c *PlayerCardComponent) GetCardsByIndices(indices []int) ([]Card, error) {
	cards := make([]Card, 0, len(indices))

	// 检查索引是否有效
	for _, index := range indices {
		if index < 0 || index >= len(c.Cards) {
			return nil, ErrInvalidCardIndex
		}
	}

	// 获取卡牌
	for _, index := range indices {
		cards = append(cards, c.Cards[index])
	}

	return cards, nil
}

// PlayCards 出牌
func (c *PlayerCardComponent) PlayCards(indices []int) error {
	// 检查索引是否有效
	for _, index := range indices {
		if index < 0 || index >= len(c.Cards) {
			return ErrInvalidCardIndex
		}
	}

	// 获取要出的牌
	cards := make([]Card, 0, len(indices))
	for _, index := range indices {
		cards = append(cards, c.Cards[index])
	}

	// 将出的牌添加到已出牌列表
	c.PlayedCards = append(c.PlayedCards, cards...)

	// 从手牌中移除这些牌
	// 注意: 我们需要从大到小排序索引，以便正确移除
	sortedIndices := make([]int, len(indices))
	copy(sortedIndices, indices)
	for i := 0; i < len(sortedIndices); i++ {
		for j := i + 1; j < len(sortedIndices); j++ {
			if sortedIndices[i] < sortedIndices[j] {
				sortedIndices[i], sortedIndices[j] = sortedIndices[j], sortedIndices[i]
			}
		}
	}

	// 从大到小删除，避免索引变化
	for _, index := range sortedIndices {
		c.Cards = append(c.Cards[:index], c.Cards[index+1:]...)
	}

	return nil
}

// GetPlayedCards 获取已出的卡牌
func (c *PlayerCardComponent) GetPlayedCards() []Card {
	return c.PlayedCards
}

// GetCardCount 获取卡牌数量
func (c *PlayerCardComponent) GetCardCount() int {
	return len(c.Cards)
}

// SortCards 对卡牌进行排序
func (c *PlayerCardComponent) SortCards() {
	sort := func(cards []Card) {
		// 使用冒泡排序（实际项目中可以使用更高效的排序算法）
		for i := 0; i < len(cards); i++ {
			for j := 0; j < len(cards)-i-1; j++ {
				if GetCardWeight(cards[j].Value) < GetCardWeight(cards[j+1].Value) {
					cards[j], cards[j+1] = cards[j+1], cards[j]
				}
			}
		}
	}

	sort(c.Cards)
}

// compareCard 比较两张卡牌大小
// 返回值: 1表示c1>c2, 0表示c1=c2, -1表示c1<c2
func compareCard(c1, c2 Card) int {
	if c1.Value > c2.Value {
		return 1
	} else if c1.Value < c2.Value {
		return -1
	} else {
		if c1.Suit > c2.Suit {
			return 1
		} else if c1.Suit < c2.Suit {
			return -1
		} else {
			return 0
		}
	}
}
