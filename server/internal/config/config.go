// Package config 从 YAML 文件（及可选的环境变量覆盖）加载服务配置。
// 所有云厂商密钥均可配置，未配置密钥的厂商不会注册，接口返回 501，前端回退本地清单。
package config

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// VendorConfig 单个云厂商的凭证与开关。
type VendorConfig struct {
	Enabled   bool
	AccessKey string
	SecretKey string
	// ProjectID 仅华为云需要（项目级接口）
	ProjectID string
}

// Configured 表示凭证齐全且未被显式禁用。
func (v VendorConfig) Configured() bool {
	return v.Enabled && v.AccessKey != "" && v.SecretKey != ""
}

// Vendors 支持的全部厂商凭证。
type Vendors struct {
	Tencent VendorConfig
	Aliyun  VendorConfig
	AWS     VendorConfig
	Huawei  VendorConfig
}

// Config 服务运行配置（已解析）。
type Config struct {
	Port           string
	CacheTTL       time.Duration
	RequestTimeout time.Duration
	CORSOrigins    []string
	ConfigFile     string
	// RegistryURL Terraform Registry 地址，用于获取各厂商 provider 已发布版本
	RegistryURL string
	// Mock 为 true 时所有厂商返回示例数据，便于无凭证联调
	Mock    bool
	Vendors Vendors
}

// ---- YAML 原始结构（duration 用字符串，便于写成 10m / 20s）----

type fileConfig struct {
	Server  fileServer  `yaml:"server"`
	Vendors fileVendors `yaml:"vendors"`
}

type fileServer struct {
	Port               string   `yaml:"port"`
	CacheTTL           string   `yaml:"cache_ttl"`
	RequestTimeout     string   `yaml:"request_timeout"`
	CORSAllowedOrigins []string `yaml:"cors_allowed_origins"`
	RegistryURL        string   `yaml:"registry_url"`
	Mock               bool     `yaml:"mock"`
}

type fileVendors struct {
	Tencent fileVendor `yaml:"tencent"`
	Aliyun  fileVendor `yaml:"aliyun"`
	AWS     fileVendor `yaml:"aws"`
	Huawei  fileVendor `yaml:"huawei"`
}

type fileVendor struct {
	Enabled   *bool  `yaml:"enabled"` // 未设置时默认 true
	AccessKey string `yaml:"access_key"`
	SecretKey string `yaml:"secret_key"`
	ProjectID string `yaml:"project_id"`
}

// Load 读取 YAML 配置文件（路径来自 -config 参数或 CONFIG_FILE，默认 config.yaml），
// 文件不存在时使用默认值；随后应用环境变量覆盖（环境变量优先，便于容器/CI 注入密钥）。
func Load() Config {
	path := configPath()
	cfg := defaults()

	raw, err := readYAML(path)
	if err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "config: failed to read %s: %v\n", path, err)
	}

	cfg.ConfigFile = path
	if raw != nil {
		applyFile(&cfg, raw)
	}
	applyEnv(&cfg)
	return cfg
}

func configPath() string {
	// 支持 -config=path 与 -config path；未传时回退 CONFIG_FILE 或 config.yaml
	path := ""
	flag.StringVar(&path, "config", "", "path to YAML config file")
	flag.Parse()
	if path != "" {
		return path
	}
	if v := os.Getenv("CONFIG_FILE"); v != "" {
		return v
	}
	return "config.yaml"
}

func defaults() Config {
	return Config{
		Port:           "8080",
		CacheTTL:       10 * time.Minute,
		RequestTimeout: 20 * time.Second,
		CORSOrigins:    []string{"*"},
		RegistryURL:    "https://registry.terraform.io",
		Vendors: Vendors{
			Tencent: VendorConfig{Enabled: true},
			Aliyun:  VendorConfig{Enabled: true},
			AWS:     VendorConfig{Enabled: true},
			Huawei:  VendorConfig{Enabled: true},
		},
	}
}

func readYAML(path string) (*fileConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw fileConfig
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	return &raw, nil
}

func applyFile(cfg *Config, raw *fileConfig) {
	if raw.Server.Port != "" {
		cfg.Port = raw.Server.Port
	}
	if raw.Server.CacheTTL != "" {
		if d, err := time.ParseDuration(raw.Server.CacheTTL); err == nil {
			cfg.CacheTTL = d
		} else {
			fmt.Fprintf(os.Stderr, "config: invalid cache_ttl %q: %v\n", raw.Server.CacheTTL, err)
		}
	}
	if raw.Server.RequestTimeout != "" {
		if d, err := time.ParseDuration(raw.Server.RequestTimeout); err == nil {
			cfg.RequestTimeout = d
		} else {
			fmt.Fprintf(os.Stderr, "config: invalid request_timeout %q: %v\n", raw.Server.RequestTimeout, err)
		}
	}
	if len(raw.Server.CORSAllowedOrigins) > 0 {
		cfg.CORSOrigins = raw.Server.CORSAllowedOrigins
	}
	if raw.Server.RegistryURL != "" {
		cfg.RegistryURL = raw.Server.RegistryURL
	}
	cfg.Mock = raw.Server.Mock

	cfg.Vendors.Tencent = toVendor(raw.Vendors.Tencent)
	cfg.Vendors.Aliyun = toVendor(raw.Vendors.Aliyun)
	cfg.Vendors.AWS = toVendor(raw.Vendors.AWS)
	cfg.Vendors.Huawei = toVendor(raw.Vendors.Huawei)
}

func toVendor(f fileVendor) VendorConfig {
	enabled := true
	if f.Enabled != nil {
		enabled = *f.Enabled
	}
	return VendorConfig{
		Enabled:   enabled,
		AccessKey: f.AccessKey,
		SecretKey: f.SecretKey,
		ProjectID: f.ProjectID,
	}
}

// applyEnv 用环境变量覆盖配置（仅覆盖已设置的非空值）。
func applyEnv(cfg *Config) {
	if v := os.Getenv("PORT"); v != "" {
		cfg.Port = v
	}
	if v := os.Getenv("CACHE_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			cfg.CacheTTL = d
		}
	}
	if v := os.Getenv("REQUEST_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			cfg.RequestTimeout = d
		}
	}
	if v := os.Getenv("CORS_ALLOWED_ORIGINS"); v != "" {
		cfg.CORSOrigins = splitCSV(v)
	}
	if v := os.Getenv("REGISTRY_URL"); v != "" {
		cfg.RegistryURL = v
	}
	if v, ok := os.LookupEnv("MOCK"); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			cfg.Mock = b
		}
	}

	override(&cfg.Vendors.Tencent, "TENCENT_ENABLED", "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "")
	override(&cfg.Vendors.Aliyun, "ALIYUN_ENABLED", "ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET", "")
	override(&cfg.Vendors.AWS, "AWS_ENABLED", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "")
	override(&cfg.Vendors.Huawei, "HUAWEI_ENABLED", "HUAWEI_ACCESS_KEY", "HUAWEI_SECRET_KEY", "HUAWEI_PROJECT_ID")
}

func override(vc *VendorConfig, enabledKey, akKey, skKey, projectKey string) {
	if v, ok := os.LookupEnv(enabledKey); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			vc.Enabled = b
		}
	}
	if v := os.Getenv(akKey); v != "" {
		vc.AccessKey = v
	}
	if v := os.Getenv(skKey); v != "" {
		vc.SecretKey = v
	}
	if projectKey != "" {
		if v := os.Getenv(projectKey); v != "" {
			vc.ProjectID = v
		}
	}
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{"*"}
	}
	return out
}
