package http

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// HandlerFunc 定义HTTP处理函数
type HandlerFunc func(http.ResponseWriter, *http.Request)

// H 是一个快捷方式，用于创建JSON响应的map
type H map[string]interface{}

// MiddlewareFunc 定义中间件函数
type MiddlewareFunc func(HandlerFunc) HandlerFunc

// Route 表示一个路由
type Route struct {
	Method      string
	Path        string
	Handler     HandlerFunc
	Middlewares []MiddlewareFunc
}

// RouterGroup 路由组，用于路由分组
type RouterGroup struct {
	prefix      string
	middlewares []MiddlewareFunc
	parent      *RouterGroup
	router      *Router
}

// Router 实现HTTP路由器
type Router struct {
	*RouterGroup
	routes []*Route
	// 新增基础URL前缀，用于匹配API文档中的格式
	basePrefix string
}

// NewRouter 创建新的路由器
func NewRouter() *Router {
	router := &Router{
		routes:     make([]*Route, 0),
		basePrefix: "/v1", // 设置API文档中定义的基础URL前缀
	}
	router.RouterGroup = &RouterGroup{
		prefix:      "",
		middlewares: []MiddlewareFunc{},
		router:      router,
	}
	return router
}

// Group 创建路由组
func (group *RouterGroup) Group(prefix string) *RouterGroup {
	return &RouterGroup{
		prefix:      group.prefix + prefix,
		middlewares: group.middlewares,
		parent:      group,
		router:      group.router,
	}
}

// Use 添加中间件
func (group *RouterGroup) Use(middlewares ...MiddlewareFunc) *RouterGroup {
	group.middlewares = append(group.middlewares, middlewares...)
	return group
}

// addRoute 添加路由
func (group *RouterGroup) addRoute(method, path string, handler HandlerFunc, middlewares ...MiddlewareFunc) {
	fullPath := group.router.basePrefix + group.prefix + path

	// 合并中间件
	allMiddlewares := append(group.middlewares, middlewares...)

	// 添加路由到路由器
	group.router.routes = append(group.router.routes, &Route{
		Method:      method,
		Path:        fullPath,
		Handler:     handler,
		Middlewares: allMiddlewares,
	})
}

// Get 添加GET路由
func (group *RouterGroup) Get(path string, handler HandlerFunc, middlewares ...MiddlewareFunc) {
	group.addRoute(http.MethodGet, path, handler, middlewares...)
}

// Post 添加POST路由
func (group *RouterGroup) Post(path string, handler HandlerFunc, middlewares ...MiddlewareFunc) {
	group.addRoute(http.MethodPost, path, handler, middlewares...)
}

// Put 添加PUT路由
func (group *RouterGroup) Put(path string, handler HandlerFunc, middlewares ...MiddlewareFunc) {
	group.addRoute(http.MethodPut, path, handler, middlewares...)
}

// Delete 添加DELETE路由
func (group *RouterGroup) Delete(path string, handler HandlerFunc, middlewares ...MiddlewareFunc) {
	group.addRoute(http.MethodDelete, path, handler, middlewares...)
}

// ServeHTTP 实现http.Handler接口
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	path := req.URL.Path
	method := req.Method

	// 查找匹配的路由
	for _, route := range r.routes {
		// 改进路由匹配逻辑，支持动态路径参数
		if matchRouteParams(route.Path, path) && route.Method == method {
			// 应用中间件
			handler := route.Handler
			for i := len(route.Middlewares) - 1; i >= 0; i-- {
				handler = route.Middlewares[i](handler)
			}

			// 提取路径参数
			params := extractParamsFromPath(route.Path, path)

			// 创建新的请求上下文，包含路径参数
			ctx := req.Context()
			for key, value := range params {
				ctx = contextWithParam(ctx, key, value)
			}

			// 使用新的上下文创建新的请求
			reqWithParams := req.WithContext(ctx)

			// 执行处理函数
			handler(w, reqWithParams)
			return
		}
	}

	// 如果没有找到匹配的路由，返回404
	http.NotFound(w, req)
}

// matchRouteParams 检查路由是否匹配，支持路径参数
func matchRouteParams(pattern, path string) bool {
	patternParts := strings.Split(pattern, "/")
	pathParts := strings.Split(path, "/")

	if len(patternParts) != len(pathParts) {
		return false
	}

	for i := 0; i < len(patternParts); i++ {
		// 处理路径参数 {param} 格式
		if strings.HasPrefix(patternParts[i], "{") && strings.HasSuffix(patternParts[i], "}") {
			// 参数部分，总是匹配
			continue
		}

		if patternParts[i] != pathParts[i] {
			return false
		}
	}

	return true
}

// extractParamsFromPath 从路径中提取参数
func extractParamsFromPath(pattern, path string) map[string]string {
	params := make(map[string]string)

	patternParts := strings.Split(pattern, "/")
	pathParts := strings.Split(path, "/")

	for i := 0; i < len(patternParts); i++ {
		// 检测 {param} 格式的路径参数
		if strings.HasPrefix(patternParts[i], "{") && strings.HasSuffix(patternParts[i], "}") {
			// 提取参数名，去掉花括号
			paramName := patternParts[i][1 : len(patternParts[i])-1]
			params[paramName] = pathParts[i]
		}
	}

	return params
}

// contextWithParam 将参数添加到请求上下文
func contextWithParam(ctx context.Context, key, value string) context.Context {
	// 创建一个带参数值的上下文
	type paramKey string
	return context.WithValue(ctx, paramKey(key), value)
}

// GetParam 从请求中获取路径参数
func GetParam(r *http.Request, name string) string {
	type paramKey string
	// 从上下文中获取参数值
	value := r.Context().Value(paramKey(name))
	if value == nil {
		return r.URL.Query().Get(name)
	}
	return value.(string)
}

// JSON 发送JSON响应
func JSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// ResponseWrapper 统一API响应格式
func ResponseWrapper(w http.ResponseWriter, code int, message string, data interface{}) {
	response := H{
		"code":    code,
		"message": message,
	}

	if data != nil {
		response["data"] = data
	}

	JSON(w, http.StatusOK, response)
}

// Success 发送成功响应
func Success(w http.ResponseWriter, message string, data interface{}) {
	ResponseWrapper(w, 0, message, data)
}

// Error 发送错误响应
func Error(w http.ResponseWriter, status int, message string) {
	ResponseWrapper(w, status, message, nil)
}
