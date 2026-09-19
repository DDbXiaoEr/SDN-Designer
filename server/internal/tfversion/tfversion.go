// Package tfversion 从 Terraform Registry 获取各云厂商 provider 的已发布版本，
// 供前端工具栏在填写 provider 版本约束时下拉选择。结果带 TTL 缓存，mock 模式返回内置示例。
package tfversion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ErrUnsupported 厂商未登记 Terraform provider。
var ErrUnsupported = errors.New("tfversion: unsupported vendor")

// registryProviders 厂商 -> Terraform Registry provider 地址（namespace/type）。
var registryProviders = map[string]string{
	"aliyun":  "aliyun/alicloud",
	"tencent": "tencentcloudstack/tencentcloud",
	"aws":     "hashicorp/aws",
	"huawei":  "huaweicloud/huaweicloud",
}

// mockVersions mock 模式下返回，避免依赖外网（与前端内置默认约束同一量级）。
var mockVersions = map[string][]string{
	"aliyun":  {"1.220.0", "1.210.0", "1.200.0"},
	"tencent": {"1.81.0", "1.80.0", "1.79.0"},
	"aws":     {"5.0.0", "4.67.0", "4.66.0"},
	"huawei":  {"1.60.0", "1.59.0", "1.58.0"},
}

type cacheEntry struct {
	versions []string
	expires  time.Time
}

// Handler 将各厂商 provider 版本暴露为 Gin 路由，并做 TTL 缓存。
type Handler struct {
	baseURL string
	ttl     time.Duration
	client  *http.Client
	mock    bool
	mu      sync.Mutex
	cache   map[string]cacheEntry
	now     func() time.Time
}

// NewHandler 创建 processor；baseURL 为空时使用官方 Registry，timeout <= 0 时用 20s。
func NewHandler(baseURL string, ttl, timeout time.Duration, mock bool) *Handler {
	if baseURL == "" {
		baseURL = "https://registry.terraform.io"
	}
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &Handler{
		baseURL: strings.TrimRight(baseURL, "/"),
		ttl:     ttl,
		client:  &http.Client{Timeout: timeout},
		mock:    mock,
		cache:   map[string]cacheEntry{},
		now:     time.Now,
	}
}

// Register 挂载路由：
//
//	GET /api/providerVersions            (返回全部厂商的版本)
//	GET /api/providerVersions/:vendor    (返回单个厂商的版本)
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("/api")
	g.GET("/providerVersions", h.list)
	g.GET("/providerVersions/:vendor", h.get)
}

func (h *Handler) list(c *gin.Context) {
	vendors := make([]string, 0, len(registryProviders))
	for name := range registryProviders {
		vendors = append(vendors, name)
	}
	sort.Strings(vendors)

	versions := make(map[string][]string, len(vendors))
	failed := map[string]string{}
	source := "registry"
	if h.mock {
		source = "mock"
	}
	for _, vendor := range vendors {
		vs, err := h.load(c.Request.Context(), vendor)
		if err != nil {
			failed[vendor] = err.Error()
			continue
		}
		versions[vendor] = vs
	}
	c.JSON(http.StatusOK, gin.H{
		"source":   source,
		"vendors":  vendors,
		"versions": versions,
		"errors":   failed,
	})
}

func (h *Handler) get(c *gin.Context) {
	vendor := c.Param("vendor")
	if _, ok := registryProviders[vendor]; !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "unsupported vendor: " + vendor})
		return
	}
	vs, err := h.load(c.Request.Context(), vendor)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error(), "vendor": vendor})
		return
	}
	source := "registry"
	if h.mock {
		source = "mock"
	}
	c.JSON(http.StatusOK, gin.H{
		"vendor":   vendor,
		"source":   source,
		"versions": vs,
	})
}

// load 返回按版本号从新到旧排序的版本列表，命中缓存时直接返回。
func (h *Handler) load(ctx context.Context, vendor string) ([]string, error) {
	if h.mock {
		return sortedVersions(mockVersions[vendor]), nil
	}
	if h.ttl > 0 {
		h.mu.Lock()
		if e, ok := h.cache[vendor]; ok && h.now().Before(e.expires) {
			h.mu.Unlock()
			return e.versions, nil
		}
		h.mu.Unlock()
	}

	versions, err := h.fetch(ctx, vendor)
	if err != nil {
		return nil, err
	}
	if h.ttl > 0 {
		h.mu.Lock()
		h.cache[vendor] = cacheEntry{versions: versions, expires: h.now().Add(h.ttl)}
		h.mu.Unlock()
	}
	return versions, nil
}

func (h *Handler) fetch(ctx context.Context, vendor string) ([]string, error) {
	addr := registryProviders[vendor]
	u := fmt.Sprintf("%s/v1/providers/%s/versions", h.baseURL, addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("registry %s: HTTP %d", addr, resp.StatusCode)
	}

	var payload struct {
		Versions []struct {
			Version string `json:"version"`
		} `json:"versions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	raw := make([]string, 0, len(payload.Versions))
	for _, v := range payload.Versions {
		if v.Version != "" {
			raw = append(raw, v.Version)
		}
	}
	return sortedVersions(raw), nil
}

// sortedVersions 去重并按版本号从新到旧排序。
func sortedVersions(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return compareVersion(out[i], out[j]) > 0 })
	return out
}

// compareVersion 比较两个语义化版本号；返回值 >0 表示 a 比 b 新。
// 仅解析主版本号（最多三段），预发布版本视为小于同主版本号的正式版。
func compareVersion(a, b string) int {
	na, pa := parseVersion(a)
	nb, pb := parseVersion(b)
	for i := 0; i < 3; i++ {
		if na[i] != nb[i] {
			if na[i] > nb[i] {
				return 1
			}
			return -1
		}
	}
	if pa == "" && pb != "" {
		return 1
	}
	if pa != "" && pb == "" {
		return -1
	}
	return strings.Compare(pa, pb)
}

func parseVersion(v string) (nums [3]int, prerelease string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	main := v
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		main = v[:i]
		prerelease = v[i+1:]
	}
	parts := strings.Split(main, ".")
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(parts[i])
		nums[i] = n
	}
	return nums, prerelease
}
