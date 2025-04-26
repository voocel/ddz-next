package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/yourusername/go-ddz/internal/dispatcher"
)

// UserController 用户控制器
type UserController struct {
	dispatcher *dispatcher.Dispatcher
	// 在实际应用中，这里应该有用户服务或数据访问层
}

// NewUserController 创建用户控制器
func NewUserController(dispatcher *dispatcher.Dispatcher) *UserController {
	return &UserController{
		dispatcher: dispatcher,
	}
}

// RegisterRequest 用户注册请求
type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Avatar   string `json:"avatar"`
}

// LoginRequest 用户登录请求
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Register 用户注册
func (c *UserController) Register(w http.ResponseWriter, r *http.Request) {
	// 解析请求
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		Error(w, 1002, "无效的请求格式")
		return
	}

	// 验证请求参数
	if req.Username == "" || req.Password == "" {
		Error(w, 1002, "用户名和密码不能为空")
		return
	}

	// 检查用户名是否已存在
	// 在实际应用中，这里应该调用用户服务或数据访问层
	// 这里简单模拟注册成功

	// 生成用户ID
	userID := time.Now().UnixNano()%10000 + 10000

	// 生成令牌
	token, err := GenerateToken(userID, req.Username)
	if err != nil {
		Error(w, 5001, "生成令牌失败")
		return
	}

	// 返回注册成功响应，使用API文档中定义的格式
	Success(w, "注册成功", H{
		"user_id":  userID,
		"username": req.Username,
		"token":    token,
	})
}

// Login 用户登录
func (c *UserController) Login(w http.ResponseWriter, r *http.Request) {
	// 解析请求
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		Error(w, 1002, "无效的请求格式")
		return
	}

	// 验证请求参数
	if req.Username == "" || req.Password == "" {
		Error(w, 1002, "用户名和密码不能为空")
		return
	}

	// 验证用户名和密码
	// 在实际应用中，这里应该调用用户服务或数据访问层
	// 这里简单模拟登录成功

	// 生成用户ID
	userID := time.Now().UnixNano()%10000 + 10000

	// 生成令牌
	token, err := GenerateToken(userID, req.Username)
	if err != nil {
		Error(w, 5001, "生成令牌失败")
		return
	}

	// 返回登录成功响应，使用API文档中定义的格式
	Success(w, "登录成功", H{
		"user_id":  userID,
		"username": req.Username,
		"avatar":   "https://via.placeholder.com/100",
		"token":    token,
	})
}

// Logout 用户注销
func (c *UserController) Logout(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	_, _, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, 1001, "未授权访问")
		return
	}

	// 在实际应用中，这里应该调用用户服务或数据访问层
	// 使token失效或从用户会话存储中删除会话
	// 这里简单返回成功

	// 返回注销成功响应
	Success(w, "注销成功", nil)
}

// GetProfile 获取用户信息
func (c *UserController) GetProfile(w http.ResponseWriter, r *http.Request) {
	// 从请求中获取用户信息
	userID, username, ok := GetUserFromRequest(r)
	if !ok {
		Error(w, 1001, "未授权访问")
		return
	}

	// 查询用户信息
	// 在实际应用中，这里应该调用用户服务或数据访问层
	// 这里简单模拟用户信息

	// 返回用户信息，使用API文档中定义的格式
	Success(w, "成功", H{
		"user_id":    userID,
		"username":   username,
		"avatar":     "https://via.placeholder.com/100",
		"score":      5000,
		"win_count":  10,
		"lose_count": 5,
		"game_count": 15,
	})
}
