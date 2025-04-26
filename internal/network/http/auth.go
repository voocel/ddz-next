package http

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v4"
)

// 定义JWT相关常量
const (
	// 密钥，实际应用中应该从环境变量或配置文件中读取
	jwtSecret = "go-ddz-secret-key-please-change-in-production"

	// 令牌过期时间，默认7天
	tokenExpireDuration = time.Hour * 24 * 7

	// Bearer认证前缀
	bearerPrefix = "Bearer "
)

// TokenClaims JWT Token的Claims
type TokenClaims struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// GenerateToken 生成JWT令牌
func GenerateToken(userID int64, username string) (string, error) {
	// 设置令牌有效期为7天
	expireTime := time.Now().Add(7 * 24 * time.Hour)

	claims := TokenClaims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expireTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "go-ddz",
		},
	}

	tokenClaims := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token, err := tokenClaims.SignedString([]byte(jwtSecret))

	return token, err
}

// ParseToken 解析JWT令牌
func ParseToken(token string) (*TokenClaims, error) {
	tokenClaims, err := jwt.ParseWithClaims(token, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(jwtSecret), nil
	})

	if err != nil {
		return nil, err
	}

	if tokenClaims != nil {
		if claims, ok := tokenClaims.Claims.(*TokenClaims); ok && tokenClaims.Valid {
			return claims, nil
		}
	}

	return nil, errors.New("无效的令牌")
}

// ExtractTokenFromRequest 从请求中提取令牌
func ExtractTokenFromRequest(r *http.Request) (string, error) {
	// 从Authorization头提取
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" && strings.HasPrefix(authHeader, bearerPrefix) {
		return strings.TrimPrefix(authHeader, bearerPrefix), nil
	}

	// 从URL参数提取
	token := r.URL.Query().Get("token")
	if token != "" {
		return token, nil
	}

	return "", errors.New("no token found")
}

// 上下文键
type contextKey string

const (
	ctxKeyUserID   contextKey = "userID"
	ctxKeyUsername contextKey = "username"
)

// WithUserContext 将用户信息添加到上下文
func WithUserContext(ctx context.Context, userID int64, username string) context.Context {
	ctx = context.WithValue(ctx, ctxKeyUserID, userID)
	ctx = context.WithValue(ctx, ctxKeyUsername, username)
	return ctx
}

// GetUserIDFromContext 从上下文中获取用户ID
func GetUserIDFromContext(ctx context.Context) (int64, bool) {
	userID, ok := ctx.Value(ctxKeyUserID).(int64)
	return userID, ok
}

// GetUsernameFromContext 从上下文中获取用户名
func GetUsernameFromContext(ctx context.Context) (string, bool) {
	username, ok := ctx.Value(ctxKeyUsername).(string)
	return username, ok
}

// GetUserFromRequest 从请求中获取用户信息
func GetUserFromRequest(r *http.Request) (int64, string, bool) {
	// 从上下文中获取用户信息
	userID, ok := r.Context().Value("userID").(int64)
	if !ok {
		return 0, "", false
	}

	username, ok := r.Context().Value("username").(string)
	if !ok {
		return 0, "", false
	}

	return userID, username, true
}

// NewAuthMiddleware 创建新的认证中间件
func NewAuthMiddleware() MiddlewareFunc {
	return func(next HandlerFunc) HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// 从请求头获取Authorization
			auth := r.Header.Get("Authorization")
			if auth == "" {
				Error(w, 1001, "未认证")
				return
			}

			// 提取Bearer令牌
			parts := strings.SplitN(auth, " ", 2)
			if !(len(parts) == 2 && parts[0] == "Bearer") {
				Error(w, 1001, "无效的认证格式")
				return
			}

			// 解析令牌
			token := parts[1]
			claims, err := ParseToken(token)
			if err != nil {
				Error(w, 1001, fmt.Sprintf("无效的令牌: %v", err))
				return
			}

			// 将用户信息存入请求上下文
			ctx := r.Context()
			ctx = context.WithValue(ctx, "userID", claims.UserID)
			ctx = context.WithValue(ctx, "username", claims.Username)

			// 使用新的上下文创建新的请求
			r = r.WithContext(ctx)

			// 继续处理请求
			next(w, r)
		}
	}
}
