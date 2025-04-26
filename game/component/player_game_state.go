package component

// PlayerRole 玩家角色
type PlayerRole int

const (
	RoleUnknown  PlayerRole = iota // 未知角色
	RoleLandlord                   // 地主
	RoleFarmer                     // 农民
)

// PlayerStatus 玩家状态
type PlayerStatus int

const (
	StatusUnknown PlayerStatus = iota // 未知状态
	StatusWaiting                     // 等待中
	StatusReady                       // 已准备
	StatusPlaying                     // 游戏中
	StatusOffline                     // 离线
)

// PlayerComponent 玩家基本组件
type PlayerComponent struct {
	BaseComponent
	ID       int64        // 玩家ID
	Nickname string       // 昵称
	Avatar   string       // 头像
	Status   PlayerStatus // 状态
	IsAI     bool         // 是否是AI
	IsReady  bool         // 是否准备好
	Position int          // 座位位置
}

// NewPlayerComponent 创建玩家基本组件
func NewPlayerComponent(id int64, nickname, avatar string, isAI bool) *PlayerComponent {
	return &PlayerComponent{
		BaseComponent: *NewBaseComponent("Player"),
		ID:            id,
		Nickname:      nickname,
		Avatar:        avatar,
		Status:        StatusWaiting,
		IsAI:          isAI,
		IsReady:       false,
		Position:      0,
	}
}

// SetReady 设置准备状态
func (p *PlayerComponent) SetReady(ready bool) {
	p.IsReady = ready
	if ready {
		p.Status = StatusReady
	} else {
		p.Status = StatusWaiting
	}
}

// GetReady 获取准备状态
func (p *PlayerComponent) GetReady() bool {
	return p.IsReady
}

// SetStatus 设置状态
func (p *PlayerComponent) SetStatus(status PlayerStatus) {
	p.Status = status
}

// IsPlaying 是否正在游戏中
func (p *PlayerComponent) IsPlaying() bool {
	return p.Status == StatusPlaying
}

// IsOffline 是否离线
func (p *PlayerComponent) IsOffline() bool {
	return p.Status == StatusOffline
}

// SetPosition 设置座位位置
func (p *PlayerComponent) SetPosition(position int) {
	p.Position = position
}

// Reset 重置玩家状态
func (p *PlayerComponent) Reset() {
	p.Status = StatusWaiting
	p.IsReady = false
}

// PlayerGameStateComponent 玩家游戏状态组件
type PlayerGameStateComponent struct {
	BaseComponent
	Role       PlayerRole // 玩家角色
	CallScore  int        // 叫地主分数
	Score      int        // 本局得分
	TotalScore int        // 总得分
}

// NewPlayerGameStateComponent 创建玩家游戏状态组件
func NewPlayerGameStateComponent() *PlayerGameStateComponent {
	return &PlayerGameStateComponent{
		BaseComponent: *NewBaseComponent("GameState"),
		Role:          RoleUnknown,
		CallScore:     -1, // -1表示未叫分
		Score:         0,
		TotalScore:    0,
	}
}

// SetRole 设置角色
func (c *PlayerGameStateComponent) SetRole(role PlayerRole) {
	c.Role = role
}

// GetRole 获取角色
func (c *PlayerGameStateComponent) GetRole() PlayerRole {
	return c.Role
}

// IsLandlord 是否是地主
func (c *PlayerGameStateComponent) IsLandlord() bool {
	return c.Role == RoleLandlord
}

// SetCallScore 设置叫分
func (c *PlayerGameStateComponent) SetCallScore(score int) {
	c.CallScore = score
}

// GetCallScore 获取叫分
func (c *PlayerGameStateComponent) GetCallScore() int {
	return c.CallScore
}

// SetScore 设置得分
func (c *PlayerGameStateComponent) SetScore(score int) {
	c.Score = score
	c.TotalScore += score
}

// GetScore 获取得分
func (c *PlayerGameStateComponent) GetScore() int {
	return c.Score
}

// GetTotalScore 获取总得分
func (c *PlayerGameStateComponent) GetTotalScore() int {
	return c.TotalScore
}

// Reset 重置状态
func (c *PlayerGameStateComponent) Reset() {
	c.Role = RoleUnknown
	c.CallScore = -1
	c.Score = 0
}

// ResetAll 完全重置状态（包括总分）
func (c *PlayerGameStateComponent) ResetAll() {
	c.Reset()
	c.TotalScore = 0
}
