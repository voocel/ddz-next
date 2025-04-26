package model

import (
	"time"
)

// User 用户模型
type User struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Nickname    string    `gorm:"size:32;not null" json:"nickname"`
	Avatar      string    `gorm:"size:255" json:"avatar"`
	Sex         uint8     `gorm:"type:tinyint;default:1" json:"sex"`
	AccessToken string    `gorm:"size:100;not null" json:"access_token,omitempty"`
	ExpireTime  time.Time `gorm:"not null" json:"expire_time,omitempty"`
	Score       int       `gorm:"default:0" json:"score"`
	WinCount    int       `gorm:"default:0" json:"win_count"`
	LoseCount   int       `gorm:"default:0" json:"lose_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TableName 表名
func (User) TableName() string {
	return "users"
}

// UserStats 用户游戏统计
type UserStats struct {
	UserID     uint      `gorm:"primaryKey" json:"user_id"`
	TotalScore int       `gorm:"default:0" json:"total_score"`
	WinCount   int       `gorm:"default:0" json:"win_count"`
	LoseCount  int       `gorm:"default:0" json:"lose_count"`
	PlayTime   int       `gorm:"default:0" json:"play_time"` // 单位分钟
	LastPlay   time.Time `json:"last_play"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// TableName 表名
func (UserStats) TableName() string {
	return "user_stats"
}

// UserGameRecord 用户游戏记录
type UserGameRecord struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	GameID    string    `gorm:"size:50;not null;index" json:"game_id"`
	RoomID    string    `gorm:"size:50;not null" json:"room_id"`
	Role      uint8     `gorm:"type:tinyint;default:0" json:"role"` // 0-农民,1-地主
	Score     int       `gorm:"default:0" json:"score"`
	IsWin     bool      `gorm:"default:false" json:"is_win"`
	PlayTime  int       `gorm:"default:0" json:"play_time"` // 单位秒
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 表名
func (UserGameRecord) TableName() string {
	return "user_game_records"
}

// UserProfile 用户个人信息
type UserProfile struct {
	UserID    uint      `gorm:"primaryKey" json:"user_id"`
	RealName  string    `gorm:"size:32" json:"real_name,omitempty"`
	Phone     string    `gorm:"size:20" json:"phone,omitempty"`
	Email     string    `gorm:"size:100" json:"email,omitempty"`
	Birthday  time.Time `json:"birthday,omitempty"`
	Address   string    `gorm:"size:255" json:"address,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName 表名
func (UserProfile) TableName() string {
	return "user_profiles"
}
