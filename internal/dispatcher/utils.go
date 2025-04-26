package dispatcher

// GenerateID 生成唯一ID
func GenerateID() string {
	return generateID()
}

// 生成随机字符串
func RandomString(n int) string {
	return randString(n)
}
