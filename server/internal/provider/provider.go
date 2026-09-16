// Package provider 实现各云厂商的清单 Provider，并按配置组装注册表。
package provider

import (
	"ovndesigner/server/internal/catalog"
	"ovndesigner/server/internal/config"
)

// Build 根据配置返回可用的厂商 Provider；未配置密钥的厂商不注册。
// Mock 模式下对所有厂商注册示例数据 Provider。
func Build(cfg config.Config) map[string]catalog.Provider {
	out := map[string]catalog.Provider{}

	set := func(name string, vc config.VendorConfig, mk func(config.VendorConfig) catalog.Provider) {
		if vc.Configured() {
			out[name] = mk(vc)
		}
	}

	set("tencent", cfg.Vendors.Tencent, func(vc config.VendorConfig) catalog.Provider {
		return newTencent(vc, cfg.RequestTimeout)
	})
	set("aliyun", cfg.Vendors.Aliyun, func(vc config.VendorConfig) catalog.Provider {
		return newAliyun(vc)
	})
	set("aws", cfg.Vendors.AWS, func(vc config.VendorConfig) catalog.Provider {
		return newAWS(vc)
	})
	set("huawei", cfg.Vendors.Huawei, func(vc config.VendorConfig) catalog.Provider {
		return newHuawei(vc)
	})

	if cfg.Mock {
		for _, name := range []string{"tencent", "aliyun", "aws", "huawei"} {
			if _, ok := out[name]; !ok {
				out[name] = newMock(name)
			}
		}
	}
	return out
}
