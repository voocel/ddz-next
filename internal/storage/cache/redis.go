package cache

import (
	"context"
	"encoding/json"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/yourusername/go-ddz/pkg/logger"
)

// Redis配置
type RedisConfig struct {
	Addr     string
	Password string
	DB       int
	PoolSize int
}

var (
	// Redis客户端
	client *redis.Client
	// 上下文
	ctx = context.Background()
)

// InitRedis 初始化Redis连接
func InitRedis(config *RedisConfig) error {
	client = redis.NewClient(&redis.Options{
		Addr:     config.Addr,
		Password: config.Password,
		DB:       config.DB,
		PoolSize: config.PoolSize,
	})

	// 测试连接
	_, err := client.Ping(ctx).Result()
	if err != nil {
		return err
	}

	logger.Infof("Redis初始化成功，addr: %s", config.Addr)
	return nil
}

// Close 关闭Redis连接
func Close() error {
	if client != nil {
		return client.Close()
	}
	return nil
}

// GetClient 获取Redis客户端
func GetClient() *redis.Client {
	return client
}

// Get 获取字符串值
func Get(key string) (string, error) {
	return client.Get(ctx, key).Result()
}

// Set 设置字符串值
func Set(key string, value interface{}, expiration time.Duration) error {
	return client.Set(ctx, key, value, expiration).Err()
}

// Delete 删除键
func Delete(key string) error {
	return client.Del(ctx, key).Err()
}

// Exists 检查键是否存在
func Exists(key string) bool {
	result, _ := client.Exists(ctx, key).Result()
	return result > 0
}

// Expire 设置过期时间
func Expire(key string, expiration time.Duration) error {
	return client.Expire(ctx, key, expiration).Err()
}

// GetObject 获取并解析JSON对象
func GetObject(key string, value interface{}) error {
	data, err := client.Get(ctx, key).Result()
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(data), value)
}

// SetObject 将对象序列化为JSON并保存
func SetObject(key string, value interface{}, expiration time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return client.Set(ctx, key, data, expiration).Err()
}

// HashSet 设置哈希表字段
func HashSet(key string, field string, value interface{}) error {
	return client.HSet(ctx, key, field, value).Err()
}

// HashGet 获取哈希表字段
func HashGet(key string, field string) (string, error) {
	return client.HGet(ctx, key, field).Result()
}

// HashGetAll 获取哈希表所有字段和值
func HashGetAll(key string) (map[string]string, error) {
	return client.HGetAll(ctx, key).Result()
}

// HashDelete 删除哈希表字段
func HashDelete(key string, field ...string) error {
	return client.HDel(ctx, key, field...).Err()
}

// SetAdd 添加集合成员
func SetAdd(key string, members ...interface{}) error {
	return client.SAdd(ctx, key, members...).Err()
}

// SetMembers 获取集合所有成员
func SetMembers(key string) ([]string, error) {
	return client.SMembers(ctx, key).Result()
}

// SetRemove 移除集合成员
func SetRemove(key string, members ...interface{}) error {
	return client.SRem(ctx, key, members...).Err()
}

// ListPush 将值推入列表
func ListPush(key string, values ...interface{}) error {
	return client.RPush(ctx, key, values...).Err()
}

// ListPop 从列表中弹出值
func ListPop(key string) (string, error) {
	return client.LPop(ctx, key).Result()
}

// ListRange 获取列表范围内的元素
func ListRange(key string, start, stop int64) ([]string, error) {
	return client.LRange(ctx, key, start, stop).Result()
}

// Publish 发布消息
func Publish(channel string, message interface{}) error {
	return client.Publish(ctx, channel, message).Err()
}

// Subscribe 订阅频道
func Subscribe(channels ...string) *redis.PubSub {
	return client.Subscribe(ctx, channels...)
}
