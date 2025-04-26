package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

// 类型定义信息
type TypeInfo struct {
	FileName string
	TypeName string
	Line     int
}

func main() {
	// WebSocket模块路径
	wsPath := "../../internal/network/websocket"

	// 获取绝对路径
	absPath, err := filepath.Abs(wsPath)
	if err != nil {
		fmt.Printf("获取路径失败: %v\n", err)
		os.Exit(1)
	}

	// 存储所有类型定义
	typeDefinitions := make(map[string][]TypeInfo)

	// 解析所有Go文件
	fset := token.NewFileSet()
	err = filepath.Walk(absPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// 只处理Go文件
		if !info.IsDir() && strings.HasSuffix(path, ".go") {
			// 解析文件
			f, err := parser.ParseFile(fset, path, nil, 0)
			if err != nil {
				fmt.Printf("解析文件 %s 失败: %v\n", path, err)
				return nil
			}

			// 文件名（不含路径和扩展名）
			fileName := filepath.Base(path)
			fileName = strings.TrimSuffix(fileName, ".go")

			// 查找所有类型定义
			ast.Inspect(f, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.TypeSpec:
					// 记录类型定义
					typeName := x.Name.Name
					position := fset.Position(x.Pos())
					typeInfo := TypeInfo{
						FileName: fileName,
						TypeName: typeName,
						Line:     position.Line,
					}
					typeDefinitions[typeName] = append(typeDefinitions[typeName], typeInfo)
				}
				return true
			})
		}
		return nil
	})

	if err != nil {
		fmt.Printf("遍历目录失败: %v\n", err)
		os.Exit(1)
	}

	// 查找重复定义
	hasDuplicate := false
	for typeName, infos := range typeDefinitions {
		if len(infos) > 1 {
			hasDuplicate = true
			fmt.Printf("类型 '%s' 在多个文件中定义:\n", typeName)
			for _, info := range infos {
				fmt.Printf("  - %s.go 行 %d\n", info.FileName, info.Line)
			}
			fmt.Println()
		}
	}

	// 查找常量重复定义
	constDefinitions := make(map[string][]TypeInfo)
	err = filepath.Walk(absPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// 只处理Go文件
		if !info.IsDir() && strings.HasSuffix(path, ".go") {
			// 解析文件
			f, err := parser.ParseFile(fset, path, nil, 0)
			if err != nil {
				fmt.Printf("解析文件 %s 失败: %v\n", path, err)
				return nil
			}

			// 文件名（不含路径和扩展名）
			fileName := filepath.Base(path)
			fileName = strings.TrimSuffix(fileName, ".go")

			// 查找所有常量定义
			ast.Inspect(f, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.ValueSpec:
					// 只有当父节点是 GenDecl 且 Tok 是 CONST 时才是常量定义
					if gd, ok := n.(*ast.ValueSpec); ok {
						for _, name := range gd.Names {
							constName := name.Name
							position := fset.Position(name.Pos())
							constInfo := TypeInfo{
								FileName: fileName,
								TypeName: constName,
								Line:     position.Line,
							}
							constDefinitions[constName] = append(constDefinitions[constName], constInfo)
						}
					}
				}
				return true
			})
		}
		return nil
	})

	// 查找重复的常量
	for constName, infos := range constDefinitions {
		if len(infos) > 1 {
			hasDuplicate = true
			fmt.Printf("常量 '%s' 在多个文件中定义:\n", constName)
			for _, info := range infos {
				fmt.Printf("  - %s.go 行 %d\n", info.FileName, info.Line)
			}
			fmt.Println()
		}
	}

	if !hasDuplicate {
		fmt.Println("没有发现重复定义的类型或常量")
	} else {
		fmt.Println("===== 重构建议 =====")
		fmt.Println("1. 创建types.go文件统一定义所有核心类型")
		fmt.Println("2. 从其他文件中移除重复定义")
		fmt.Println("3. 确保每个文件只引用types.go中定义的类型")
	}
}
