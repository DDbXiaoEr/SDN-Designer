BINARY       ?= bin/server
CONFIG       ?= config.yaml
MOCK_CONFIG  ?= config.example.yaml

.DEFAULT_GOAL := help
.PHONY: help run run-mock build test vet fmt tidy clean

help: ## 显示可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

run: ## 使用 config.yaml 启动（CONFIG=xx.yaml 可覆盖）
	go run . -config $(CONFIG)

run-mock: ## 无凭证联调：加载示例配置并强制 mock（示例数据）
	MOCK=true go run . -config $(MOCK_CONFIG)

build: ## 编译二进制到 bin/server
	go build -trimpath -ldflags "-s -w" -o $(BINARY) .

test: ## 运行测试
	go test ./...

vet: ## 静态检查
	go vet ./...

fmt: ## 格式化代码
	gofmt -w .

tidy: ## 整理 go.mod/go.sum
	go mod tidy

clean: ## 清理构建产物
	rm -rf bin
