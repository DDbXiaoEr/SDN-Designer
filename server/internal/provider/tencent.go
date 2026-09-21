package provider

import (
	"context"
	"fmt"
	"sort"
	"time"

	"ovndesigner/server/internal/catalog"
	"ovndesigner/server/internal/config"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	cvm "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/cvm/v20170312"
)

// tencentProvider 腾讯云 CVM 清单来源。Client 与地域绑定，故按请求地域构造。
type tencentProvider struct {
	cred *common.Credential
	cpf  *profile.ClientProfile
}

func newTencent(vc config.VendorConfig, timeout time.Duration) catalog.Provider {
	cpf := profile.NewClientProfile()
	cpf.HttpProfile.Endpoint = "cvm.tencentcloudapi.com"
	if timeout > 0 {
		cpf.HttpProfile.ReqTimeout = int(timeout.Seconds())
	}
	return &tencentProvider{
		cred: common.NewCredential(vc.AccessKey, vc.SecretKey),
		cpf:  cpf,
	}
}

func (p *tencentProvider) client(region string) (*cvm.Client, error) {
	return cvm.NewClient(p.cred, region, p.cpf)
}

func (p *tencentProvider) Images(ctx context.Context, region string) ([]catalog.Item, error) {
	client, err := p.client(region)
	if err != nil {
		return nil, fmt.Errorf("tencent client: %w", err)
	}

	const limit = 100
	var items []catalog.Item
	for offset := uint64(0); ; offset += limit {
		req := cvm.NewDescribeImagesRequest()
		req.Filters = []*cvm.Filter{{
			Name:   common.StringPtr("image-type"),
			Values: common.StringPtrs([]string{"PUBLIC_IMAGE"}),
		}}
		req.Offset = common.Uint64Ptr(offset)
		req.Limit = common.Uint64Ptr(limit)

		resp, err := client.DescribeImagesWithContext(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("tencent DescribeImages: %w", err)
		}
		set := resp.Response.ImageSet
		for _, img := range set {
			if img.ImageId == nil {
				continue
			}
			label := tencentImageLabel(img)
			item := catalog.Item{Value: *img.ImageId, Label: label}
			if catalog.LooksLikeGPUImage(label, stringValue(img.OsName), stringValue(img.Platform), stringValue(img.ImageFamily)) {
				item.GPU = true
			}
			items = append(items, item)
		}
		if len(set) < limit {
			break
		}
	}
	return items, nil
}

func (p *tencentProvider) InstanceTypes(ctx context.Context, region string) ([]catalog.Item, error) {
	client, err := p.client(region)
	if err != nil {
		return nil, fmt.Errorf("tencent client: %w", err)
	}

	req := cvm.NewDescribeZoneInstanceConfigInfosRequest()
	resp, err := client.DescribeZoneInstanceConfigInfosWithContext(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("tencent DescribeZoneInstanceConfigInfos: %w", err)
	}

	type agg struct {
		cpu, mem int64
		gpu      int64
		gpuCount float64
		zones    map[string]struct{}
	}
	byType := map[string]*agg{}
	for _, it := range resp.Response.InstanceTypeQuotaSet {
		if it.InstanceType == nil {
			continue
		}
		// 只保留有货（SELL）的条目；zones 自然只包含有货可用区
		if it.Status != nil && *it.Status != "SELL" {
			continue
		}
		a := byType[*it.InstanceType]
		if a == nil {
			a = &agg{zones: map[string]struct{}{}}
			if it.Cpu != nil {
				a.cpu = *it.Cpu
			}
			if it.Memory != nil {
				a.mem = *it.Memory
			}
			if it.Gpu != nil {
				a.gpu = *it.Gpu
			}
			if it.GpuCount != nil {
				a.gpuCount = *it.GpuCount
			}
			byType[*it.InstanceType] = a
		}
		if it.Zone != nil {
			a.zones[*it.Zone] = struct{}{}
		}
	}

	items := make([]catalog.Item, 0, len(byType))
	for typ, a := range byType {
		zones := make([]string, 0, len(a.zones))
		for z := range a.zones {
			zones = append(zones, z)
		}
		sort.Strings(zones)
		label := typ
		if a.cpu > 0 || a.mem > 0 {
			label = fmt.Sprintf("%s (%d vCPU / %d GiB)", typ, a.cpu, a.mem)
		}
		item := catalog.Item{Value: typ, Label: label, Zones: zones}
		// Gpu 为核数、GpuCount 为物理卡数；任一大于 0 即视为 GPU 规格
		count := a.gpuCount
		if count <= 0 && a.gpu > 0 {
			count = float64(a.gpu)
		}
		if count > 0 {
			item.GPU = true
			item.GPUCount = count
			item.Label = catalog.GPULabel(label, "", count)
		}
		items = append(items, item)
	}
	return items, nil
}

func tencentImageLabel(img *cvm.Image) string {
	name := stringValue(img.ImageName)
	desc := stringValue(img.ImageDescription)
	switch {
	case name != "" && desc != "":
		return name + " (" + desc + ")"
	case name != "":
		return name
	default:
		return desc
	}
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
