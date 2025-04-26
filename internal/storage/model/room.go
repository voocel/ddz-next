package model

import (
	"time"
)

// RoomStatus 房间状态
type RoomStatus uint8

const (
	RoomStatusWaiting  RoomStatus = iota // 等待中
	RoomStatusPlaying                    // 游戏中
	RoomStatusFinished                   // 已结束
)

// Room 房间模型
type Room struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	RoomNo         string     `gorm:"size:20;not null;uniqueIndex" json:"room_no"`
	RoomUUID       string     `gorm:"size:50;not null;uniqueIndex" json:"room_uuid"`
	OwnerID        uint       `gorm:"not null" json:"owner_id"`
	Name           string     `gorm:"size:50;not null" json:"name"`
	Password       string     `gorm:"size:50" json:"password,omitempty"`
	IsPrivate      bool       `gorm:"default:false" json:"is_private"`
	GameCount      uint8      `gorm:"type:tinyint;not null" json:"game_count"`       // 游戏局数
	CurrentCount   uint8      `gorm:"type:tinyint;default:0" json:"current_count"`   // 当前局数
	MaxPlayers     uint8      `gorm:"type:tinyint;default:3" json:"max_players"`     // 最大玩家数
	CurrentPlayers uint8      `gorm:"type:tinyint;default:0" json:"current_players"` // 当前玩家数
	BaseScore      int        `gorm:"default:100" json:"base_score"`                 // 基础分
	Status         RoomStatus `gorm:"type:tinyint;default:0" json:"status"`
	IsEnd          bool       `gorm:"default:false" json:"is_end"`
	StartTime      time.Time  `json:"start_time"`
	EndTime        time.Time  `json:"end_time"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// TableName 表名
func (Room) TableName() string {
	return "rooms"
}

// RoomPlayer 房间玩家关系
type RoomPlayer struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	RoomID    uint      `gorm:"not null;index:idx_room_player" json:"room_id"`
	UserID    uint      `gorm:"not null;index:idx_room_player" json:"user_id"`
	IsReady   bool      `gorm:"default:false" json:"is_ready"`
	Position  uint8     `gorm:"type:tinyint;default:0" json:"position"` // 座位位置
	Role      uint8     `gorm:"type:tinyint;default:0" json:"role"`     // 0-农民,1-地主
	Score     int       `gorm:"default:0" json:"score"`
	IsOnline  bool      `gorm:"default:true" json:"is_online"`
	JoinTime  time.Time `json:"join_time"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName 表名
func (RoomPlayer) TableName() string {
	return "room_players"
}

// GameRecord 游戏记录
type GameRecord struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	GameID     string    `gorm:"size:50;not null;uniqueIndex" json:"game_id"`
	RoomID     uint      `gorm:"not null;index" json:"room_id"`
	LandlordID uint      `gorm:"not null" json:"landlord_id"`               // 地主ID
	WinnerRole uint8     `gorm:"type:tinyint;default:0" json:"winner_role"` // 0-农民,1-地主
	BaseScore  int       `gorm:"default:100" json:"base_score"`
	Multiple   int       `gorm:"default:1" json:"multiple"` // 倍数
	StartTime  time.Time `json:"start_time"`
	EndTime    time.Time `json:"end_time"`
	Duration   int       `gorm:"default:0" json:"duration"`  // 游戏时长(秒)
	GameData   string    `gorm:"type:text" json:"game_data"` // 游戏数据JSON
	CreatedAt  time.Time `json:"created_at"`
}

// TableName 表名
func (GameRecord) TableName() string {
	return "game_records"
}

// RoomSettings 房间设置
type RoomSettings struct {
	RoomID              uint `gorm:"primaryKey" json:"room_id"`
	AllowSpectator      bool `gorm:"default:true" json:"allow_spectator"`     // 允许观战
	AutoReady           bool `gorm:"default:false" json:"auto_ready"`         // 自动准备
	AllowJoinMidway     bool `gorm:"default:true" json:"allow_join_midway"`   // 允许中途加入
	CallTimeout         int  `gorm:"default:30" json:"call_timeout"`          // 叫地主超时(秒)
	PlayTimeout         int  `gorm:"default:30" json:"play_timeout"`          // 出牌超时(秒)
	AutoKickAfterRounds int  `gorm:"default:2" json:"auto_kick_after_rounds"` // 自动踢出不在线玩家的轮数
}

// TableName 表名
func (RoomSettings) TableName() string {
	return "room_settings"
}
