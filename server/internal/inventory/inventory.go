// Package inventory 拉取某地域下已有云资源及其关系，供前端绘制到画布。
package inventory

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"ovndesigner/server/internal/catalog"
)

// ErrUnsupported 厂商未配置或不支持库存查询。
var ErrUnsupported = errors.New("inventory: unsupported vendor")

// Disk 云盘（系统盘/数据盘）。
type Disk struct {
	Type string `json:"type"`
	Size int    `json:"size"`
}

// VPC 专有网络。
type VPC struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	CIDR string `json:"cidr"`
}

// Subnet 子网 / 交换机。
type Subnet struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	CIDR  string `json:"cidr"`
	Zone  string `json:"zone"`
	VPCID string `json:"vpcId"`
}

// Instance 云主机。
type Instance struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	ImageID          string   `json:"imageId,omitempty"`
	InstanceType     string   `json:"instanceType,omitempty"`
	ChargeType       string   `json:"chargeType,omitempty"` // subscription | payAsYouGo | spot
	PrivateIP        string   `json:"privateIp,omitempty"`
	Zone             string   `json:"zone,omitempty"`
	VPCID            string   `json:"vpcId,omitempty"`
	SubnetID         string   `json:"subnetId,omitempty"`
	SecurityGroupIDs []string `json:"securityGroupIds,omitempty"`
	KeyPair          string   `json:"keyPair,omitempty"`
	GPU              bool     `json:"gpu,omitempty"`
	SystemDisk       *Disk    `json:"systemDisk,omitempty"`
	DataDisks        []Disk   `json:"dataDisks,omitempty"`
}

// SGRule 安全组规则。
type SGRule struct {
	Direction   string `json:"direction"`
	Protocol    string `json:"protocol"`
	Port        string `json:"port"`
	CIDR        string `json:"cidr"`
	Description string `json:"description,omitempty"`
}

// SecurityGroup 安全组。
type SecurityGroup struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	VPCID string   `json:"vpcId,omitempty"`
	Rules []SGRule `json:"rules,omitempty"`
}

// EIP 弹性公网 IP。
type EIP struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Address            string `json:"address,omitempty"`
	Bandwidth          int    `json:"bandwidth,omitempty"`
	InternetChargeType string `json:"internetChargeType,omitempty"` // payByTraffic | payByBandwidth
	InstanceID         string `json:"instanceId,omitempty"`
	GatewayID          string `json:"gatewayId,omitempty"`
}

// Gateway NAT 网关。
type Gateway struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	VPCID    string `json:"vpcId"`
	SubnetID string `json:"subnetId,omitempty"`
}

// KeyPair 登录密钥对（按名称引用）。
type KeyPair struct {
	Name string `json:"name"`
}

// LBRule 负载均衡监听规则。
type LBRule struct {
	Protocol string   `json:"protocol"`
	Port     string   `json:"port"`
	Backends []string `json:"backends,omitempty"` // 后端实例云上 ID
}

// LoadBalancer 负载均衡。
type LoadBalancer struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Internal  bool     `json:"internal"`
	VPCID     string   `json:"vpcId,omitempty"`
	SubnetIDs []string `json:"subnetIds,omitempty"`
	Rules     []LBRule `json:"rules,omitempty"`
}

// Route 路由条目。
type Route struct {
	Destination string `json:"destination"`
	NextHopType string `json:"nextHopType"` // NatGateway | Instance
	NextHop     string `json:"nextHop,omitempty"`
}

// RouteTable 路由表。
type RouteTable struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	VPCID     string   `json:"vpcId"`
	SubnetIDs []string `json:"subnetIds,omitempty"`
	Routes    []Route  `json:"routes,omitempty"`
}

// Graph 某地域下与实例相关的云资源拓扑。
type Graph struct {
	Vendor         string          `json:"vendor"`
	Region         string          `json:"region"`
	VPCs           []VPC           `json:"vpcs"`
	Subnets        []Subnet        `json:"subnets"`
	Instances      []Instance      `json:"instances"`
	SecurityGroups []SecurityGroup `json:"securityGroups"`
	EIPs           []EIP           `json:"eips"`
	Gateways       []Gateway       `json:"gateways"`
	KeyPairs       []KeyPair       `json:"keyPairs"`
	LoadBalancers  []LoadBalancer  `json:"loadBalancers,omitempty"`
	RouteTables    []RouteTable    `json:"routeTables,omitempty"`
}

// Provider 能按地域返回已有资源拓扑。未实现时接口返回 501。
type Provider interface {
	Inventory(ctx context.Context, region string) (*Graph, error)
}

type cacheEntry struct {
	graph   *Graph
	expires time.Time
}

// Handler 将库存查询暴露为 Gin 路由，并做 TTL 缓存。
type Handler struct {
	providers map[string]Provider
	ttl       time.Duration
	mu        sync.Mutex
	cache     map[string]cacheEntry
	now       func() time.Time
}

// NewHandler 从清单 Provider 中挑出实现了 Inventory 的厂商。
func NewHandler(catalogProviders map[string]catalog.Provider, ttl time.Duration) *Handler {
	out := map[string]Provider{}
	for name, p := range catalogProviders {
		if inv, ok := p.(Provider); ok {
			out[name] = inv
		}
	}
	return &Handler{
		providers: out,
		ttl:       ttl,
		cache:     map[string]cacheEntry{},
		now:       time.Now,
	}
}

// Register 挂载路由（须在 catalog 的 /api/:kind/:vendor 之前注册，避免 kind=inventory 冲突）：
//
//	GET /api/inventory/:vendor
//	GET /api/inventory/:vendor/:region
func (h *Handler) Register(r gin.IRouter) {
	g := r.Group("/api/inventory")
	g.GET("/:vendor", h.get)
	g.GET("/:vendor/:region", h.get)
}

func (h *Handler) get(c *gin.Context) {
	vendor := c.Param("vendor")
	region := c.Param("region")
	if region == "" {
		region = c.Query("region")
	}
	if region == "" {
		region = catalog.DefaultRegion(vendor)
	}
	provider, ok := h.providers[vendor]
	if !ok {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "inventory not supported for vendor: " + vendor})
		return
	}
	if region == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "region is required"})
		return
	}

	graph, err := h.load(c.Request.Context(), vendor, region, provider)
	if err != nil {
		log.Printf("[inventory] %s region=%s upstream error: %v", vendor, region, err)
		c.JSON(http.StatusBadGateway, gin.H{
			"error":  err.Error(),
			"vendor": vendor,
			"region": region,
		})
		return
	}
	c.JSON(http.StatusOK, graph)
}

func (h *Handler) load(ctx context.Context, vendor, region string, p Provider) (*Graph, error) {
	key := vendor + "|" + region
	if h.ttl > 0 {
		h.mu.Lock()
		if e, ok := h.cache[key]; ok && h.now().Before(e.expires) {
			h.mu.Unlock()
			return e.graph, nil
		}
		h.mu.Unlock()
	}

	graph, err := p.Inventory(ctx, region)
	if err != nil {
		return nil, err
	}
	if graph == nil {
		graph = &Graph{}
	}
	graph.Vendor = vendor
	graph.Region = region
	Normalize(graph)

	if h.ttl > 0 {
		h.mu.Lock()
		h.cache[key] = cacheEntry{graph: graph, expires: h.now().Add(h.ttl)}
		h.mu.Unlock()
	}
	return graph, nil
}

// Normalize 去空 ID、补默认空切片、排序，保证输出稳定。
func Normalize(g *Graph) {
	if g == nil {
		return
	}
	g.VPCs = sortVPCs(g.VPCs)
	g.Subnets = sortSubnets(g.Subnets)
	g.Instances = sortInstances(g.Instances)
	g.SecurityGroups = sortSGs(g.SecurityGroups)
	g.EIPs = sortEIPs(g.EIPs)
	g.Gateways = sortGateways(g.Gateways)
	g.KeyPairs = sortKeyPairs(g.KeyPairs)
	g.LoadBalancers = sortLBs(g.LoadBalancers)
	g.RouteTables = sortRTs(g.RouteTables)
}

func trim(s string) string { return strings.TrimSpace(s) }

func sortVPCs(in []VPC) []VPC {
	out := make([]VPC, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.CIDR = trim(it.CIDR)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortSubnets(in []Subnet) []Subnet {
	out := make([]Subnet, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.CIDR = trim(it.CIDR)
		it.Zone = trim(it.Zone)
		it.VPCID = trim(it.VPCID)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortInstances(in []Instance) []Instance {
	out := make([]Instance, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.ImageID = trim(it.ImageID)
		it.InstanceType = trim(it.InstanceType)
		it.ChargeType = trim(it.ChargeType)
		it.PrivateIP = trim(it.PrivateIP)
		it.Zone = trim(it.Zone)
		it.VPCID = trim(it.VPCID)
		it.SubnetID = trim(it.SubnetID)
		it.KeyPair = trim(it.KeyPair)
		it.SecurityGroupIDs = catalog.Dedupe(it.SecurityGroupIDs)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortSGs(in []SecurityGroup) []SecurityGroup {
	out := make([]SecurityGroup, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.VPCID = trim(it.VPCID)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortEIPs(in []EIP) []EIP {
	out := make([]EIP, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.Address = trim(it.Address)
		it.InternetChargeType = trim(it.InternetChargeType)
		it.InstanceID = trim(it.InstanceID)
		it.GatewayID = trim(it.GatewayID)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortGateways(in []Gateway) []Gateway {
	out := make([]Gateway, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.VPCID = trim(it.VPCID)
		it.SubnetID = trim(it.SubnetID)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortKeyPairs(in []KeyPair) []KeyPair {
	out := make([]KeyPair, 0, len(in))
	seen := map[string]struct{}{}
	for _, it := range in {
		it.Name = trim(it.Name)
		if it.Name == "" {
			continue
		}
		if _, ok := seen[it.Name]; ok {
			continue
		}
		seen[it.Name] = struct{}{}
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func sortLBs(in []LoadBalancer) []LoadBalancer {
	out := make([]LoadBalancer, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.VPCID = trim(it.VPCID)
		it.SubnetIDs = catalog.Dedupe(it.SubnetIDs)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortRTs(in []RouteTable) []RouteTable {
	out := make([]RouteTable, 0, len(in))
	for _, it := range in {
		it.ID = trim(it.ID)
		if it.ID == "" {
			continue
		}
		if trim(it.Name) == "" {
			it.Name = it.ID
		} else {
			it.Name = trim(it.Name)
		}
		it.VPCID = trim(it.VPCID)
		it.SubnetIDs = catalog.Dedupe(it.SubnetIDs)
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
