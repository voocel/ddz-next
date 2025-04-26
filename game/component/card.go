package component

import (
	"fmt"
	"math/rand"
	"sort"
)

// CardSuit 卡牌花色
type CardSuit int

const (
	SuitUnknown CardSuit = iota // 未知花色
	SuitSpade                   // 黑桃
	SuitHeart                   // 红桃
	SuitClub                    // 梅花
	SuitDiamond                 // 方块
	SuitJoker                   // 王牌
)

// CardValue 卡牌点数
type CardValue int

const (
	ValueUnknown    CardValue = iota // 未知点数
	Value3                           // 3
	Value4                           // 4
	Value5                           // 5
	Value6                           // 6
	Value7                           // 7
	Value8                           // 8
	Value9                           // 9
	Value10                          // 10
	ValueJ                           // J
	ValueQ                           // Q
	ValueK                           // K
	ValueA                           // A
	Value2                           // 2
	ValueSmallJoker                  // 小王
	ValueBigJoker                    // 大王
)

// 卡牌权重，用于比较大小
var cardWeights = map[CardValue]int{
	Value3:          3,
	Value4:          4,
	Value5:          5,
	Value6:          6,
	Value7:          7,
	Value8:          8,
	Value9:          9,
	Value10:         10,
	ValueJ:          11,
	ValueQ:          12,
	ValueK:          13,
	ValueA:          14,
	Value2:          15,
	ValueSmallJoker: 16,
	ValueBigJoker:   17,
}

// GetCardWeight 获取卡牌权重
func GetCardWeight(value CardValue) int {
	return cardWeights[value]
}

// Card 卡牌结构
type Card struct {
	Suit  CardSuit  // 花色
	Value CardValue // 点数
}

// NewCard 创建新卡牌
func NewCard(suit CardSuit, value CardValue) Card {
	return Card{
		Suit:  suit,
		Value: value,
	}
}

// ID 获取卡牌唯一ID
func (c Card) ID() int {
	return int(c.Suit)*100 + int(c.Value)
}

// String 卡牌字符串表示
func (c Card) String() string {
	suitStr := ""
	switch c.Suit {
	case SuitSpade:
		suitStr = "♠"
	case SuitHeart:
		suitStr = "♥"
	case SuitClub:
		suitStr = "♣"
	case SuitDiamond:
		suitStr = "♦"
	case SuitJoker:
		if c.Value == ValueSmallJoker {
			return "小王"
		}
		return "大王"
	}

	valueStr := ""
	switch c.Value {
	case Value3:
		valueStr = "3"
	case Value4:
		valueStr = "4"
	case Value5:
		valueStr = "5"
	case Value6:
		valueStr = "6"
	case Value7:
		valueStr = "7"
	case Value8:
		valueStr = "8"
	case Value9:
		valueStr = "9"
	case Value10:
		valueStr = "10"
	case ValueJ:
		valueStr = "J"
	case ValueQ:
		valueStr = "Q"
	case ValueK:
		valueStr = "K"
	case ValueA:
		valueStr = "A"
	case Value2:
		valueStr = "2"
	}

	return fmt.Sprintf("%s%s", suitStr, valueStr)
}

// CardComponent 卡牌组件
type CardComponent struct {
	BaseComponent
	Cards []Card // 持有的卡牌
}

// NewCardComponent 创建新的卡牌组件
func NewCardComponent() *CardComponent {
	return &CardComponent{
		BaseComponent: *NewBaseComponent("Card"),
		Cards:         make([]Card, 0),
	}
}

// AddCard 添加卡牌
func (c *CardComponent) AddCard(card Card) {
	c.Cards = append(c.Cards, card)
}

// AddCards 添加多张卡牌
func (c *CardComponent) AddCards(cards []Card) {
	c.Cards = append(c.Cards, cards...)
}

// RemoveCard 移除卡牌
func (c *CardComponent) RemoveCard(card Card) bool {
	for i, cardItem := range c.Cards {
		if cardItem.ID() == card.ID() {
			c.Cards = append(c.Cards[:i], c.Cards[i+1:]...)
			return true
		}
	}
	return false
}

// RemoveCards 移除多张卡牌
func (c *CardComponent) RemoveCards(cards []Card) bool {
	// 创建待移除卡牌的ID集合
	cardIDs := make(map[int]bool)
	for _, card := range cards {
		cardIDs[card.ID()] = true
	}

	// 创建新的卡牌列表，排除要移除的卡牌
	newCards := make([]Card, 0, len(c.Cards)-len(cards))
	for _, card := range c.Cards {
		if !cardIDs[card.ID()] {
			newCards = append(newCards, card)
		} else {
			// 使用过一次后从集合中移除，避免重复卡牌问题
			delete(cardIDs, card.ID())
		}
	}

	// 检查是否所有卡牌都找到并移除
	if len(cardIDs) > 0 {
		return false
	}

	c.Cards = newCards
	return true
}

// HasCard 是否持有某张卡牌
func (c *CardComponent) HasCard(card Card) bool {
	for _, cardItem := range c.Cards {
		if cardItem.ID() == card.ID() {
			return true
		}
	}
	return false
}

// Count 获取卡牌数量
func (c *CardComponent) Count() int {
	return len(c.Cards)
}

// Sort 排序卡牌
func (c *CardComponent) Sort() {
	sort.Slice(c.Cards, func(i, j int) bool {
		// 首先按点数权重排序
		iWeight := GetCardWeight(c.Cards[i].Value)
		jWeight := GetCardWeight(c.Cards[j].Value)
		if iWeight != jWeight {
			return iWeight < jWeight
		}
		// 权重相同则按花色排序
		return c.Cards[i].Suit < c.Cards[j].Suit
	})
}

// Clear 清空卡牌
func (c *CardComponent) Clear() {
	c.Cards = make([]Card, 0)
}

// CreateDeck 创建一副完整的牌（不含大小王）
func CreateDeck(includeJokers bool) []Card {
	var deck []Card

	// 添加普通牌
	for suit := SuitSpade; suit <= SuitDiamond; suit++ {
		for value := Value3; value <= Value2; value++ {
			deck = append(deck, NewCard(suit, value))
		}
	}

	// 添加大小王
	if includeJokers {
		deck = append(deck, NewCard(SuitJoker, ValueSmallJoker))
		deck = append(deck, NewCard(SuitJoker, ValueBigJoker))
	}

	return deck
}

// ShuffleDeck 洗牌
func ShuffleDeck(deck []Card) []Card {
	shuffled := make([]Card, len(deck))
	copy(shuffled, deck)

	for i := range shuffled {
		j := i + rand.Intn(len(shuffled)-i)
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	}

	return shuffled
}
