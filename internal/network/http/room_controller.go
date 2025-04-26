package http

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/yourusername/go-ddz/game/component"
	"github.com/yourusername/go-ddz/game/entity"
	"github.com/yourusername/go-ddz/game/system"
	"github.com/yourusername/go-ddz/internal/dispatcher"
)

// RoomController 房间控制器
type RoomController struct {
	dispatcher *dispatcher.Dispatcher
	roomSystem *system.RoomSystem
}

// NewRoomController 创建房间控制器
func NewRoomController(dispatcher *dispatcher.Dispatcher) *RoomController {
	return &RoomController{
		dispatcher: dispatcher,
		// 在实际应用中，这里应该从依赖注入获取
		// 这里简单模拟
		roomSystem: nil,
	}
}

// SetRoomSystem 设置房间系统
func (c *RoomController) SetRoomSystem(roomSystem *system.RoomSystem) {
	c.roomSystem = roomSystem
}

// CreateRoomRequest 创建房间请求
type CreateRoomRequest struct {
	Name       string `json:"name"`
	Password   string `json:"password"`
	MaxPlayers int    `json:"max_players"`
	BaseScore  int    `json:"base_score"`
	GameCount  int    `json:"game_count"`
}

// JoinRoomRequest 加入房间请求
type JoinRoomRequest struct {
	Password string `json:"password"`
}

// ReadyRequest 准备请求
type ReadyRequest struct {
	Ready bool `json:"ready"`
}

// ListRooms 列出房间
func (c *RoomController) ListRooms(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	_, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, http.StatusUnauthorized, "未授权访问")
		return
	}

	// 获取查询参数
	pageStr := r.URL.Query().Get("page")
	sizeStr := r.URL.Query().Get("size")
	status := r.URL.Query().Get("status")

	// 解析分页参数
	page := 1
	size := 10

	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
		}
	}

	if sizeStr != "" {
		if s, err := strconv.Atoi(sizeStr); err == nil && s > 0 {
			size = s
		}
	}

	// 获取房间列表
	var rooms []*system.Room
	if status == "waiting" {
		rooms = c.roomSystem.ListAvailableRooms()
	} else {
		rooms = c.roomSystem.ListRooms()
	}

	// 计算分页
	start := (page - 1) * size
	end := start + size
	if start >= len(rooms) {
		start = 0
		end = 0
	}
	if end > len(rooms) {
		end = len(rooms)
	}

	// 分页房间列表
	pagedRooms := rooms[start:end]

	// 转换为API响应格式
	roomsData := make([]H, 0, len(pagedRooms))
	for _, room := range pagedRooms {
		roomsData = append(roomsData, H{
			"room_id":      room.ID,
			"name":         room.Name,
			"owner_id":     room.OwnerID,
			"player_count": room.GetPlayerCount(),
			"max_players":  room.MaxPlayers,
			"status":       stringifyRoomStatus(room.Status),
			"is_private":   room.IsPrivate,
			"base_score":   room.BaseScore,
			"game_count":   room.GameCount,
			"current_game": room.CurrentGame,
		})
	}

	// 返回房间列表
	JSON(w, http.StatusOK, H{
		"code":    0,
		"message": "成功",
		"data": H{
			"total": len(rooms),
			"rooms": roomsData,
		},
	})
}

// CreateRoom 创建房间
func (c *RoomController) CreateRoom(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	userID, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, http.StatusUnauthorized, "未授权访问")
		return
	}

	// 解析请求
	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		Error(w, http.StatusBadRequest, "无效的请求格式")
		return
	}

	// 校验请求参数
	if req.Name == "" {
		Error(w, http.StatusBadRequest, "房间名称不能为空")
		return
	}

	// 创建房间选项
	options := system.RoomCreateOptions{
		Name:       req.Name,
		Password:   req.Password,
		MaxPlayers: req.MaxPlayers,
		BaseScore:  req.BaseScore,
		GameCount:  req.GameCount,
	}

	// 创建房间
	room, err := c.roomSystem.CreateRoom(userID, options)
	if err != nil {
		Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	// 返回房间信息
	JSON(w, http.StatusOK, H{
		"code":    0,
		"message": "创建成功",
		"data": H{
			"room_id":    room.ID,
			"name":       room.Name,
			"is_private": room.IsPrivate,
			"password":   req.Password,
		},
	})
}

// GetRoomDetail 获取房间详情
func (c *RoomController) GetRoomDetail(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	_, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, 1001, "未授权访问")
		return
	}

	// 从路径获取房间ID
	roomID := GetParam(r, "room_id")
	if roomID == "" {
		Error(w, 1002, "缺少房间ID")
		return
	}

	// 获取房间信息
	room, err := c.roomSystem.GetRoom(roomID)
	if err != nil || room == nil {
		Error(w, 3001, "房间不存在")
		return
	}

	// 转换为API响应格式
	players := make([]H, 0, len(room.Players))
	for _, player := range room.GetPlayers() {
		if player == nil {
			continue
		}

		playerComp, err := getPlayerComponent(player)
		if err != nil {
			continue
		}

		players = append(players, H{
			"user_id":  player.GetID(),
			"username": playerComp.Nickname,
			"avatar":   playerComp.Avatar,
			"ready":    playerComp.IsReady,
		})
	}

	// 尝试获取房主名称
	ownerName := ""
	if owner, ok := room.Players[room.OwnerID]; ok {
		if pc, err := getPlayerComponent(owner); err == nil {
			ownerName = pc.Nickname
		}
	}

	// 返回房间详情
	Success(w, "成功", H{
		"room_id":      room.ID,
		"name":         room.Name,
		"owner_id":     room.OwnerID,
		"owner_name":   ownerName,
		"status":       stringifyRoomStatus(room.Status),
		"is_private":   room.IsPrivate,
		"base_score":   room.BaseScore,
		"game_count":   room.GameCount,
		"current_game": room.CurrentGame,
		"create_time":  room.CreateTime.Format(time.RFC3339),
		"players":      players,
	})
}

// JoinRoom 加入房间
func (c *RoomController) JoinRoom(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	userID, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, 1001, "未授权访问")
		return
	}

	// 从路径获取房间ID
	roomID := GetParam(r, "room_id")
	if roomID == "" {
		Error(w, 1002, "缺少房间ID")
		return
	}

	// 解析请求
	var req JoinRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// 如果请求体为空，创建空请求
		req = JoinRoomRequest{}
	}

	// 加入房间
	err := c.roomSystem.JoinRoom(roomID, userID, req.Password)
	if err != nil {
		switch err.Error() {
		case "房间不存在":
			Error(w, 3001, err.Error())
		case "房间已满":
			Error(w, 3002, err.Error())
		case "密码错误":
			Error(w, 3003, err.Error())
		case "玩家已在房间中":
			Error(w, 3004, err.Error())
		default:
			Error(w, 5000, fmt.Sprintf("加入房间失败: %v", err))
		}
		return
	}

	// 获取更新后的房间信息
	room, err := c.roomSystem.GetRoom(roomID)
	if err != nil || room == nil {
		Error(w, 3001, "房间不存在")
		return
	}

	// 转换为API响应格式
	players := make([]H, 0, len(room.Players))
	for _, player := range room.GetPlayers() {
		if player == nil {
			continue
		}

		playerComp, err := getPlayerComponent(player)
		if err != nil {
			continue
		}

		players = append(players, H{
			"user_id":  player.GetID(),
			"username": playerComp.Nickname,
			"avatar":   playerComp.Avatar,
			"ready":    playerComp.IsReady,
		})
	}

	// 返回加入成功响应
	Success(w, "加入成功", H{
		"room_id": room.ID,
		"name":    room.Name,
		"players": players,
	})
}

// LeaveRoom 离开房间
func (c *RoomController) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	userID, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, 1001, "未授权访问")
		return
	}

	// 从路径获取房间ID
	roomID := GetParam(r, "room_id")
	if roomID == "" {
		Error(w, 1002, "缺少房间ID")
		return
	}

	// 离开房间
	err := c.roomSystem.LeaveRoom(userID)
	if err != nil {
		if err.Error() == "玩家不在房间中" {
			Error(w, 3005, err.Error())
		} else {
			Error(w, 5000, fmt.Sprintf("离开房间失败: %v", err))
		}
		return
	}

	// 返回离开成功响应
	Success(w, "已离开房间", nil)
}

// SetReady 设置准备状态
func (c *RoomController) SetReady(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	userID, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, 1001, "未授权访问")
		return
	}

	// 从路径获取房间ID
	roomID := GetParam(r, "room_id")
	if roomID == "" {
		Error(w, 1002, "缺少房间ID")
		return
	}

	// 解析请求
	var req ReadyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		Error(w, 1002, "无效的请求格式")
		return
	}

	// 获取玩家所在房间
	room, err := c.roomSystem.GetRoomByUser(userID)
	if err != nil {
		Error(w, 3005, "玩家不在房间中")
		return
	}

	// 获取玩家实体
	player, ok := room.Players[userID]
	if !ok {
		Error(w, 3005, "玩家不在房间中")
		return
	}

	// 获取玩家组件
	playerComp, err := getPlayerComponent(player)
	if err != nil {
		Error(w, 5000, "设置准备状态失败")
		return
	}

	// 设置准备状态
	playerComp.SetReady(req.Ready)

	// 返回设置成功响应
	if req.Ready {
		Success(w, "准备完成", nil)
	} else {
		Success(w, "取消准备", nil)
	}
}

// StartGame 开始游戏
func (c *RoomController) StartGame(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	userID, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, 1001, "未授权访问")
		return
	}

	// 从路径获取房间ID
	roomID := GetParam(r, "room_id")
	if roomID == "" {
		Error(w, 1002, "缺少房间ID")
		return
	}

	// 开始游戏
	err := c.roomSystem.StartGame(roomID, userID)
	if err != nil {
		switch err.Error() {
		case "非房主无法开始游戏":
			Error(w, 3006, err.Error())
		case "玩家数量不足，无法开始游戏":
			Error(w, 3007, err.Error())
		case "不是所有玩家都已准备":
			Error(w, 3008, err.Error())
		default:
			Error(w, 5000, fmt.Sprintf("开始游戏失败: %v", err))
		}
		return
	}

	// 返回开始游戏成功响应
	Success(w, "游戏开始", nil)
}

// stringifyRoomStatus 将房间状态转换为字符串
func stringifyRoomStatus(status component.RoomStatus) string {
	switch status {
	case component.RoomStatusWaiting:
		return "waiting"
	case component.RoomStatusPlaying:
		return "playing"
	case component.RoomStatusFinished:
		return "finished"
	default:
		return "unknown"
	}
}

// extractParam 从请求路径中提取参数
func extractParam(r *http.Request, name string) string {
	// 由于我们的路由实现比较简单，这里使用一个变通方法
	// 在完整的路由框架中，通常会有专门的API来获取路径参数
	pathParts := splitPath(r.URL.Path)

	for i, part := range pathParts {
		if part == name && i > 0 {
			return pathParts[i-1]
		}
	}

	return ""
}

// splitPath 分割路径
func splitPath(path string) []string {
	return strings.Split(path, "/")
}

// getPlayerComponent 获取玩家组件
func getPlayerComponent(player entity.Entity) (*component.PlayerComponent, error) {
	comp := player.GetComponent("Player")
	if comp == nil {
		return nil, fmt.Errorf("player component not found")
	}

	playerComp, ok := comp.(*component.PlayerComponent)
	if !ok {
		return nil, fmt.Errorf("invalid player component type")
	}

	return playerComp, nil
}
