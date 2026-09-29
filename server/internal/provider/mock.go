package provider

import (
	"context"
	"fmt"

	"ovndesigner/server/internal/catalog"
	"ovndesigner/server/internal/inventory"
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

// Inventory 返回一份可绘制到画布的示例拓扑（VPC/子网/实例/安全组/EIP/密钥对/NAT）。
func (p *mockProvider) Inventory(_ context.Context, region string) (*inventory.Graph, error) {
	prefix := fmt.Sprintf("%s-%s", p.vendor, region)
	vpcID := "vpc-" + prefix
	subID := "subnet-" + prefix
	instID := "i-" + prefix
	sgID := "sg-" + prefix
	eipID := "eip-" + prefix
	gwID := "nat-" + prefix
	zone := mockZone(p.vendor, region)
	return &inventory.Graph{
		VPCs: []inventory.VPC{
			{ID: vpcID, Name: "vpc-demo", CIDR: "10.0.0.0/16"},
		},
		Subnets: []inventory.Subnet{
			{ID: subID, Name: "subnet-demo", CIDR: "10.0.1.0/24", Zone: zone, VPCID: vpcID},
		},
		Instances: []inventory.Instance{
			{
				ID:               instID,
				Name:             "ecs-demo",
				ImageID:          "img-" + p.vendor + "-ubuntu2204",
				InstanceType:     "std.large",
				ChargeType:       "payAsYouGo",
				PrivateIP:        "10.0.1.10",
				Zone:             zone,
				VPCID:            vpcID,
				SubnetID:         subID,
				SecurityGroupIDs: []string{sgID},
				KeyPair:          "kp-demo",
				SystemDisk:       &inventory.Disk{Type: mockDisk(p.vendor), Size: 40},
			},
		},
		SecurityGroups: []inventory.SecurityGroup{
			{
				ID:    sgID,
				Name:  "sg-demo",
				VPCID: vpcID,
				Rules: []inventory.SGRule{
					{Direction: "ingress", Protocol: "tcp", Port: "22/22", CIDR: "0.0.0.0/0", Description: "SSH"},
				},
			},
		},
		EIPs: []inventory.EIP{
			{
				ID:                 eipID,
				Name:               "eip-demo",
				Address:            "203.0.113.10",
				Bandwidth:          5,
				InternetChargeType: "payByTraffic",
				InstanceID:         instID,
			},
		},
		Gateways: []inventory.Gateway{
			{ID: gwID, Name: "nat-demo", VPCID: vpcID, SubnetID: subID},
		},
		KeyPairs: []inventory.KeyPair{
			{Name: "kp-demo"},
		},
		RouteTables: []inventory.RouteTable{
			{
				ID:        "rt-" + prefix,
				Name:      "rt-demo",
				VPCID:     vpcID,
				SubnetIDs: []string{subID},
				Routes: []inventory.Route{
					{Destination: "0.0.0.0/0", NextHopType: "NatGateway", NextHop: gwID},
				},
			},
		},
	}, nil
}

func mockZone(vendor, region string) string {
	switch vendor {
	case "tencent":
		return region + "-3"
	case "aws":
		return region + "a"
	case "huawei":
		return region + "a"
	default:
		return region + "-b"
	}
}

func mockDisk(vendor string) string {
	switch vendor {
	case "tencent":
		return "CLOUD_PREMIUM"
	case "aws":
		return "gp3"
	case "huawei":
		return "GPSSD"
	default:
		return "cloud_essd"
	}
}
