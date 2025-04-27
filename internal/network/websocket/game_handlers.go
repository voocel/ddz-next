package websocket

import (
	"errors"
	"fmt"
	"log"

	"github.com/yourusername/go-ddz/game/entity"
	"github.com/yourusername/go-ddz/game/system"
)

// 添加缺失的路由常量
const (
	// RoutePlayerReady 玩家准备
	RoutePlayerReady = "player_ready"
)

// GameManager 游戏管理接口
type GameManager interface {
	// GenerateUserID 生成唯一用户ID
	GenerateUserID() int64
	// GetOrCreateGameSystem 获取或创建游戏系统
	GetOrCreateGameSystem(roomID string, baseScore int) *system.GameSystem
	// RemoveGameSystem 移除游戏系统
	RemoveGameSystem(roomID string)
	// GetRoomSystem 获取房间系统
	GetRoomSystem() *system.RoomSystem
}

// GameHandlers 游戏消息处理器
type GameHandlers struct {
	gameManager      GameManager
	eventBroadcaster *GameEventBroadcaster
	server           *Server
}

// NewGameHandlers 创建新的游戏处理器并注册消息处理函数
func NewGameHandlers(gameManager GameManager, server *Server) *GameHandlers {
	handlers := &GameHandlers{
		gameManager:      gameManager,
		eventBroadcaster: GetGameEventBroadcaster(),
		server:           server,
	}

	// 注册消息处理函数
	handlers.registerHandlers()

	return handlers
}

// registerHandlers 注册所有消息处理函数
func (h *GameHandlers) registerHandlers() {
	// 系统消息处理
	h.server.RegisterHandlerFunc(CmdPing, h.handleHeartbeat)
	h.server.RegisterHandlerFunc(CmdLogin, h.handleLogin)
	h.server.RegisterHandlerFunc(CmdLogout, h.handleLogout)

	// 房间消息处理
	h.server.RegisterHandlerFunc("create_room", h.handleCreateRoom)
	h.server.RegisterHandlerFunc("join_room", h.handleJoinRoom)
	h.server.RegisterHandlerFunc("leave_room", h.handleLeaveRoom)
	h.server.RegisterHandlerFunc("start_game", h.handleStartGame)
	h.server.RegisterHandlerFunc("room_list", h.handleRoomList)
	h.server.RegisterHandlerFunc("room_info", h.handleRoomInfo)
	h.server.RegisterHandlerFunc("player_ready", h.handlePlayerReady)

	// 斗地主游戏命令处理
	h.server.RegisterHandlerFunc(CmdEnterRoom, h.handleEnterRoom)
	h.server.RegisterHandlerFunc(CmdReady, h.handlePlayerReady)
	h.server.RegisterHandlerFunc(CmdCall, h.handleBid)
	h.server.RegisterHandlerFunc(CmdRob, h.handleRob)
	h.server.RegisterHandlerFunc(CmdPlay, h.handlePlayCards)
	h.server.RegisterHandlerFunc(CmdPass, h.handlePass)
	h.server.RegisterHandlerFunc(CmdTrust, h.handleTrust)
	h.server.RegisterHandlerFunc(CmdReConnect, h.handleReConnect)
}

// 心跳处理
func (h *GameHandlers) handleHeartbeat(message *Message) error {
	// 心跳消息不需要处理，会话活动时间已在接收消息时更新
	return nil
}

// 登录处理
func (h *GameHandlers) handleLogin(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 解析请求数据
	var req struct {
		Username string `json:"username"`
		Avatar   string `json:"avatar"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 生成用户ID
	userID := h.gameManager.GenerateUserID()

	// 创建玩家实体
	playerEntity := entity.NewBaseEntity(userID)

	// 绑定用户信息到会话
	session.SetValue("userID", userID)
	session.SetValue("username", req.Username)
	session.SetValue("avatar", req.Avatar)
	session.SetValue("playerEntity", playerEntity)

	// 绑定用户到会话管理器
	h.server.GetSessionManager().BindUserToSession(userID, session.ID())

	log.Printf("用户 %s (ID: %d) 登录成功", req.Username, userID)

	// 发送登录成功响应
	response := NewServerPushOrEmpty("login_success", map[string]interface{}{
		"success":  true,
		"user_id":  userID,
		"username": req.Username,
		"avatar":   req.Avatar,
		"message":  "登录成功",
	})
	return session.Send(response)
}

// 登出处理
func (h *GameHandlers) handleLogout(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户ID
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 获取用户所在房间
	roomID, ok := h.getSessionRoomID(session.ID())
	if ok {
		// 离开房间
		if err := h.gameManager.GetRoomSystem().LeaveRoom(userID); err != nil {
			log.Printf("用户 %d 离开房间 %s 时出错: %v", userID, roomID, err)
		}

		// 从房间广播器中移除
		roomBroadcaster := GetRoomBroadcaster()
		roomBroadcaster.LeaveRoom(session.ID())
	}

	// 清理会话
	session.RemoveValue("userID")
	session.RemoveValue("username")
	session.RemoveValue("avatar")
	session.RemoveValue("playerEntity")

	log.Printf("用户 %d 登出成功", userID)

	// 发送登出成功响应
	response := NewServerPushOrEmpty("logout_success", map[string]interface{}{
		"success": true,
		"message": "登出成功",
	})
	return session.Send(response)
}

// 创建房间处理
func (h *GameHandlers) handleCreateRoom(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		Name       string `json:"name"`
		Password   string `json:"password"`
		MaxPlayers int    `json:"max_players"`
		BaseScore  int    `json:"base_score"`
		GameCount  int    `json:"game_count"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 创建房间
	options := system.RoomCreateOptions{
		Name:       req.Name,
		Password:   req.Password,
		MaxPlayers: req.MaxPlayers,
		BaseScore:  req.BaseScore,
		GameCount:  req.GameCount,
	}

	room, err := h.gameManager.GetRoomSystem().CreateRoom(userID, options)
	if err != nil {
		return fmt.Errorf("创建房间失败2: %w", err)
	}

	// 确保为每个房间创建一个游戏系统
	h.gameManager.GetOrCreateGameSystem(room.ID, room.BaseScore)

	// 将用户加入到房间广播器
	roomBroadcaster := GetRoomBroadcaster()
	roomBroadcaster.JoinRoom(session.ID(), room.ID)

	log.Printf("用户 %d 创建房间 %s 成功", userID, room.ID)

	// 发送创建房间成功响应
	response := NewServerPushOrEmpty("create_room_success", map[string]interface{}{
		"success": true,
		"room_id": room.ID,
		"message": "房间创建成功",
	})
	return session.Send(response)
}

// 加入房间处理
func (h *GameHandlers) handleJoinRoom(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		RoomID   string `json:"room_id"`
		Password string `json:"password"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 加入房间
	if err := h.gameManager.GetRoomSystem().JoinRoom(req.RoomID, userID, req.Password); err != nil {
		return fmt.Errorf("加入房间失败: %w", err)
	}

	// 获取玩家实体
	playerEntityVal, ok := session.GetValue("playerEntity")
	if !ok {
		return errors.New("玩家实体不存在")
	}

	playerEntity, ok := playerEntityVal.(entity.Entity)
	if !ok {
		return errors.New("无效的玩家实体")
	}

	// 获取房间
	room, err := h.gameManager.GetRoomSystem().GetRoom(req.RoomID)
	if err != nil {
		return fmt.Errorf("获取房间失败: %w", err)
	}

	// 将玩家添加到游戏系统
	gameSystem := h.gameManager.GetOrCreateGameSystem(req.RoomID, room.BaseScore)
	gameSystem.AddPlayer(playerEntity)

	// 将用户加入到房间广播器
	roomBroadcaster := GetRoomBroadcaster()
	roomBroadcaster.JoinRoom(session.ID(), req.RoomID)

	// 获取用户名和头像
	username, _ := session.GetValue("username")
	avatar, _ := session.GetValue("avatar")

	// 广播玩家加入事件
	h.eventBroadcaster.BroadcastPlayerJoin(req.RoomID, PlayerInfo{
		UserID:   userID,
		Username: fmt.Sprintf("%v", username),
		Avatar:   fmt.Sprintf("%v", avatar),
		Ready:    false,
	})

	log.Printf("用户 %d 加入房间 %s 成功", userID, req.RoomID)

	// 发送加入房间成功响应
	response := NewServerPushOrEmpty("join_room_success", map[string]interface{}{
		"success": true,
		"room_id": req.RoomID,
		"message": "成功加入房间",
	})
	return session.Send(response)
}

// 离开房间处理
func (h *GameHandlers) handleLeaveRoom(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		RoomID string `json:"room_id"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 获取玩家实体
	playerEntityVal, ok := session.GetValue("playerEntity")
	if !ok {
		return errors.New("玩家实体不存在")
	}

	playerEntity, ok := playerEntityVal.(entity.Entity)
	if !ok {
		return errors.New("无效的玩家实体")
	}

	// 从游戏系统中移除玩家
	gameSystem := h.gameManager.GetOrCreateGameSystem(req.RoomID, 0)
	gameSystem.RemovePlayer(playerEntity.GetID())

	// 广播玩家离开事件
	h.eventBroadcaster.BroadcastPlayerLeave(req.RoomID, userID)

	// 离开房间
	if err := h.gameManager.GetRoomSystem().LeaveRoom(userID); err != nil {
		return fmt.Errorf("离开房间失败: %w", err)
	}

	// 从房间广播器中移除
	roomBroadcaster := GetRoomBroadcaster()
	roomBroadcaster.LeaveRoom(session.ID())

	log.Printf("用户 %d 离开房间 %s 成功", userID, req.RoomID)

	// 发送离开房间成功响应
	response := NewServerPushOrEmpty("leave_room_success", map[string]interface{}{
		"success": true,
		"message": "成功离开房间",
	})
	return session.Send(response)
}

// 开始游戏处理
func (h *GameHandlers) handleStartGame(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		RoomID string `json:"room_id"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 开始游戏
	if err := h.gameManager.GetRoomSystem().StartGame(req.RoomID, userID); err != nil {
		return fmt.Errorf("开始游戏失败: %w", err)
	}

	// 获取游戏系统
	gameSystem := h.gameManager.GetOrCreateGameSystem(req.RoomID, 0)
	if gameSystem == nil {
		return errors.New("游戏系统不存在")
	}

	// 开始游戏系统
	if !gameSystem.StartGame() {
		return errors.New("启动游戏失败")
	}

	log.Printf("用户 %d 在房间 %s 开始游戏成功", userID, req.RoomID)

	// 发送开始游戏成功响应
	response := NewServerPushOrEmpty("start_game_success", map[string]interface{}{
		"success": true,
		"message": "游戏已开始",
	})
	return session.Send(response)
}

// 房间列表处理
func (h *GameHandlers) handleRoomList(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取可用房间列表
	rooms := h.gameManager.GetRoomSystem().ListAvailableRooms()

	// 构建响应数据
	roomList := make([]map[string]interface{}, 0, len(rooms))
	for _, room := range rooms {
		roomList = append(roomList, map[string]interface{}{
			"room_id":      room.ID,
			"name":         room.Name,
			"is_private":   room.IsPrivate,
			"max_players":  room.MaxPlayers,
			"player_count": room.GetPlayerCount(),
			"base_score":   room.BaseScore,
			"game_count":   room.GameCount,
			"status":       room.Status,
		})
	}

	// 发送房间列表响应
	response := NewServerPushOrEmpty("room_list", map[string]interface{}{
		"success": true,
		"rooms":   roomList,
	})
	return session.Send(response)
}

// 房间信息处理
func (h *GameHandlers) handleRoomInfo(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 解析请求数据
	var req struct {
		RoomID string `json:"room_id"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 获取房间
	room, err := h.gameManager.GetRoomSystem().GetRoom(req.RoomID)
	if err != nil {
		return fmt.Errorf("获取房间失败: %w", err)
	}

	// 构建玩家列表
	players := make([]map[string]interface{}, 0, len(room.Players))
	for playerID, _ := range room.Players {
		playerSession, ok := h.server.GetSessionManager().GetSessionByUserID(playerID)
		if !ok {
			continue
		}

		username, _ := playerSession.GetValue("username")
		avatar, _ := playerSession.GetValue("avatar")

		players = append(players, map[string]interface{}{
			"user_id":  playerID,
			"username": fmt.Sprintf("%v", username),
			"avatar":   fmt.Sprintf("%v", avatar),
			"is_owner": playerID == room.OwnerID,
		})
	}

	// 发送房间信息响应
	response := NewServerPushOrEmpty(TypeRoomInfo, map[string]interface{}{
		"success":     true,
		"room_id":     room.ID,
		"name":        room.Name,
		"owner_id":    room.OwnerID,
		"is_private":  room.IsPrivate,
		"max_players": room.MaxPlayers,
		"base_score":  room.BaseScore,
		"game_count":  room.GameCount,
		"status":      room.Status,
		"players":     players,
	})
	return session.Send(response)
}

// 玩家准备处理
func (h *GameHandlers) handlePlayerReady(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		RoomID string `json:"room_id"`
		Ready  bool   `json:"ready"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// TODO: 更新玩家准备状态
	// 需要通过房间系统提供设置玩家准备状态的API

	// 广播玩家准备状态
	h.eventBroadcaster.BroadcastPlayerReady(req.RoomID, userID, req.Ready)

	// 发送准备成功响应
	response := NewServerPushOrEmpty(TypeReady, map[string]interface{}{
		"success": true,
		"ready":   req.Ready,
	})
	return session.Send(response)
}

// 出牌处理
func (h *GameHandlers) handlePlayCards(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	// 检查用户ID类型 - 我们需要这个检查但不使用userID变量
	if _, ok := userIDVal.(int64); !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		RoomID string `json:"room_id"`
		Cards  []int  `json:"cards"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 获取玩家实体
	playerEntityVal, ok := session.GetValue("playerEntity")
	if !ok {
		return errors.New("玩家实体不存在")
	}

	playerEntity, ok := playerEntityVal.(entity.Entity)
	if !ok {
		return errors.New("无效的玩家实体")
	}

	// 获取游戏系统
	gameSystem := h.gameManager.GetOrCreateGameSystem(req.RoomID, 0)
	if gameSystem == nil {
		return errors.New("游戏系统不存在")
	}

	// 出牌
	if err := gameSystem.PlayCards(playerEntity.GetID(), req.Cards); err != nil {
		return fmt.Errorf("出牌失败: %w", err)
	}

	// 发送出牌成功响应
	response := NewServerPushOrEmpty(TypePlay, map[string]interface{}{
		"success": true,
		"message": "出牌成功",
	})
	return session.Send(response)
}

// 过牌处理
func (h *GameHandlers) handlePass(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		RoomID string `json:"room_id"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 获取玩家实体
	playerEntityVal, ok := session.GetValue("playerEntity")
	if !ok {
		return errors.New("玩家实体不存在")
	}

	playerEntity, ok := playerEntityVal.(entity.Entity)
	if !ok {
		return errors.New("无效的玩家实体")
	}

	// 获取游戏系统
	gameSystem := h.gameManager.GetOrCreateGameSystem(req.RoomID, 0)
	if gameSystem == nil {
		return errors.New("游戏系统不存在")
	}

	// 过牌（使用空卡牌数组表示过牌）
	if err := gameSystem.PlayCards(playerEntity.GetID(), []int{}); err != nil {
		return fmt.Errorf("过牌失败: %w", err)
	}

	// 广播过牌事件
	h.eventBroadcaster.BroadcastPlayerPass(req.RoomID, userID)

	// 发送过牌成功响应
	response := NewServerPushOrEmpty(TypePass, map[string]interface{}{
		"success": true,
		"message": "过牌成功",
	})
	return session.Send(response)
}

// 叫分处理
func (h *GameHandlers) handleBid(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	// 检查用户ID类型 - 我们需要这个检查但不使用userID变量
	if _, ok := userIDVal.(int64); !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求数据
	var req struct {
		RoomID string `json:"room_id"`
		Score  int    `json:"score"`
	}

	if err := message.ParseParam(&req); err != nil {
		return fmt.Errorf("解析请求数据失败: %w", err)
	}

	// 获取玩家实体
	playerEntityVal, ok := session.GetValue("playerEntity")
	if !ok {
		return errors.New("玩家实体不存在")
	}

	playerEntity, ok := playerEntityVal.(entity.Entity)
	if !ok {
		return errors.New("无效的玩家实体")
	}

	// 获取游戏系统
	gameSystem := h.gameManager.GetOrCreateGameSystem(req.RoomID, 0)
	if gameSystem == nil {
		return errors.New("游戏系统不存在")
	}

	// 叫分
	if err := gameSystem.CallLandlord(playerEntity.GetID(), req.Score); err != nil {
		return fmt.Errorf("叫分失败: %w", err)
	}

	// 发送叫分成功响应
	response := NewServerPushOrEmpty(TypeCall, map[string]interface{}{
		"success": true,
		"message": "叫分成功",
	})
	return session.Send(response)
}

// 获取会话所在的房间ID
func (h *GameHandlers) getSessionRoomID(sessionID string) (string, bool) {
	roomBroadcaster := GetRoomBroadcaster()
	return roomBroadcaster.GetSessionRoomID(sessionID)
}

// 处理进入斗地主房间
func (h *GameHandlers) handleEnterRoom(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 解析请求参数
	var param EnterRoomParam
	if err := message.ParseParam(&param); err != nil {
		return fmt.Errorf("解析参数失败: %w", err)
	}

	// 验证token (示例实现，实际应有完整的验证逻辑)
	if param.AccessToken == "" {
		return errors.New("无效的访问令牌")
	}

	// 模拟获取用户信息
	userID := int64(10000 + param.FD) // 简单示例，实际应从token中提取
	username := fmt.Sprintf("玩家%d", userID)
	avatar := "default_avatar.png"

	// 绑定用户信息到会话
	session.SetValue("userID", userID)
	session.SetValue("username", username)
	session.SetValue("avatar", avatar)

	// 创建玩家实体
	playerEntity := entity.NewBaseEntity(userID)
	session.SetValue("playerEntity", playerEntity)

	// 绑定用户到会话
	h.server.GetSessionManager().BindUserToSession(userID, session.ID())

	// 房间号处理 (这里简化为相同数字的房间号)
	roomID := fmt.Sprintf("room_%d", param.RoomNo)

	// 先尝试查找房间，不存在则创建
	room, err := h.gameManager.GetRoomSystem().GetRoom(roomID)
	if err != nil {
		// 创建新房间
		options := system.RoomCreateOptions{
			Name:       fmt.Sprintf("房间-%d", param.RoomNo),
			Password:   "",
			MaxPlayers: 3,
			BaseScore:  1,
			GameCount:  10,
		}
		room, err = h.gameManager.GetRoomSystem().CreateRoom(userID, options)
		if err != nil {
			return fmt.Errorf("创建房间失败3: %w", err)
		}

		// 确保为房间创建游戏系统
		h.gameManager.GetOrCreateGameSystem(room.ID, room.BaseScore)
	} else {
		// 加入已有房间
		if err := h.gameManager.GetRoomSystem().JoinRoom(roomID, userID, ""); err != nil {
			return fmt.Errorf("加入房间失败: %w", err)
		}

		// 添加到游戏系统
		gameSystem := h.gameManager.GetOrCreateGameSystem(roomID, room.BaseScore)
		gameSystem.AddPlayer(playerEntity)
	}

	// 加入房间广播器
	roomBroadcaster := GetRoomBroadcaster()
	roomBroadcaster.JoinRoom(session.ID(), roomID)

	// 广播玩家加入事件
	h.eventBroadcaster.BroadcastPlayerJoin(roomID, PlayerInfo{
		UserID:   userID,
		Username: username,
		Avatar:   avatar,
		Ready:    false,
	})

	log.Printf("用户 %d 进入斗地主房间 %s 成功", userID, roomID)

	// 构建房间信息响应
	roomInfo, err := h.buildRoomInfoResponse(roomID, userID)
	if err != nil {
		return fmt.Errorf("构建房间信息失败: %w", err)
	}

	// 发送房间信息响应
	response := NewServerPushOrEmpty(TypeRoomInfo, roomInfo)
	return session.Send(response)
}

// 处理机器人托管
func (h *GameHandlers) handleTrust(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求参数
	var param TrustParam
	if err := message.ParseParam(&param); err != nil {
		return fmt.Errorf("解析参数失败: %w", err)
	}

	// 获取房间ID
	roomID, ok := h.getSessionRoomID(session.ID())
	if !ok {
		return errors.New("用户不在房间中")
	}

	// 广播托管状态
	h.eventBroadcaster.BroadcastPlayerTrust(roomID, userID, param.IsTrust == 1)

	return nil
}

// 处理断线重连
func (h *GameHandlers) handleReConnect(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 获取房间ID
	roomID, ok := h.getSessionRoomID(session.ID())
	if !ok {
		return errors.New("用户不在房间中")
	}

	// 构建房间信息响应
	roomInfo, err := h.buildRoomInfoResponse(roomID, userID)
	if err != nil {
		return fmt.Errorf("构建房间信息失败: %w", err)
	}

	// 发送房间信息响应
	response := NewServerPushOrEmpty(TypeRoomInfo, roomInfo)
	return session.Send(response)
}

// 处理抢地主
func (h *GameHandlers) handleRob(message *Message) error {
	// 获取会话
	session, ok := h.server.GetSessionManager().GetSession(message.SessionID)
	if !ok {
		return errors.New("无效的会话")
	}

	// 获取用户信息
	userIDVal, ok := session.GetValue("userID")
	if !ok {
		return errors.New("用户未登录")
	}

	userID, ok := userIDVal.(int64)
	if !ok {
		return errors.New("无效的用户ID")
	}

	// 解析请求参数
	var param RobParam
	if err := message.ParseParam(&param); err != nil {
		return fmt.Errorf("解析参数失败: %w", err)
	}

	// 获取房间ID
	roomID, ok := h.getSessionRoomID(session.ID())
	if !ok {
		return errors.New("用户不在房间中")
	}

	// 这里简化处理，直接广播抢地主结果
	// 实际应该调用游戏系统的抢地主逻辑
	h.eventBroadcaster.BroadcastCallScore(roomID, userID, param.Point, param.Point)

	return nil
}

// 辅助方法：构建房间信息响应
func (h *GameHandlers) buildRoomInfoResponse(roomID string, userID int64) (*RoomInfoResult, error) {
	room, err := h.gameManager.GetRoomSystem().GetRoom(roomID)
	if err != nil {
		return nil, err
	}

	// 构建玩家列表
	playerInfos := make([]RoomPlayerInfo, 0)

	// 获取玩家ID列表
	// 由于GetPlayers方法返回的是实体列表，需要提取ID
	for _, player := range room.GetPlayers() {
		playerID := player.GetID()
		playerSession, ok := h.server.GetSessionManager().GetSessionByUserID(playerID)
		if !ok {
			continue
		}

		usernameVal, _ := playerSession.GetValue("username")
		avatarVal, _ := playerSession.GetValue("avatar")
		username := fmt.Sprintf("%v", usernameVal)
		avatar := fmt.Sprintf("%v", avatarVal)

		playerInfo := RoomPlayerInfo{
			UID:          playerID,
			Nickname:     username,
			Avatar:       avatar,
			SeatNo:       len(playerInfos), // 简单示例，实际应有固定座位号
			PlayerStatus: 0,                // 默认未准备
			IsOnline:     1,                // 默认在线
			HandCardNum:  0,                // 初始无手牌
		}
		playerInfos = append(playerInfos, playerInfo)
	}

	// 提取房间号，使用字符串ID的后缀数字部分
	var roomNo int
	_, err = fmt.Sscanf(roomID, "room_%d", &roomNo)
	if err != nil {
		roomNo = 1 // 默认房间号
	}

	// 构建房间信息
	result := &RoomInfoResult{
		RoomInfo: struct {
			RoomNo            int `json:"room_no"`
			RoomStatus        int `json:"room_status"`
			RoomOwner         int `json:"room_owner"`
			GameTotalNumber   int `json:"game_total_number"`
			CurRoomGameNumber int `json:"cur_room_game_number"`
		}{
			RoomNo:            roomNo,               // 使用解析的房间号
			RoomStatus:        int(room.Status),     // 转换为int
			RoomOwner:         int(room.OwnerID),    // 转换为int
			GameTotalNumber:   room.GameCount,       // 游戏总局数
			CurRoomGameNumber: room.CurrentGame + 1, // 当前局数 (从1开始显示)
		},
		PlayerInfo: playerInfos,
		UID:        userID,
	}

	return result, nil
}
