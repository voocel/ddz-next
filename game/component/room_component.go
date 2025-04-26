package component

// RoomStatus 房间状态
type RoomStatus int

const (
	RoomStatusWaiting  RoomStatus = iota // 等待中
	RoomStatusPlaying                    // 游戏中
	RoomStatusFinished                   // 已结束
)

// RoomComponent 房间组件
type RoomComponent struct {
	BaseComponent
	ID          string     // 房间ID
	Name        string     // 房间名称
	OwnerID     int64      // 房主ID
	MaxPlayers  int        // 最大玩家数
	PlayerIDs   []int64    // 玩家ID列表
	BaseScore   int        // 基础分数
	Status      RoomStatus // 房间状态
	GameCount   int        // 游戏局数
	CurrentGame int        // 当前游戏局数
	IsPrivate   bool       // 是否私密房间
	Password    string     // 房间密码
}

// NewRoomComponent 创建房间组件
func NewRoomComponent() *RoomComponent {
	return &RoomComponent{
		BaseComponent: *NewBaseComponent("Room"),
		MaxPlayers:    6,
		PlayerIDs:     make([]int64, 0),
		BaseScore:     100,
		Status:        RoomStatusWaiting,
		GameCount:     10,
		CurrentGame:   0,
		IsPrivate:     false,
	}
}

// AddPlayerID 添加玩家ID
func (c *RoomComponent) AddPlayerID(playerID int64) bool {
	// 检查房间是否已满
	if len(c.PlayerIDs) >= c.MaxPlayers {
		return false
	}

	// 检查玩家是否已在房间中
	for _, id := range c.PlayerIDs {
		if id == playerID {
			return false
		}
	}

	c.PlayerIDs = append(c.PlayerIDs, playerID)
	return true
}

// RemovePlayerID 移除玩家ID
func (c *RoomComponent) RemovePlayerID(playerID int64) bool {
	for i, id := range c.PlayerIDs {
		if id == playerID {
			// 移除玩家
			c.PlayerIDs = append(c.PlayerIDs[:i], c.PlayerIDs[i+1:]...)

			// 如果移除的是房主，且房间还有其他玩家，则转移房主
			if playerID == c.OwnerID && len(c.PlayerIDs) > 0 {
				c.OwnerID = c.PlayerIDs[0]
			}

			return true
		}
	}
	return false
}

// GetPlayerIDs 获取所有玩家ID
func (c *RoomComponent) GetPlayerIDs() []int64 {
	return c.PlayerIDs
}

// GetPlayerCount 获取玩家数量
func (c *RoomComponent) GetPlayerCount() int {
	return len(c.PlayerIDs)
}

// ContainsPlayer 检查是否包含某玩家
func (c *RoomComponent) ContainsPlayer(playerID int64) bool {
	for _, id := range c.PlayerIDs {
		if id == playerID {
			return true
		}
	}
	return false
}

// SetStatus 设置房间状态
func (c *RoomComponent) SetStatus(status RoomStatus) {
	c.Status = status
}

// IsReady 检查房间是否已准备好开始游戏
func (c *RoomComponent) IsReady() bool {
	// 斗地主需要3个玩家
	return len(c.PlayerIDs) == 3
}

// StartGame 开始游戏
func (c *RoomComponent) StartGame() bool {
	if !c.IsReady() {
		return false
	}

	c.Status = RoomStatusPlaying
	c.CurrentGame++
	return true
}

// EndGame 结束游戏
func (c *RoomComponent) EndGame() {
	c.Status = RoomStatusWaiting

	// 如果已经到达游戏局数限制，则结束房间
	if c.CurrentGame >= c.GameCount {
		c.Status = RoomStatusFinished
	}
}

// SetPassword 设置房间密码
func (c *RoomComponent) SetPassword(password string) {
	c.Password = password
	c.IsPrivate = password != ""
}
