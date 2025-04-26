package component

// GameMode 游戏模式
type GameMode int

const (
	GameModeClassic  GameMode = iota // 经典模式
	GameModeFriendly                 // 友好模式（新手模式）
	GameModeSpeed                    // 快速模式
	GameModeCustom                   // 自定义模式
)

// DifficultyLevel AI难度等级
type DifficultyLevel int

const (
	DifficultyEasy   DifficultyLevel = iota // 简单
	DifficultyMedium                        // 中等
	DifficultyHard                          // 困难
	DifficultyExpert                        // 专家
)

// GameSettingComponent 游戏设置组件
type GameSettingComponent struct {
	BaseComponent
	GameMode         GameMode               // 游戏模式
	TimeLimit        int                    // 出牌时间限制(秒)
	ShuffleMethod    string                 // 洗牌方法
	EnableJokers     bool                   // 是否启用王牌
	EnableCheat      bool                   // 是否允许作弊模式（调试用）
	AILevel          DifficultyLevel        // AI难度级别
	ScoreMultiplier  float64                // 分数倍率
	AllowRobot       bool                   // 是否允许机器人替代离线玩家
	EnableVoiceChat  bool                   // 是否允许语音聊天
	EnableSpectators bool                   // 是否允许观战
	MaxSpectators    int                    // 最大观战人数
	EnableRematches  bool                   // 是否允许重赛
	CustomRules      map[string]interface{} // 自定义规则
}

// NewGameSettingComponent 创建新的游戏设置组件
func NewGameSettingComponent() *GameSettingComponent {
	return &GameSettingComponent{
		BaseComponent:    *NewBaseComponent("GameSetting"),
		GameMode:         GameModeClassic,
		TimeLimit:        30,
		ShuffleMethod:    "fisher-yates",
		EnableJokers:     true,
		EnableCheat:      false,
		AILevel:          DifficultyMedium,
		ScoreMultiplier:  1.0,
		AllowRobot:       true,
		EnableVoiceChat:  false,
		EnableSpectators: true,
		MaxSpectators:    10,
		EnableRematches:  true,
		CustomRules:      make(map[string]interface{}),
	}
}

// SetGameMode 设置游戏模式
func (g *GameSettingComponent) SetGameMode(mode GameMode) {
	g.GameMode = mode
}

// SetTimeLimit 设置出牌时间限制
func (g *GameSettingComponent) SetTimeLimit(seconds int) {
	g.TimeLimit = seconds
}

// SetAILevel 设置AI难度
func (g *GameSettingComponent) SetAILevel(level DifficultyLevel) {
	g.AILevel = level
}

// EnableJoker 启用或禁用王牌
func (g *GameSettingComponent) EnableJoker(enable bool) {
	g.EnableJokers = enable
}

// SetScoreMultiplier 设置分数倍率
func (g *GameSettingComponent) SetScoreMultiplier(multiplier float64) {
	g.ScoreMultiplier = multiplier
}

// AllowSpectators 设置是否允许观战
func (g *GameSettingComponent) AllowSpectators(allow bool) {
	g.EnableSpectators = allow
}

// SetMaxSpectators 设置最大观战人数
func (g *GameSettingComponent) SetMaxSpectators(max int) {
	g.MaxSpectators = max
}

// AddCustomRule 添加自定义规则
func (g *GameSettingComponent) AddCustomRule(key string, value interface{}) {
	g.CustomRules[key] = value
}

// GetCustomRule 获取自定义规则
func (g *GameSettingComponent) GetCustomRule(key string) (interface{}, bool) {
	value, exists := g.CustomRules[key]
	return value, exists
}

// RemoveCustomRule 移除自定义规则
func (g *GameSettingComponent) RemoveCustomRule(key string) {
	delete(g.CustomRules, key)
}
