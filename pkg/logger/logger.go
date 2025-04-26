package logger

import (
	"os"
	"sync"

	"github.com/yourusername/go-ddz/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var (
	logger *zap.Logger
	sugar  *zap.SugaredLogger
	once   sync.Once
)

// Init 初始化日志
func Init(cfg *config.LogConfig) {
	once.Do(func() {
		// 设置日志级别
		level := getLogLevel(cfg.Level)

		// 设置编码器
		encoderConfig := zap.NewProductionEncoderConfig()
		encoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		encoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder

		var encoder zapcore.Encoder
		if cfg.Format == "json" {
			encoder = zapcore.NewJSONEncoder(encoderConfig)
		} else {
			encoder = zapcore.NewConsoleEncoder(encoderConfig)
		}

		// 设置日志输出
		var writeSyncer zapcore.WriteSyncer
		if cfg.Output == "file" {
			file, _, err := zap.Open(cfg.FilePath)
			if err != nil {
				panic(err)
			}
			writeSyncer = zapcore.AddSync(file)
		} else {
			writeSyncer = zapcore.AddSync(os.Stdout)
		}

		// 创建核心
		core := zapcore.NewCore(encoder, writeSyncer, level)

		// 创建日志记录器
		logger = zap.New(core, zap.AddCaller(), zap.AddCallerSkip(1), zap.AddStacktrace(zapcore.ErrorLevel))
		sugar = logger.Sugar()
	})
}

// getLogLevel 根据配置获取日志级别
func getLogLevel(levelStr string) zapcore.Level {
	switch levelStr {
	case "debug":
		return zapcore.DebugLevel
	case "info":
		return zapcore.InfoLevel
	case "warn":
		return zapcore.WarnLevel
	case "error":
		return zapcore.ErrorLevel
	default:
		return zapcore.InfoLevel
	}
}

// Debug 调试日志
func Debug(msg string, fields ...zap.Field) {
	if logger == nil {
		initDefaultLogger()
	}
	logger.Debug(msg, fields...)
}

// Info 信息日志
func Info(msg string, fields ...zap.Field) {
	if logger == nil {
		initDefaultLogger()
	}
	logger.Info(msg, fields...)
}

// Warn 警告日志
func Warn(msg string, fields ...zap.Field) {
	if logger == nil {
		initDefaultLogger()
	}
	logger.Warn(msg, fields...)
}

// Error 错误日志
func Error(msg string, fields ...zap.Field) {
	if logger == nil {
		initDefaultLogger()
	}
	logger.Error(msg, fields...)
}

// Fatal 致命错误日志
func Fatal(msg string, fields ...zap.Field) {
	if logger == nil {
		initDefaultLogger()
	}
	logger.Fatal(msg, fields...)
}

// Debugf 格式化调试日志
func Debugf(format string, args ...interface{}) {
	if sugar == nil {
		initDefaultLogger()
	}
	sugar.Debugf(format, args...)
}

// Infof 格式化信息日志
func Infof(format string, args ...interface{}) {
	if sugar == nil {
		initDefaultLogger()
	}
	sugar.Infof(format, args...)
}

// Warnf 格式化警告日志
func Warnf(format string, args ...interface{}) {
	if sugar == nil {
		initDefaultLogger()
	}
	sugar.Warnf(format, args...)
}

// Errorf 格式化错误日志
func Errorf(format string, args ...interface{}) {
	if sugar == nil {
		initDefaultLogger()
	}
	sugar.Errorf(format, args...)
}

// Fatalf 格式化致命错误日志
func Fatalf(format string, args ...interface{}) {
	if sugar == nil {
		initDefaultLogger()
	}
	sugar.Fatalf(format, args...)
}

// Sync 同步日志
func Sync() {
	if logger != nil {
		_ = logger.Sync()
	}
}

// 初始化默认日志记录器
func initDefaultLogger() {
	encoderConfig := zap.NewProductionEncoderConfig()
	encoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	encoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder

	encoder := zapcore.NewConsoleEncoder(encoderConfig)
	writeSyncer := zapcore.AddSync(os.Stdout)
	core := zapcore.NewCore(encoder, writeSyncer, zapcore.DebugLevel)

	logger = zap.New(core, zap.AddCaller(), zap.AddCallerSkip(1), zap.AddStacktrace(zapcore.ErrorLevel))
	sugar = logger.Sugar()
}
