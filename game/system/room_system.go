package system

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/yourusername/go-ddz/game/component"
	"github.com/yourusername/go-ddz/game/entity"
	"github.com/yourusername/go-ddz/game/event"
)

// 房间相关事件
const (
	EventRoomCreated = "room.created"      // 房间创建
	EventRoomClosed  = "room.closed"       // 房间关闭
	EventPlayerJoin  = "room.player_join"  // 玩家加入
	EventPlayerLeave = "room.player_leave" // 玩家离开
	EventPlayerReady = "room.player_ready" // 玩家准备
	EventRoomStart   = "room.start"        // 房间开始游戏
	EventRoomEnd     = "room.end"          // 房间结束游戏
)

// RoomCreateOptions 房间创建选项
type RoomCreateOptions struct {
	Name       string // 房间名称
	Password   string // 房间密码
	MaxPlayers int    // 最大玩家数
	BaseScore  int    // 基础分数
	GameCount  int    // 游戏局数
}

// Room 房间
type Room struct {
	ID          string                  // 房间ID
	Name        string                  // 房间名称
	Password    string                  // 房间密码
	IsPrivate   bool                    // 是否私密房间
	MaxPlayers  int                     // 最大玩家数
	BaseScore   int                     // 基础分数
	GameCount   int                     // 游戏局数
	CurrentGame int                     // 当前游戏局数
	OwnerID     int64                   // 房主ID
	Status      component.RoomStatus    // 房间状态
	Players     map[int64]entity.Entity // 玩家列表
	CreateTime  time.Time               // 创建时间
	StartTime   time.Time               // 开始时间
	RoomEntity  entity.Entity           // 房间实体
	mu          sync.RWMutex            // 读写锁
	eventBus    *event.EventBus         // 事件总线
}

// NewRoom 创建新房间
func NewRoom(id string, ownerID int64, options RoomCreateOptions, eventBus *event.EventBus) *Room {
	// 创建房间实体
	roomEntity := entity.NewBaseEntity(time.Now().UnixNano())

	// 创建房间组件
	roomComp := component.NewRoomComponent()

	// 设置房间参数
	roomComp.ID = id
	roomComp.Name = options.Name
	roomComp.OwnerID = ownerID
	roomComp.MaxPlayers = options.MaxPlayers
	roomComp.BaseScore = options.BaseScore
	roomComp.GameCount = options.GameCount
	roomComp.SetPassword(options.Password)

	// 添加组件到实体
	roomEntity.AddComponent("Room", roomComp)

	return &Room{
		ID:          id,
		Name:        options.Name,
		Password:    options.Password,
		IsPrivate:   options.Password != "",
		MaxPlayers:  options.MaxPlayers,
		BaseScore:   options.BaseScore,
		GameCount:   options.GameCount,
		CurrentGame: 0,
		OwnerID:     ownerID,
		Status:      component.RoomStatusWaiting,
		Players:     make(map[int64]entity.Entity),
		CreateTime:  time.Now(),
		RoomEntity:  roomEntity,
		eventBus:    eventBus,
	}
}

// AddPlayer 添加玩家
func (r *Room) AddPlayer(player entity.Entity) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	playerID := player.GetID()

	// 检查房间状态
	if r.Status != component.RoomStatusWaiting {
		return errors.New("房间不在等待状态，无法加入")
	}

	// 检查房间是否已满
	if len(r.Players) >= r.MaxPlayers {
		return errors.New("房间已满")
	}

	// 检查玩家是否已在房间中
	if _, exists := r.Players[playerID]; exists {
		return errors.New("玩家已在房间中")
	}

	// 获取房间组件并添加玩家
	roomComp := r.RoomEntity.GetComponent("Room").(*component.RoomComponent)
	if !roomComp.AddPlayerID(playerID) {
		return errors.New("添加玩家失败")
	}

	// 添加玩家到房间
	r.Players[playerID] = player

	// 触发玩家加入事件
	r.eventBus.Publish(event.NewBaseEvent(EventPlayerJoin, map[string]interface{}{
		"roomID":   r.ID,
		"playerID": playerID,
	}))

	return nil
}

// RemovePlayer 移除玩家
func (r *Room) RemovePlayer(playerID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 检查玩家是否在房间中
	if _, exists := r.Players[playerID]; !exists {
		return errors.New("玩家不在房间中")
	}

	// 获取房间组件并移除玩家
	roomComp := r.RoomEntity.GetComponent("Room").(*component.RoomComponent)
	roomComp.RemovePlayerID(playerID)

	// 从房间移除玩家
	delete(r.Players, playerID)

	// 触发玩家离开事件
	r.eventBus.Publish(event.NewBaseEvent(EventPlayerLeave, map[string]interface{}{
		"roomID":   r.ID,
		"playerID": playerID,
	}))

	// 如果房间为空，返回提示
	if len(r.Players) == 0 {
		// 触发房间关闭事件
		r.eventBus.Publish(event.NewBaseEvent(EventRoomClosed, map[string]interface{}{
			"roomID": r.ID,
		}))

		return errors.New("房间已空")
	}

	// 如果房主离开，转移房主
	if playerID == r.OwnerID && len(r.Players) > 0 {
		// 随机选择一个新的房主
		for newOwnerID := range r.Players {
			r.OwnerID = newOwnerID
			break
		}
	}

	return nil
}

// IsFull 房间是否已满
func (r *Room) IsFull() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.Players) >= r.MaxPlayers
}

// IsEmpty 房间是否为空
func (r *Room) IsEmpty() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.Players) == 0
}

// GetPlayerCount 获取玩家数量
func (r *Room) GetPlayerCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.Players)
}

// GetPlayers 获取所有玩家
func (r *Room) GetPlayers() []entity.Entity {
	r.mu.RLock()
	defer r.mu.RUnlock()

	players := make([]entity.Entity, 0, len(r.Players))
	for _, player := range r.Players {
		players = append(players, player)
	}

	return players
}

// StartGame 开始游戏
func (r *Room) StartGame() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 检查房间状态
	if r.Status != component.RoomStatusWaiting {
		return ErrGameAlreadyStarted
	}

	// 检查玩家数量
	if len(r.Players) != 3 {
		return errors.New("房间人数不足，需要3人才能开始游戏")
	}

	// 获取房间组件
	roomComp, err := GetRoomComponent(r.RoomEntity)
	if err != nil {
		return err
	}

	// 开始游戏
	if !roomComp.StartGame() {
		return errors.New("房间无法开始游戏")
	}

	// 更新房间状态
	r.Status = component.RoomStatusPlaying
	r.StartTime = time.Now()
	r.CurrentGame++

	// 触发游戏开始事件
	r.eventBus.Publish(event.NewBaseEvent(EventRoomStart, map[string]interface{}{
		"roomID":     r.ID,
		"playerIDs":  r.getPlayerIDs(),
		"baseScore":  r.BaseScore,
		"startTime":  r.StartTime,
		"gameNumber": r.CurrentGame,
	}))

	return nil
}

// getPlayerIDs 获取所有玩家ID
func (r *Room) getPlayerIDs() []int64 {
	playerIDs := make([]int64, 0, len(r.Players))
	for id := range r.Players {
		playerIDs = append(playerIDs, id)
	}
	return playerIDs
}

// EndGame 结束游戏
func (r *Room) EndGame() {
	r.mu.Lock()
	defer r.mu.Unlock()

	// 获取房间组件并结束游戏
	roomComp := r.RoomEntity.GetComponent("Room").(*component.RoomComponent)
	roomComp.EndGame()

	// 更新房间状态
	r.Status = component.RoomStatusWaiting

	// 如果当前游戏局数达到上限，则结束房间
	if r.CurrentGame >= r.GameCount {
		r.Status = component.RoomStatusFinished
	}

	// 触发房间结束游戏事件
	r.eventBus.Publish(event.NewBaseEvent(EventRoomEnd, map[string]interface{}{
		"roomID":      r.ID,
		"currentGame": r.CurrentGame,
		"gameCount":   r.GameCount,
		"isFinished":  r.Status == component.RoomStatusFinished,
	}))
}

// RoomSystem 房间系统
type RoomSystem struct {
	BaseSystem
	rooms      map[string]*Room // 房间列表
	roomByUser map[int64]string // 用户对应的房间ID
	eventBus   *event.EventBus  // 事件总线
	mu         sync.RWMutex     // 读写锁
	roomIDSeed int              // 房间ID种子
}

// NewRoomSystem 创建房间系统
func NewRoomSystem(eventBus *event.EventBus) *RoomSystem {
	return &RoomSystem{
		BaseSystem: *NewBaseSystem(),
		rooms:      make(map[string]*Room),
		roomByUser: make(map[int64]string),
		eventBus:   eventBus,
		roomIDSeed: 1000,
	}
}

// CreateRoom 创建房间
func (s *RoomSystem) CreateRoom(ownerID int64, options RoomCreateOptions) (*Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查玩家是否已经在房间中
	if roomID, exists := s.roomByUser[ownerID]; exists {
		return nil, fmt.Errorf("玩家已经在房间 %s 中", roomID)
	}

	// 生成房间ID
	s.roomIDSeed++
	roomID := fmt.Sprintf("R%d", s.roomIDSeed)

	// 校验选项
	if options.MaxPlayers <= 0 {
		options.MaxPlayers = 3 // 斗地主默认3人
	}
	if options.MaxPlayers < 3 {
		options.MaxPlayers = 3
	}
	if options.BaseScore <= 0 {
		options.BaseScore = 100
	}
	if options.GameCount <= 0 {
		options.GameCount = 10
	}

	// 获取玩家实体
	owner, exists := s.GetEntityByID(ownerID)
	if !exists {
		return nil, errors.New("玩家不存在")
	}

	// 创建新房间
	room := NewRoom(roomID, ownerID, options, s.eventBus)

	// 添加创建者到房间
	if err := room.AddPlayer(owner); err != nil {
		return nil, fmt.Errorf("创建房间失败1: %v", err)
	}

	// 添加房间到系统
	s.rooms[roomID] = room
	s.roomByUser[ownerID] = roomID

	// 触发房间创建事件已在添加玩家时触发

	return room, nil
}

// GetRoom 获取房间
func (s *RoomSystem) GetRoom(roomID string) (*Room, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	room, exists := s.rooms[roomID]
	if !exists {
		return nil, errors.New("房间不存在")
	}

	return room, nil
}

// GetRoomByUser 根据用户ID获取房间
func (s *RoomSystem) GetRoomByUser(userID int64) (*Room, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	roomID, exists := s.roomByUser[userID]
	if !exists {
		return nil, errors.New("玩家不在任何房间中")
	}

	room, exists := s.rooms[roomID]
	if !exists {
		// 清理无效映射
		delete(s.roomByUser, userID)
		return nil, errors.New("房间不存在")
	}

	return room, nil
}

// ListRooms 列出所有房间
func (s *RoomSystem) ListRooms() []*Room {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rooms := make([]*Room, 0, len(s.rooms))
	for _, room := range s.rooms {
		rooms = append(rooms, room)
	}

	return rooms
}

// ListAvailableRooms 列出可用房间
func (s *RoomSystem) ListAvailableRooms() []*Room {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rooms := make([]*Room, 0)
	for _, room := range s.rooms {
		// 只返回等待中且未满的房间
		if room.Status == component.RoomStatusWaiting && !room.IsFull() {
			rooms = append(rooms, room)
		}
	}

	return rooms
}

// JoinRoom 加入房间
func (s *RoomSystem) JoinRoom(roomID string, playerID int64, password string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查玩家是否已经在房间中
	if existingRoomID, exists := s.roomByUser[playerID]; exists {
		if existingRoomID == roomID {
			return errors.New("玩家已经在该房间中")
		}
		return fmt.Errorf("玩家已经在房间 %s 中", existingRoomID)
	}

	// 获取玩家实体
	player, exists := s.GetEntityByID(playerID)
	if !exists {
		return errors.New("玩家不存在")
	}

	// 检查房间是否存在
	room, exists := s.rooms[roomID]
	if !exists {
		return errors.New("房间不存在")
	}

	// 检查密码
	if room.IsPrivate && room.Password != password {
		return errors.New("房间密码错误")
	}

	// 加入房间
	if err := room.AddPlayer(player); err != nil {
		return err
	}

	// 更新映射
	s.roomByUser[playerID] = roomID

	return nil
}

// LeaveRoom 离开房间
func (s *RoomSystem) LeaveRoom(playerID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 获取玩家所在房间
	roomID, exists := s.roomByUser[playerID]
	if !exists {
		return errors.New("玩家不在任何房间中")
	}

	room, exists := s.rooms[roomID]
	if !exists {
		// 清理无效映射
		delete(s.roomByUser, playerID)
		return errors.New("房间不存在")
	}

	// 从房间移除玩家
	err := room.RemovePlayer(playerID)

	// 从映射中移除
	delete(s.roomByUser, playerID)

	// 如果房间为空，移除房间(事件已在RemovePlayer中触发)
	if room.IsEmpty() {
		delete(s.rooms, roomID)
	}

	return err
}

// StartGame 开始游戏
func (s *RoomSystem) StartGame(roomID string, playerID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 获取房间
	room, exists := s.rooms[roomID]
	if !exists {
		return errors.New("房间不存在")
	}

	// 检查是否是房主
	if room.OwnerID != playerID {
		return errors.New("只有房主可以开始游戏")
	}

	// 开始游戏
	return room.StartGame()
}

// EndGame 结束游戏
func (s *RoomSystem) EndGame(roomID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 获取房间
	room, exists := s.rooms[roomID]
	if !exists {
		return errors.New("房间不存在")
	}

	// 结束游戏
	room.EndGame()

	// 如果房间已结束，关闭房间
	if room.Status == component.RoomStatusFinished {
		// 通知所有玩家
		for playerID := range room.Players {
			delete(s.roomByUser, playerID)
		}

		// 从系统中移除房间（结束事件已在EndGame中触发）
		delete(s.rooms, roomID)
	}

	return nil
}

// Update 更新房间系统
func (s *RoomSystem) Update(dt float32) {
	// 加锁防止并发操作
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查并清理空闲房间
	now := time.Now()
	var roomsToRemove []string

	for roomID, room := range s.rooms {
		// 如果房间为空且空闲超过30分钟，标记为移除
		if room.IsEmpty() && now.Sub(room.CreateTime) > 30*time.Minute {
			roomsToRemove = append(roomsToRemove, roomID)
		} else if room.Status == component.RoomStatusPlaying {
			// 检查游戏是否需要超时处理
			// 这里可以添加游戏超时逻辑
		}
	}

	// 移除标记的房间
	for _, roomID := range roomsToRemove {
		// 触发房间关闭事件
		s.eventBus.Publish(event.NewBaseEvent(EventRoomClosed, map[string]interface{}{
			"roomID": roomID,
		}))

		// 从系统中移除房间
		delete(s.rooms, roomID)
	}
}
