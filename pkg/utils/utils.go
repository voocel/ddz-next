package utils

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"time"
)

func init() {
	// 初始化随机数种子
	rand.Seed(time.Now().UnixNano())
}

// GenerateRandomString 生成指定长度的随机字符串
func GenerateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	return string(b)
}

// MD5 计算字符串的MD5哈希值
func MD5(text string) string {
	hash := md5.New()
	hash.Write([]byte(text))
	return hex.EncodeToString(hash.Sum(nil))
}

// StructToJSON 将结构体转换为JSON字符串
func StructToJSON(v interface{}) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// JSONToStruct 将JSON字符串转换为结构体
func JSONToStruct(jsonStr string, v interface{}) error {
	return json.Unmarshal([]byte(jsonStr), v)
}

// FormatTime 格式化时间
func FormatTime(t time.Time, layout string) string {
	if layout == "" {
		layout = "2006-01-02 15:04:05"
	}
	return t.Format(layout)
}

// ParseTime 解析时间字符串
func ParseTime(timeStr, layout string) (time.Time, error) {
	if layout == "" {
		layout = "2006-01-02 15:04:05"
	}
	return time.Parse(layout, timeStr)
}

// Min 返回两个整数中的最小值
func Min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Max 返回两个整数中的最大值
func Max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// Contains 检查切片是否包含某个元素
func Contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// GenerateUniqueID 生成唯一ID
func GenerateUniqueID() string {
	return fmt.Sprintf("%d%s", time.Now().UnixNano(), GenerateRandomString(8))
}
