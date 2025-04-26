package database

import (
	"fmt"
	"time"

	"github.com/yourusername/go-ddz/internal/storage/model"
	"github.com/yourusername/go-ddz/pkg/logger"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// 数据库配置
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	Database string
	Charset  string
	MaxIdle  int
	MaxOpen  int
	LogMode  bool
}

var (
	// DB 全局数据库实例
	DB *gorm.DB
)

// Initialize 初始化数据库
func Initialize(config *Config) error {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=%s&parseTime=True&loc=Local",
		config.Username,
		config.Password,
		config.Host,
		config.Port,
		config.Database,
		config.Charset,
	)

	gormConfig := &gorm.Config{
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true, // 使用单数表名
		},
		DisableForeignKeyConstraintWhenMigrating: true, // 禁用外键约束
	}

	// 连接数据库
	db, err := gorm.Open(mysql.Open(dsn), gormConfig)
	if err != nil {
		return fmt.Errorf("连接数据库失败: %w", err)
	}

	// 设置连接池
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("获取数据库连接池失败: %w", err)
	}

	sqlDB.SetMaxIdleConns(config.MaxIdle)
	sqlDB.SetMaxOpenConns(config.MaxOpen)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// 自动迁移
	err = autoMigrate(db)
	if err != nil {
		return fmt.Errorf("自动迁移数据库失败: %w", err)
	}

	DB = db
	logger.Infof("数据库初始化成功，host: %s, database: %s", config.Host, config.Database)
	return nil
}

// Close 关闭数据库连接
func Close() error {
	if DB == nil {
		return nil
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}

	return sqlDB.Close()
}

// GetDB 获取数据库实例
func GetDB() *gorm.DB {
	return DB
}

// autoMigrate 自动迁移数据库
func autoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&model.User{},
		&model.UserStats{},
		&model.UserGameRecord{},
		&model.UserProfile{},
		&model.Room{},
		&model.RoomPlayer{},
		&model.GameRecord{},
		&model.RoomSettings{},
	)
}

// Transaction 事务包装器
func Transaction(fn func(tx *gorm.DB) error) error {
	return DB.Transaction(fn)
}
