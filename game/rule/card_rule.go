package rule

import (
	"sort"

	"github.com/yourusername/go-ddz/game/component"
)

// CombinationType 牌型类型
type CombinationType int

const (
	CombinationUnknown                      CombinationType = iota
	CombinationSingle                                       // 单牌
	CombinationPair                                         // 对子
	CombinationTriplet                                      // 三张
	CombinationTripletWithSingle                            // 三带一
	CombinationTripletWithPair                              // 三带二
	CombinationSequence                                     // 顺子
	CombinationSequenceOfPairs                              // 连对
	CombinationSequenceOfTriplets                           // 飞机
	CombinationSequenceOfTripletWithSingles                 // 飞机带单牌
	CombinationSequenceOfTripletWithPairs                   // 飞机带对子
	CombinationBomb                                         // 炸弹
	CombinationRocketBomb                                   // 火箭（王炸）
	CombinationFourWithTwo                                  // 四带二
	CombinationFourWithTwoPairs                             // 四带两对
)

// CardCombination 牌型组合
type CardCombination struct {
	Type   CombinationType     // 组合类型
	Cards  []component.Card    // 组成的卡牌
	Value  component.CardValue // 组合的主要牌值
	Length int                 // 对于顺子等，表示长度
	Weight int                 // 牌型权重，用于大小比较
}

// NewCardCombination 创建卡牌组合
func NewCardCombination(cards []component.Card, combinationType CombinationType, value component.CardValue, length int) *CardCombination {
	weight := calculateWeight(combinationType, value)
	return &CardCombination{
		Type:   combinationType,
		Cards:  cards,
		Value:  value,
		Length: length,
		Weight: weight,
	}
}

// 计算牌型权重
func calculateWeight(combinationType CombinationType, value component.CardValue) int {
	baseWeight := int(value) * 10

	// 炸弹和火箭权重最高
	switch combinationType {
	case CombinationRocketBomb:
		return 1000
	case CombinationBomb:
		return 900 + baseWeight
	default:
		return baseWeight
	}
}

// CardAnalyzer 牌型分析器
type CardAnalyzer struct{}

// NewCardAnalyzer 创建新的牌型分析器
func NewCardAnalyzer() *CardAnalyzer {
	return &CardAnalyzer{}
}

// Analyze 分析牌型
func (ca *CardAnalyzer) Analyze(cards []component.Card) (*CardCombination, bool) {
	if len(cards) == 0 {
		return nil, false
	}

	// 排序牌
	sortedCards := make([]component.Card, len(cards))
	copy(sortedCards, cards)
	sort.Slice(sortedCards, func(i, j int) bool {
		return component.GetCardWeight(sortedCards[i].Value) < component.GetCardWeight(sortedCards[j].Value)
	})

	// 检查火箭（王炸）
	if isRocket(sortedCards) {
		return NewCardCombination(sortedCards, CombinationRocketBomb, component.ValueBigJoker, 2), true
	}

	// 检查炸弹
	if isBomb, value := isBomb(sortedCards); isBomb {
		return NewCardCombination(sortedCards, CombinationBomb, value, 4), true
	}

	// 根据牌数检查不同牌型
	switch len(sortedCards) {
	case 1:
		// 单牌
		return NewCardCombination(sortedCards, CombinationSingle, sortedCards[0].Value, 1), true
	case 2:
		// 对子
		if isPair(sortedCards) {
			return NewCardCombination(sortedCards, CombinationPair, sortedCards[0].Value, 1), true
		}
	case 3:
		// 三张
		if isTriplet(sortedCards) {
			return NewCardCombination(sortedCards, CombinationTriplet, sortedCards[0].Value, 1), true
		}
	case 4:
		// 三带一
		if combination, ok := isTripletWithSingle(sortedCards); ok {
			return combination, true
		}
	case 5:
		// 三带二或者顺子
		if combination, ok := isTripletWithPair(sortedCards); ok {
			return combination, true
		}
		if combination, ok := isSequence(sortedCards); ok {
			return combination, true
		}
	default:
		// 检查更多牌型
		if combination, ok := isSequence(sortedCards); ok {
			return combination, true
		}
		if combination, ok := isSequenceOfPairs(sortedCards); ok {
			return combination, true
		}
		if combination, ok := isSequenceOfTriplets(sortedCards); ok {
			return combination, true
		}
		if combination, ok := isFourWithTwo(sortedCards); ok {
			return combination, true
		}
		if combination, ok := isFourWithTwoPairs(sortedCards); ok {
			return combination, true
		}
	}

	return nil, false
}

// CanBeat 判断是否能够压过另一个牌型
func (ca *CardAnalyzer) CanBeat(a, b *CardCombination) bool {
	// 火箭能压过任何牌
	if a.Type == CombinationRocketBomb {
		return true
	}

	// 炸弹能压过除火箭外的牌
	if a.Type == CombinationBomb && b.Type != CombinationRocketBomb && b.Type != CombinationBomb {
		return true
	}

	// 同类型比较
	if a.Type == b.Type {
		// 顺子、连对、飞机还需要比较长度
		if (a.Type == CombinationSequence || a.Type == CombinationSequenceOfPairs || a.Type == CombinationSequenceOfTriplets) && a.Length != b.Length {
			return false
		}
		return a.Weight > b.Weight
	}

	return false
}

// 以下是各种牌型判断函数

// 判断是否为火箭（王炸）
func isRocket(cards []component.Card) bool {
	if len(cards) != 2 {
		return false
	}
	return (cards[0].Value == component.ValueSmallJoker && cards[1].Value == component.ValueBigJoker) ||
		(cards[0].Value == component.ValueBigJoker && cards[1].Value == component.ValueSmallJoker)
}

// 判断是否为炸弹
func isBomb(cards []component.Card) (bool, component.CardValue) {
	if len(cards) != 4 {
		return false, component.ValueUnknown
	}

	value := cards[0].Value
	for _, card := range cards {
		if card.Value != value {
			return false, component.ValueUnknown
		}
	}

	return true, value
}

// 判断是否为对子
func isPair(cards []component.Card) bool {
	if len(cards) != 2 {
		return false
	}
	return cards[0].Value == cards[1].Value
}

// 判断是否为三张
func isTriplet(cards []component.Card) bool {
	if len(cards) != 3 {
		return false
	}
	value := cards[0].Value
	for _, card := range cards {
		if card.Value != value {
			return false
		}
	}
	return true
}

// 判断是否为三带一
func isTripletWithSingle(cards []component.Card) (*CardCombination, bool) {
	if len(cards) != 4 {
		return nil, false
	}

	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	var tripletValue component.CardValue
	var singleValue component.CardValue

	for value, count := range valueCounts {
		if count == 3 {
			tripletValue = value
		} else if count == 1 {
			singleValue = value
		}
	}

	if tripletValue != component.ValueUnknown && singleValue != component.ValueUnknown {
		return NewCardCombination(cards, CombinationTripletWithSingle, tripletValue, 1), true
	}

	return nil, false
}

// 判断是否为三带二
func isTripletWithPair(cards []component.Card) (*CardCombination, bool) {
	if len(cards) != 5 {
		return nil, false
	}

	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	var tripletValue component.CardValue
	var pairValue component.CardValue

	for value, count := range valueCounts {
		if count == 3 {
			tripletValue = value
		} else if count == 2 {
			pairValue = value
		}
	}

	if tripletValue != component.ValueUnknown && pairValue != component.ValueUnknown {
		return NewCardCombination(cards, CombinationTripletWithPair, tripletValue, 1), true
	}

	return nil, false
}

// 判断是否为顺子
func isSequence(cards []component.Card) (*CardCombination, bool) {
	if len(cards) < 5 {
		return nil, false
	}

	// 排序
	sortedCards := make([]component.Card, len(cards))
	copy(sortedCards, cards)
	sort.Slice(sortedCards, func(i, j int) bool {
		return component.GetCardWeight(sortedCards[i].Value) < component.GetCardWeight(sortedCards[j].Value)
	})

	// 检查是否连续且没有2和大小王
	startValue := sortedCards[0].Value
	if startValue >= component.Value2 {
		return nil, false
	}

	for i, card := range sortedCards {
		if i > 0 && int(card.Value) != int(startValue)+i {
			return nil, false
		}
	}

	return NewCardCombination(sortedCards, CombinationSequence, startValue, len(sortedCards)), true
}

// 判断是否为连对
func isSequenceOfPairs(cards []component.Card) (*CardCombination, bool) {
	if len(cards) < 6 || len(cards)%2 != 0 {
		return nil, false
	}

	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	// 所有点数必须出现2次
	values := make([]int, 0, len(valueCounts))
	for value, count := range valueCounts {
		if count != 2 || value >= component.Value2 {
			return nil, false
		}
		values = append(values, int(value))
	}

	// 排序点数
	sort.Ints(values)

	// 检查是否连续
	for i := 1; i < len(values); i++ {
		if values[i] != values[i-1]+1 {
			return nil, false
		}
	}

	return NewCardCombination(cards, CombinationSequenceOfPairs, component.CardValue(values[0]), len(values)), true
}

// 判断是否为飞机（连续三张）
func isSequenceOfTriplets(cards []component.Card) (*CardCombination, bool) {
	if len(cards) < 6 || len(cards)%3 != 0 {
		return nil, false
	}

	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	// 所有点数必须出现3次
	values := make([]int, 0, len(valueCounts))
	for value, count := range valueCounts {
		if count != 3 || value >= component.Value2 {
			return nil, false
		}
		values = append(values, int(value))
	}

	// 排序点数
	sort.Ints(values)

	// 检查是否连续
	for i := 1; i < len(values); i++ {
		if values[i] != values[i-1]+1 {
			return nil, false
		}
	}

	return NewCardCombination(cards, CombinationSequenceOfTriplets, component.CardValue(values[0]), len(values)), true
}

// 判断是否为四带二
func isFourWithTwo(cards []component.Card) (*CardCombination, bool) {
	if len(cards) != 6 {
		return nil, false
	}

	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	var fourValue component.CardValue
	singleCount := 0

	for value, count := range valueCounts {
		if count == 4 {
			fourValue = value
		} else if count == 1 {
			singleCount++
		}
	}

	if fourValue != component.ValueUnknown && singleCount == 2 {
		return NewCardCombination(cards, CombinationFourWithTwo, fourValue, 1), true
	}

	return nil, false
}

// 判断是否为四带两对
func isFourWithTwoPairs(cards []component.Card) (*CardCombination, bool) {
	if len(cards) != 8 {
		return nil, false
	}

	// 统计每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	var fourValue component.CardValue
	pairCount := 0

	for value, count := range valueCounts {
		if count == 4 {
			fourValue = value
		} else if count == 2 {
			pairCount++
		}
	}

	if fourValue != component.ValueUnknown && pairCount == 2 {
		return NewCardCombination(cards, CombinationFourWithTwoPairs, fourValue, 1), true
	}

	return nil, false
}
