// Package catalog 提供镜像/实例规格清单的统一数据结构、Provider 抽象与 HTTP 接口。
package catalog

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ErrUnsupported 厂商未配置或不支持。
var ErrUnsupported = errors.New("catalog: unsupported vendor")

// Item 归一化后的清单项；zones 为该规格有货的可用区（完整 AZ ID），缺省表示不限制。
type Item struct {
	Value string   `json:"value"`
	Label string   `json:"label"`
	Zones []string `json:"zones,omitempty"`
}

// Provider 一个云厂商的清单来源。
type Provider interface {
	Images(ctx context.Context, region string) ([]Item, error)
	InstanceTypes(ctx context.Context, region string) ([]Item, error)
}

// 与前端 regions.js 的默认地域保持一致
var defaultRegions = map[string]string{
	"tencent": "ap-guangzhou",
	"aliyun":  "cn-hangzhou",
	"aws":     "us-east-1",
	"huawei":  "cn-north-4",
}

// DefaultRegion 返回厂商默认地域。
func DefaultRegion(vendor string) string {
	if r, ok := defaultRegions[vendor]; ok {
		return r
	}
	return ""
}

type cacheEntry struct {
	items   []Item
	expires time.Time
}

// Handler 将各厂商 Provider 暴露为 Gin 路由，并做 TTL 缓存。
type Handler struct {
	providers map[string]Provider
	ttl       time.Duration
	mu        sync.Mutex
	cache     map[string]cacheEntry
	now       func() time.Time
}

// NewHandler 创建清单处理器；ttl <= 0 表示不缓存。
func NewHandler(providers map[string]Provider, ttl time.Duration) *Handler {
	return &Handler{
		providers: providers,
		ttl:       ttl,
		cache:     map[string]cacheEntry{},
		now:       time.Now,
	}
}

// Register 挂载路由：
//
//	GET /api/vendors
//	GET /api/:kind/:vendor            (kind = images | instanceTypes)
//	GET /api/:kind/:vendor/:region
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("/api")
	g.GET("/vendors", h.listVendors)
	g.GET("/:kind/:vendor", h.get)
	g.GET("/:kind/:vendor/:region", h.get)
}

func (h *Handler) listVendors(c *gin.Context) {
	names := make([]string, 0, len(h.providers))
	for name := range h.providers {
		names = append(names, name)
	}
	sort.Strings(names)
	c.JSON(http.StatusOK, gin.H{
		"vendors": names,
		"kinds":   []string{"images", "instanceTypes"},
	})
}

func (h *Handler) get(c *gin.Context) {
	kind := c.Param("kind")
	vendor := c.Param("vendor")
	region := c.Param("region")
	if region == "" {
		region = c.Query("region")
	}
	if region == "" {
		region = DefaultRegion(vendor)
	}

	if kind != "images" && kind != "instanceTypes" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported kind: " + kind})
		return
	}
	provider, ok := h.providers[vendor]
	if !ok {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "vendor not configured: " + vendor})
		return
	}
	if region == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "region is required"})
		return
	}

	items, err := h.load(c.Request.Context(), vendor, kind, region, provider)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":  err.Error(),
			"vendor": vendor,
			"kind":   kind,
			"region": region,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"vendor": vendor,
		"kind":   kind,
		"region": region,
		"items":  items,
	})
}

func (h *Handler) load(ctx context.Context, vendor, kind, region string, p Provider) ([]Item, error) {
	key := vendor + "|" + kind + "|" + region
	if h.ttl > 0 {
		h.mu.Lock()
		if e, ok := h.cache[key]; ok && h.now().Before(e.expires) {
			h.mu.Unlock()
			return e.items, nil
		}
		h.mu.Unlock()
	}

	var (
		items []Item
		err   error
	)
	if kind == "images" {
		items, err = p.Images(ctx, region)
	} else {
		items, err = p.InstanceTypes(ctx, region)
	}
	if err != nil {
		return nil, err
	}

	items = Normalize(items)
	if h.ttl > 0 {
		h.mu.Lock()
		h.cache[key] = cacheEntry{items: items, expires: h.now().Add(h.ttl)}
		h.mu.Unlock()
	}
	return items, nil
}

// Normalize 去空、去重（同 value 合并 zones）、排序，保证输出稳定。
func Normalize(items []Item) []Item {
	index := make(map[string]int, len(items))
	out := make([]Item, 0, len(items))
	for _, it := range items {
		value := strings.TrimSpace(it.Value)
		if value == "" {
			continue
		}
		label := strings.TrimSpace(it.Label)
		if label == "" {
			label = value
		}
		it.Value = value
		it.Label = label
		it.Zones = Dedupe(it.Zones)

		if i, ok := index[value]; ok {
			out[i].Zones = Dedupe(append(out[i].Zones, it.Zones...))
			continue
		}
		index[value] = len(out)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Value < out[j].Value })
	return out
}

// Dedupe 去重并保序。
func Dedupe(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}
