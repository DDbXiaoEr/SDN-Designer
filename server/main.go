// OVN-Designer 在线清单服务：代理各云厂商 API，返回镜像/实例规格清单。
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"ovndesigner/server/internal/catalog"
	"ovndesigner/server/internal/config"
	"ovndesigner/server/internal/provider"
	"ovndesigner/server/internal/tfversion"
)

func main() {
	cfg := config.Load()

	providers := provider.Build(cfg)
	handler := catalog.NewHandler(providers, cfg.CacheTTL)
	// Terraform provider 版本清单（公开 Registry，无需凭证，mock 模式返回示例）
	tfVersions := tfversion.NewHandler(cfg.RegistryURL, cfg.CacheTTL, cfg.RequestTimeout, cfg.Mock)

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.Use(cors(cfg.CORSOrigins))

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"vendors": providerNames(providers),
			"mock":    cfg.Mock,
		})
	})
	handler.Register(r)
	tfVersions.Register(r)

	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r}

	go func() {
		log.Printf("catalog server listening on :%s (vendors: %s)", cfg.Port, strings.Join(providerNames(providers), ", "))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// cors 简单跨域中间件：默认允许全部来源，也可通过 CORS_ALLOWED_ORIGINS 白名单限制。
func cors(origins []string) gin.HandlerFunc {
	allowAll := len(origins) == 1 && origins[0] == "*"
	allowed := make(map[string]struct{}, len(origins))
	for _, o := range origins {
		allowed[o] = struct{}{}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if allowAll {
			c.Header("Access-Control-Allow-Origin", "*")
		} else if origin != "" {
			if _, ok := allowed[origin]; ok {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
			}
		}
		c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func providerNames(m map[string]catalog.Provider) []string {
	names := make([]string, 0, len(m))
	for n := range m {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
