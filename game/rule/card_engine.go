package rule

import (
	"errors"
	"math/rand"
	"sort"
	"time"

	"github.com/yourusername/go-ddz/game/component"
)

// 卡牌组合类型
type CardComboType int

const (
	ComboUnknown               CardComboType = iota // 未知类型
	ComboSingle                                     // 单张
	ComboPair                                       // 对子
	ComboTriple                                     // 三张
	ComboTriplePair                                 // 三带一对
	ComboTripleSingle                               // 三带一
	ComboFourPairs                                  // 四带二 (两对)
	ComboFourSingles                                // 四带二 (两单张)
	ComboStraight                                   // 顺子 (五张或更多连续单牌)
	ComboPairStraight                               // 连对 (三对或更多连续对牌)
	ComboTripleStraight                             // 飞机 (两个或更多连续三张)
	ComboTripleStraightPairs                        // 飞机带对子
	ComboTripleStraightSingles                      // 飞机带单张
	ComboBomb                                       // 炸弹 (四张同点数的牌)
	ComboRocket                                     // 火箭 (大小王)
)

// CardCombo 卡牌组合
type CardCombo struct {
	Cards     []component.Card // 卡牌列表
	ComboType CardComboType    // 组合类型
	Value     int              // 组合权值
}

// CardEngine 卡牌引擎
type CardEngine struct {
	landlordCards []component.Card // 地主牌
	rand          *rand.Rand       // 随机数生成器
}

// 错误定义
var (
	ErrInvalidCardCombo = errors.New("无效的牌型组合")
	ErrCannotBeat       = errors.New("无法打过对方的牌")
)

// NewCardEngine 创建新的卡牌引擎
func NewCardEngine() *CardEngine {
	return &CardEngine{
		landlordCards: make([]component.Card, 0),
		rand:          rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// DealCards 发牌
// 返回三组玩家牌和三张地主牌
func (e *CardEngine) DealCards() ([][]component.Card, []component.Card) {
	// 创建一副完整的牌
	deck := component.CreateDeck(true)

	// 洗牌
	deck = component.ShuffleDeck(deck)

	// 分牌给三个玩家，每人17张
	playerCards := make([][]component.Card, 3)
	for i := 0; i < 3; i++ {
		playerCards[i] = make([]component.Card, 17)
		copy(playerCards[i], deck[i*17:(i+1)*17])
	}

	// 剩下的3张作为地主牌
	landlordCards := make([]component.Card, 3)
	copy(landlordCards, deck[51:])

	// 保存地主牌
	e.landlordCards = landlordCards

	return playerCards, landlordCards
}

// SetLandlordCards 设置地主牌
func (e *CardEngine) SetLandlordCards(cards []component.Card) {
	e.landlordCards = cards
}

// GetLandlordCards 获取地主牌
func (e *CardEngine) GetLandlordCards() []component.Card {
	return e.landlordCards
}

// ValidateCardCombo 验证卡牌组合是否合法
func (e *CardEngine) ValidateCardCombo(cards []component.Card) (*CardCombo, error) {
	if len(cards) == 0 {
		return nil, ErrInvalidCardCombo
	}

	// 对牌按权重排序
	sortedCards := make([]component.Card, len(cards))
	copy(sortedCards, cards)
	sort.Slice(sortedCards, func(i, j int) bool {
		return component.GetCardWeight(sortedCards[i].Value) > component.GetCardWeight(sortedCards[j].Value)
	})

	// 识别牌型
	comboType, value := e.identifyCardCombo(sortedCards)
	if comboType == ComboUnknown {
		return nil, ErrInvalidCardCombo
	}

	return &CardCombo{
		Cards:     sortedCards,
		ComboType: comboType,
		Value:     value,
	}, nil
}

// CanBeat 判断是否能够打过对方的牌
func (e *CardEngine) CanBeat(oldCombo, newCombo *CardCombo) (bool, error) {
	// 火箭可以打过任何牌
	if newCombo.ComboType == ComboRocket {
		return true, nil
	}

	// 炸弹可以打过除火箭外的任何牌
	if newCombo.ComboType == ComboBomb && oldCombo.ComboType != ComboBomb && oldCombo.ComboType != ComboRocket {
		return true, nil
	}

	// 炸弹对炸弹，比较权值
	if newCombo.ComboType == ComboBomb && oldCombo.ComboType == ComboBomb {
		return newCombo.Value > oldCombo.Value, nil
	}

	// 其他牌型必须类型相同且牌数相同
	if newCombo.ComboType != oldCombo.ComboType || len(newCombo.Cards) != len(oldCombo.Cards) {
		return false, nil
	}

	// 比较权值
	return newCombo.Value > oldCombo.Value, nil
}

// identifyCardCombo 识别牌型并计算权值
func (e *CardEngine) identifyCardCombo(cards []component.Card) (CardComboType, int) {
	cardCount := len(cards)

	// 单张
	if cardCount == 1 {
		return ComboSingle, component.GetCardWeight(cards[0].Value)
	}

	// 对子
	if cardCount == 2 {
		if cards[0].Value == cards[1].Value {
			return ComboPair, component.GetCardWeight(cards[0].Value)
		}

		// 火箭 (大小王)
		if (cards[0].Value == component.ValueBigJoker && cards[1].Value == component.ValueSmallJoker) ||
			(cards[0].Value == component.ValueSmallJoker && cards[1].Value == component.ValueBigJoker) {
			return ComboRocket, 100 // 火箭的权值最高
		}
	}

	// 三张
	if cardCount == 3 && cards[0].Value == cards[1].Value && cards[1].Value == cards[2].Value {
		return ComboTriple, component.GetCardWeight(cards[0].Value)
	}

	// 三带一
	if cardCount == 4 {
		// 炸弹
		if cards[0].Value == cards[1].Value && cards[1].Value == cards[2].Value && cards[2].Value == cards[3].Value {
			return ComboBomb, component.GetCardWeight(cards[0].Value)
		}

		// 计算每个点数的数量
		valueCounts := make(map[component.CardValue]int)
		for _, card := range cards {
			valueCounts[card.Value]++
		}

		// 寻找三张
		var tripleValue component.CardValue
		for value, count := range valueCounts {
			if count == 3 {
				tripleValue = value
				return ComboTripleSingle, component.GetCardWeight(tripleValue)
			}
		}
	}

	// 三带一对
	if cardCount == 5 {
		// 计算每个点数的数量
		valueCounts := make(map[component.CardValue]int)
		for _, card := range cards {
			valueCounts[card.Value]++
		}

		// 寻找三张和对子
		var tripleValue component.CardValue
		hasPair := false

		for value, count := range valueCounts {
			if count == 3 {
				tripleValue = value
			} else if count == 2 {
				hasPair = true
			}
		}

		if tripleValue != component.ValueUnknown && hasPair {
			return ComboTriplePair, component.GetCardWeight(tripleValue)
		}

		// 顺子 (五张连续单牌)
		if e.isStraight(cards) {
			return ComboStraight, component.GetCardWeight(cards[0].Value)
		}
	}

	// 四带二 (单张)
	if cardCount == 6 {
		// 计算每个点数的数量
		valueCounts := make(map[component.CardValue]int)
		for _, card := range cards {
			valueCounts[card.Value]++
		}

		// 寻找四张
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
			return ComboFourSingles, component.GetCardWeight(fourValue)
		}

		// 寻找四张和一对
		pairCount := 0
		for value, count := range valueCounts {
			if count == 4 {
				fourValue = value
			} else if count == 2 {
				pairCount++
			}
		}

		if fourValue != component.ValueUnknown && pairCount == 1 {
			return ComboFourSingles, component.GetCardWeight(fourValue)
		}

		// 连对 (三对)
		if e.isPairStraight(cards) {
			return ComboPairStraight, component.GetCardWeight(cards[0].Value)
		}
	}

	// 四带二 (对子)
	if cardCount == 8 {
		// 计算每个点数的数量
		valueCounts := make(map[component.CardValue]int)
		for _, card := range cards {
			valueCounts[card.Value]++
		}

		// 寻找四张和两对
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
			return ComboFourPairs, component.GetCardWeight(fourValue)
		}

		// 连对 (四对)
		if e.isPairStraight(cards) {
			return ComboPairStraight, component.GetCardWeight(cards[0].Value)
		}
	}

	// 飞机 (两个连续三张)
	if cardCount == 6 {
		if e.isTripleStraight(cards) {
			return ComboTripleStraight, component.GetCardWeight(cards[0].Value)
		}
	}

	// 飞机带单张
	if cardCount == 8 || cardCount == 10 || cardCount == 12 || cardCount == 15 {
		if tripleCount, baseValue := e.getTripleStraightInfo(cards); tripleCount > 0 {
			// 检查剩余牌数是否正确
			if cardCount == tripleCount*3+tripleCount {
				return ComboTripleStraightSingles, baseValue
			}
		}
	}

	// 飞机带对子
	if cardCount == 10 || cardCount == 15 || cardCount == 20 {
		if tripleCount, baseValue := e.getTripleStraightInfo(cards); tripleCount > 0 {
			// 检查剩余牌数是否正确
			if cardCount == tripleCount*3+tripleCount*2 {
				return ComboTripleStraightPairs, baseValue
			}
		}
	}

	// 顺子 (五张或更多连续单牌)
	if cardCount >= 5 && e.isStraight(cards) {
		return ComboStraight, component.GetCardWeight(cards[0].Value)
	}

	// 连对 (三对或更多连续对牌)
	if cardCount >= 6 && cardCount%2 == 0 && e.isPairStraight(cards) {
		return ComboPairStraight, component.GetCardWeight(cards[0].Value)
	}

	return ComboUnknown, 0
}

// isStraight 判断是否为顺子
func (e *CardEngine) isStraight(cards []component.Card) bool {
	// 顺子不能包含2和王
	for _, card := range cards {
		if card.Value == component.Value2 || card.Value == component.ValueSmallJoker || card.Value == component.ValueBigJoker {
			return false
		}
	}

	// 对牌按点数排序
	sort.Slice(cards, func(i, j int) bool {
		return component.GetCardWeight(cards[i].Value) > component.GetCardWeight(cards[j].Value)
	})

	// 检查是否连续
	for i := 0; i < len(cards)-1; i++ {
		if component.GetCardWeight(cards[i].Value)-component.GetCardWeight(cards[i+1].Value) != 1 {
			return false
		}
	}

	return true
}

// isPairStraight 判断是否为连对
func (e *CardEngine) isPairStraight(cards []component.Card) bool {
	// 牌数必须是偶数
	if len(cards)%2 != 0 {
		return false
	}

	// 连对不能包含2和王
	for _, card := range cards {
		if card.Value == component.Value2 || card.Value == component.ValueSmallJoker || card.Value == component.ValueBigJoker {
			return false
		}
	}

	// 对牌按点数排序
	sort.Slice(cards, func(i, j int) bool {
		return component.GetCardWeight(cards[i].Value) > component.GetCardWeight(cards[j].Value)
	})

	// 检查是否每两张都是对子，且对子间连续
	for i := 0; i < len(cards); i += 2 {
		if i+1 >= len(cards) || cards[i].Value != cards[i+1].Value {
			return false
		}

		if i+2 < len(cards) && component.GetCardWeight(cards[i].Value)-component.GetCardWeight(cards[i+2].Value) != 1 {
			return false
		}
	}

	return true
}

// isTripleStraight 判断是否为飞机
func (e *CardEngine) isTripleStraight(cards []component.Card) bool {
	// 牌数必须是3的倍数
	if len(cards)%3 != 0 {
		return false
	}

	// 飞机不能包含2和王
	for _, card := range cards {
		if card.Value == component.Value2 || card.Value == component.ValueSmallJoker || card.Value == component.ValueBigJoker {
			return false
		}
	}

	// 计算每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	// 获取所有点数
	values := make([]component.CardValue, 0, len(valueCounts))
	for value, count := range valueCounts {
		if count != 3 {
			return false
		}
		values = append(values, value)
	}

	// 对点数排序
	sort.Slice(values, func(i, j int) bool {
		return component.GetCardWeight(values[i]) > component.GetCardWeight(values[j])
	})

	// 检查是否连续
	for i := 0; i < len(values)-1; i++ {
		if component.GetCardWeight(values[i])-component.GetCardWeight(values[i+1]) != 1 {
			return false
		}
	}

	return true
}

// getTripleStraightInfo 获取飞机信息
// 返回三张的数量和基础权值
func (e *CardEngine) getTripleStraightInfo(cards []component.Card) (int, int) {
	// 计算每个点数的数量
	valueCounts := make(map[component.CardValue]int)
	for _, card := range cards {
		valueCounts[card.Value]++
	}

	// 找出所有的三张
	triples := make([]component.CardValue, 0)
	for value, count := range valueCounts {
		if count >= 3 {
			triples = append(triples, value)
		}
	}

	// 至少需要两个三张
	if len(triples) < 2 {
		return 0, 0
	}

	// 对三张排序
	sort.Slice(triples, func(i, j int) bool {
		return component.GetCardWeight(triples[i]) > component.GetCardWeight(triples[j])
	})

	// 检查是否连续
	isConsecutive := true
	for i := 0; i < len(triples)-1; i++ {
		if component.GetCardWeight(triples[i])-component.GetCardWeight(triples[i+1]) != 1 {
			isConsecutive = false
			break
		}

		// 飞机不能包含2和王
		if triples[i] == component.Value2 || triples[i] == component.ValueSmallJoker || triples[i] == component.ValueBigJoker {
			isConsecutive = false
			break
		}
	}

	if !isConsecutive {
		return 0, 0
	}

	// 返回三张的数量和基础权值
	return len(triples), component.GetCardWeight(triples[0])
}
