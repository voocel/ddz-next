package config

import (
	"fmt"
	"sync"
	"time"

	"github.com/spf13/viper"
)

var (
	instance *Config
	once     sync.Once
)

// Config 全局配置结构体
type Config struct {
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Redis    RedisConfig    `mapstructure:"redis"`
	NATS     NATSConfig     `mapstructure:"nats"`
	Log      LogConfig      `mapstructure:"log"`
	Game     GameConfig     `mapstructure:"game"`
}

// ServerConfig 服务器配置
type ServerConfig struct {
	HTTP      HTTPConfig      `mapstructure:"http"`
	WebSocket WebSocketConfig `mapstructure:"websocket"`
}

// HTTPConfig HTTP服务配置
type HTTPConfig struct {
	Port         int           `mapstructure:"port"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout"`
	IdleTimeout  time.Duration `mapstructure:"idle_timeout"`
}

// WebSocketConfig WebSocket服务配置
type WebSocketConfig struct {
	Port            int           `mapstructure:"port"`
	ReadBufferSize  int           `mapstructure:"read_buffer_size"`
	WriteBufferSize int           `mapstructure:"write_buffer_size"`
	PingInterval    time.Duration `mapstructure:"ping_interval"`
	PingTimeout     time.Duration `mapstructure:"ping_timeout"`
	MaxMessageSize  int64         `mapstructure:"max_message_size"`
}

// DatabaseConfig 数据库配置
type DatabaseConfig struct {
	Driver          string        `mapstructure:"driver"`
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	Username        string        `mapstructure:"username"`
	Password        string        `mapstructure:"password"`
	DBName          string        `mapstructure:"dbname"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
}

// GetDSN 获取数据库连接字符串
func (c *DatabaseConfig) GetDSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		c.Username, c.Password, c.Host, c.Port, c.DBName)
}

// RedisConfig Redis配置
type RedisConfig struct {
	Host         string        `mapstructure:"host"`
	Port         int           `mapstructure:"port"`
	Password     string        `mapstructure:"password"`
	DB           int           `mapstructure:"db"`
	PoolSize     int           `mapstructure:"pool_size"`
	MinIdleConns int           `mapstructure:"min_idle_conns"`
	DialTimeout  time.Duration `mapstructure:"dial_timeout"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout"`
}

// GetAddr 获取Redis地址
func (c *RedisConfig) GetAddr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// NATSConfig NATS配置
type NATSConfig struct {
	URL           string        `mapstructure:"url"`
	MaxReconnects int           `mapstructure:"max_reconnects"`
	ReconnectWait time.Duration `mapstructure:"reconnect_wait"`
}

// LogConfig 日志配置
type LogConfig struct {
	Level    string `mapstructure:"level"`
	Format   string `mapstructure:"format"`
	Output   string `mapstructure:"output"`
	FilePath string `mapstructure:"file_path"`
}

// GameConfig 游戏配置
type GameConfig struct {
	Room RoomConfig `mapstructure:"room"`
	AI   AIConfig   `mapstructure:"ai"`
}

// RoomConfig 房间配置
type RoomConfig struct {
	MaxPlayerCount int           `mapstructure:"max_player_count"`
	ReadyTimeout   time.Duration `mapstructure:"ready_timeout"`
	TurnTimeout    time.Duration `mapstructure:"turn_timeout"`
}

// AIConfig AI配置
type AIConfig struct {
	DifficultyLevel int           `mapstructure:"difficulty_level"`
	ResponseDelay   time.Duration `mapstructure:"response_delay"`
}

// Load 加载配置
func Load(configPath string) (*Config, error) {
	var err error
	once.Do(func() {
		v := viper.New()
		v.SetConfigFile(configPath)

		// 设置默认值
		setDefaultConfig(v)

		// 读取配置文件
		if err = v.ReadInConfig(); err != nil {
			return
		}

		// 解析配置
		instance = &Config{}
		if err = v.Unmarshal(instance); err != nil {
			return
		}
	})

	if err != nil {
		return nil, err
	}
	return instance, nil
}

// GetConfig 获取全局配置
func GetConfig() *Config {
	return instance
}

// 设置默认配置
func setDefaultConfig(v *viper.Viper) {
	// 服务器默认配置
	v.SetDefault("server.http.port", 8080)
	v.SetDefault("server.http.read_timeout", "10s")
	v.SetDefault("server.http.write_timeout", "10s")
	v.SetDefault("server.http.idle_timeout", "60s")

	v.SetDefault("server.websocket.port", 9501)
	v.SetDefault("server.websocket.read_buffer_size", 4096)
	v.SetDefault("server.websocket.write_buffer_size", 4096)
	v.SetDefault("server.websocket.ping_interval", "30s")
	v.SetDefault("server.websocket.ping_timeout", "10s")
	v.SetDefault("server.websocket.max_message_size", 8192)

	// 数据库默认配置
	v.SetDefault("database.driver", "mysql")
	v.SetDefault("database.host", "localhost")
	v.SetDefault("database.port", 3306)
	v.SetDefault("database.username", "root")
	v.SetDefault("database.password", "root")
	v.SetDefault("database.dbname", "go_ddz")
	v.SetDefault("database.max_idle_conns", 10)
	v.SetDefault("database.max_open_conns", 100)
	v.SetDefault("database.conn_max_lifetime", "3600s")

	// Redis默认配置
	v.SetDefault("redis.host", "localhost")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)
	v.SetDefault("redis.pool_size", 100)
	v.SetDefault("redis.min_idle_conns", 10)
	v.SetDefault("redis.dial_timeout", "5s")
	v.SetDefault("redis.read_timeout", "3s")
	v.SetDefault("redis.write_timeout", "3s")

	// NATS默认配置
	v.SetDefault("nats.url", "nats://localhost:4222")
	v.SetDefault("nats.max_reconnects", 10)
	v.SetDefault("nats.reconnect_wait", "5s")

	// 日志默认配置
	v.SetDefault("log.level", "debug")
	v.SetDefault("log.format", "json")
	v.SetDefault("log.output", "stdout")
	v.SetDefault("log.file_path", "./logs/app.log")

	// 游戏默认配置
	v.SetDefault("game.room.max_player_count", 3)
	v.SetDefault("game.room.ready_timeout", "30s")
	v.SetDefault("game.room.turn_timeout", "30s")

	v.SetDefault("game.ai.difficulty_level", 2)
	v.SetDefault("game.ai.response_delay", "1s")
}
