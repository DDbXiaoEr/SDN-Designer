package provider

import (
	"context"

	"ovndesigner/server/internal/catalog"
)

// mockProvider 返回示例数据，用于无凭证联调（MOCK=1）。
type mockProvider struct {
	vendor string
}

func newMock(vendor string) catalog.Provider {
	return &mockProvider{vendor: vendor}
}

func (p *mockProvider) Images(_ context.Context, region string) ([]catalog.Item, error) {
	return []catalog.Item{
		{Value: "img-" + p.vendor + "-ubuntu2204", Label: "Ubuntu 22.04 LTS 64位"},
		{Value: "img-" + p.vendor + "-centos7", Label: "CentOS 7.9 64位"},
		{Value: "img-" + p.vendor + "-windows2022", Label: "Windows Server 2022 数据中心版"},
		{
			Value:   "img-" + p.vendor + "-ubuntu2204-cuda",
			Label:   "Ubuntu 22.04 LTS CUDA 12.4 (NVIDIA Driver)",
			GPU:     true,
			GPUSpec: "NVIDIA T4",
		},
	}, nil
}

func (p *mockProvider) InstanceTypes(_ context.Context, region string) ([]catalog.Item, error) {
	gpu := catalog.Item{
		Value:    "gn6i.xlarge",
		Label:    catalog.GPULabel("gn6i.xlarge (4 vCPU / 15 GiB)", "NVIDIA T4", 1),
		GPU:      true,
		GPUSpec:  "NVIDIA T4",
		GPUCount: 1,
	}
	// 仅腾讯云 ap-guangzhou 演示「部分可用区有货」，与前端内置示例一致
	if p.vendor == "tencent" && region == "ap-guangzhou" {
		gpu.Value = "GN7.2XLARGE32"
		gpu.Label = catalog.GPULabel("GN7.2XLARGE32 (8 vCPU / 32 GiB)", "NVIDIA T4", 1)
		gpu.Zones = []string{"ap-guangzhou-3", "ap-guangzhou-6"}
		return []catalog.Item{
			{Value: "S5.SMALL1", Label: "S5.SMALL1 (1 vCPU / 1 GiB)"},
			{Value: "SA3.MEDIUM4", Label: "SA3.MEDIUM4 (2 vCPU / 4 GiB)", Zones: []string{"ap-guangzhou-5", "ap-guangzhou-6", "ap-guangzhou-7"}},
			{Value: "SA3.LARGE8", Label: "SA3.LARGE8 (2 vCPU / 8 GiB)", Zones: []string{"ap-guangzhou-5", "ap-guangzhou-6", "ap-guangzhou-7"}},
			gpu,
		}, nil
	}
	return []catalog.Item{
		{Value: "std.small", Label: "std.small (1 vCPU / 2 GiB)"},
		{Value: "std.large", Label: "std.large (2 vCPU / 8 GiB)"},
		gpu,
	}, nil
}
