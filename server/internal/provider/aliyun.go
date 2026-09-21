package provider

import (
	"context"
	"fmt"

	"ovndesigner/server/internal/catalog"
	"ovndesigner/server/internal/config"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	ecs "github.com/alibabacloud-go/ecs-20140526/v4/client"
	"github.com/alibabacloud-go/tea/tea"
)

type aliyunProvider struct {
	ak, sk string
}

func newAliyun(vc config.VendorConfig) catalog.Provider {
	return &aliyunProvider{ak: vc.AccessKey, sk: vc.SecretKey}
}

func (p *aliyunProvider) client(region string) (*ecs.Client, error) {
	cfg := &openapi.Config{}
	cfg.SetAccessKeyId(p.ak)
	cfg.SetAccessKeySecret(p.sk)
	cfg.SetRegionId(region)
	cfg.SetEndpoint("ecs." + region + ".aliyuncs.com")
	return ecs.NewClient(cfg)
}

func (p *aliyunProvider) Images(_ context.Context, region string) ([]catalog.Item, error) {
	client, err := p.client(region)
	if err != nil {
		return nil, fmt.Errorf("aliyun client: %w", err)
	}

	const pageSize = int32(100)
	var items []catalog.Item
	for page := int32(1); ; page++ {
		req := &ecs.DescribeImagesRequest{
			RegionId:        tea.String(region),
			ImageOwnerAlias: tea.String("system"),
			Status:          tea.String("Available"),
			PageNumber:      tea.Int32(page),
			PageSize:        tea.Int32(pageSize),
		}
		resp, err := client.DescribeImages(req)
		if err != nil {
			return nil, fmt.Errorf("aliyun DescribeImages: %w", err)
		}
		if resp.Body == nil || resp.Body.Images == nil || resp.Body.Images.Image == nil {
			break
		}
		set := resp.Body.Images.Image
		for _, img := range set {
			if img.ImageId == nil {
				continue
			}
			label := aliyunImageLabel(img.ImageName, img.Description, img.ImageId)
			item := catalog.Item{Value: *img.ImageId, Label: label}
			if catalog.LooksLikeGPUImage(label, tea.StringValue(img.OSName), tea.StringValue(img.ImageFamily)) {
				item.GPU = true
			}
			items = append(items, item)
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	return items, nil
}

func (p *aliyunProvider) InstanceTypes(_ context.Context, region string) ([]catalog.Item, error) {
	client, err := p.client(region)
	if err != nil {
		return nil, fmt.Errorf("aliyun client: %w", err)
	}

	zonesByType, err := p.availableZones(client, region)
	if err != nil {
		return nil, err
	}

	var items []catalog.Item
	token := ""
	for {
		req := &ecs.DescribeInstanceTypesRequest{MaxResults: tea.Int64(100)}
		if token != "" {
			req.NextToken = tea.String(token)
		}
		resp, err := client.DescribeInstanceTypes(req)
		if err != nil {
			return nil, fmt.Errorf("aliyun DescribeInstanceTypes: %w", err)
		}
		if resp.Body == nil || resp.Body.InstanceTypes == nil || resp.Body.InstanceTypes.InstanceType == nil {
			break
		}
		set := resp.Body.InstanceTypes.InstanceType
		for _, it := range set {
			if it.InstanceTypeId == nil {
				continue
			}
			id := *it.InstanceTypeId
			label := id
			if it.CpuCoreCount != nil && it.MemorySize != nil {
				label = fmt.Sprintf("%s (%d vCPU / %g GiB)", id, *it.CpuCoreCount, *it.MemorySize)
			}
			item := catalog.Item{Value: id, Label: label, Zones: zonesByType[id]}
			gpuCount := float64(tea.Int32Value(it.GPUAmount))
			gpuSpec := tea.StringValue(it.GPUSpec)
			if gpuCount > 0 || gpuSpec != "" {
				item.GPU = true
				item.GPUCount = gpuCount
				item.GPUSpec = gpuSpec
				if it.GPUMemorySize != nil {
					item.GPUMemoryGiB = float64(*it.GPUMemorySize)
				}
				item.Label = catalog.GPULabel(label, gpuSpec, gpuCount)
			}
			items = append(items, item)
		}
		if resp.Body.NextToken == nil || *resp.Body.NextToken == "" {
			break
		}
		token = *resp.Body.NextToken
	}
	return items, nil
}

// availableZones 返回 实例规格 -> 有货可用区 列表（DestinationResource=InstanceType）。
func (p *aliyunProvider) availableZones(client *ecs.Client, region string) (map[string][]string, error) {
	req := &ecs.DescribeAvailableResourceRequest{
		RegionId:            tea.String(region),
		DestinationResource: tea.String("InstanceType"),
	}
	resp, err := client.DescribeAvailableResource(req)
	if err != nil {
		return nil, fmt.Errorf("aliyun DescribeAvailableResource: %w", err)
	}
	out := map[string][]string{}
	if resp.Body == nil || resp.Body.AvailableZones == nil {
		return out, nil
	}
	for _, zone := range resp.Body.AvailableZones.AvailableZone {
		if zone == nil || zone.ZoneId == nil || zone.AvailableResources == nil {
			continue
		}
		for _, ar := range zone.AvailableResources.AvailableResource {
			if ar == nil || ar.Type == nil || *ar.Type != "InstanceType" ||
				ar.SupportedResources == nil {
				continue
			}
			for _, sr := range ar.SupportedResources.SupportedResource {
				if sr == nil || sr.Value == nil {
					continue
				}
				if sr.Status != nil && *sr.Status != "Available" {
					continue
				}
				out[*sr.Value] = append(out[*sr.Value], *zone.ZoneId)
			}
		}
	}
	return out, nil
}

func aliyunImageLabel(name, description, id *string) string {
	n := tea.StringValue(name)
	d := tea.StringValue(description)
	switch {
	case n != "" && d != "":
		return n + " (" + d + ")"
	case n != "":
		return n
	case d != "":
		return d
	default:
		return tea.StringValue(id)
	}
}
