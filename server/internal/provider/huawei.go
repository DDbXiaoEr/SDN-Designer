package provider

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"ovndesigner/server/internal/catalog"
	"ovndesigner/server/internal/config"

	"github.com/huaweicloud/huaweicloud-sdk-go-v3/core/auth/basic"
	hwregion "github.com/huaweicloud/huaweicloud-sdk-go-v3/core/region"
	ecs "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/ecs/v2"
	ecsmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/ecs/v2/model"
	ims "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/ims/v2"
	imsmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/ims/v2/model"
)

type huaweiProvider struct {
	ak, sk, projectID string
}

func newHuawei(vc config.VendorConfig) catalog.Provider {
	return &huaweiProvider{ak: vc.AccessKey, sk: vc.SecretKey, projectID: vc.ProjectID}
}

func (p *huaweiProvider) auth() *basic.Credentials {
	b := basic.NewCredentialsBuilder().WithAk(p.ak).WithSk(p.sk)
	if p.projectID != "" {
		b = b.WithProjectId(p.projectID)
	}
	return b.Build()
}

func (p *huaweiProvider) imagesClient(region string) *ims.ImsClient {
	return ims.NewImsClient(ims.ImsClientBuilder().
		WithRegion(hwregion.NewRegion(region, "https://ims."+region+".myhuaweicloud.com")).
		WithCredential(p.auth()).
		Build())
}

func (p *huaweiProvider) ecsClient(region string) *ecs.EcsClient {
	return ecs.NewEcsClient(ecs.EcsClientBuilder().
		WithRegion(hwregion.NewRegion(region, "https://ecs."+region+".myhuaweicloud.com")).
		WithCredential(p.auth()).
		Build())
}

func (p *huaweiProvider) Images(_ context.Context, region string) ([]catalog.Item, error) {
	enum := imsmodel.GetListImagesRequestImagetypeEnum()
	gold := enum.GOLD
	resp, err := p.imagesClient(region).ListImages(&imsmodel.ListImagesRequest{Imagetype: &gold})
	if err != nil {
		return nil, fmt.Errorf("huawei ListImages: %w", err)
	}
	if resp.Images == nil {
		return nil, nil
	}
	items := make([]catalog.Item, 0, len(*resp.Images))
	for _, img := range *resp.Images {
		if img.Id == "" {
			continue
		}
		label := img.Name
		if label == "" {
			label = img.Id
		}
		item := catalog.Item{Value: img.Id, Label: label}
		// IMS 公共镜像通过 __support_kvm_gpu_type / __support_xen_gpu_type 标明 GPU 适用
		if (img.SupportKvmGpuType != nil && *img.SupportKvmGpuType != "") ||
			(img.SupportXenGpuType != nil && *img.SupportXenGpuType != "") ||
			catalog.LooksLikeGPUImage(label) {
			item.GPU = true
		}
		items = append(items, item)
	}
	return items, nil
}

func (p *huaweiProvider) InstanceTypes(_ context.Context, region string) ([]catalog.Item, error) {
	resp, err := p.ecsClient(region).ListFlavors(&ecsmodel.ListFlavorsRequest{})
	if err != nil {
		return nil, fmt.Errorf("huawei ListFlavors: %w", err)
	}
	if resp.Flavors == nil {
		return nil, nil
	}
	items := make([]catalog.Item, 0, len(*resp.Flavors))
	for _, f := range *resp.Flavors {
		// Terraform 华为云实例以规格名（如 s6.large.2）引用，故 value 取 name
		value := f.Name
		if value == "" {
			value = f.Id
		}
		if value == "" {
			continue
		}
		zones, offered := huaweiFlavorAvailability(region, f.OsExtraSpecs)
		// 当前地域下线或售罄的规格不进清单
		if !offered {
			continue
		}
		label := value
		if f.Vcpus != "" || f.Ram > 0 {
			label = fmt.Sprintf("%s (%s vCPU / %g GiB)", value, f.Vcpus, float64(f.Ram)/1024)
		}
		item := catalog.Item{Value: value, Label: label, Zones: zones}
		if spec, count, memGiB, ok := huaweiGPU(f.OsExtraSpecs); ok {
			item.GPU = true
			item.GPUSpec = spec
			item.GPUCount = count
			item.GPUMemoryGiB = memGiB
			item.Label = catalog.GPULabel(label, spec, count)
		}
		items = append(items, item)
	}
	return items, nil
}

func huaweiStatusOffered(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "abandon", "sellout":
		return false
	default:
		return true
	}
}

// huaweiFlavorAvailability 根据 cond:operation:status / cond:operation:az 判断本地域是否可售。
// 可映射的可用区写入 zones；无法解析 AZ 短名时仅用地域级状态。
func huaweiFlavorAvailability(region string, extra *ecsmodel.FlavorExtraSpec) (zones []string, offered bool) {
	status := "normal"
	if extra != nil && extra.Condoperationstatus != nil && *extra.Condoperationstatus != "" {
		status = *extra.Condoperationstatus
	}
	offered = huaweiStatusOffered(status)
	if extra == nil || extra.Condoperationaz == nil {
		return nil, offered
	}
	raw := strings.TrimSpace(*extra.Condoperationaz)
	if raw == "" {
		return nil, offered
	}
	sawOfferedAz := false
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		open := strings.LastIndex(part, "(")
		close := strings.LastIndex(part, ")")
		if open <= 0 || close <= open {
			continue
		}
		az := strings.TrimSpace(part[:open])
		st := strings.TrimSpace(part[open+1 : close])
		if !huaweiStatusOffered(st) {
			continue
		}
		sawOfferedAz = true
		id := huaweiZoneID(region, az)
		if id == "" {
			continue
		}
		zones = append(zones, id)
	}
	if len(zones) > 0 {
		return zones, true
	}
	// AZ 短名无法映射时，只要有可售 AZ 仍保留该规格
	if sawOfferedAz {
		return nil, true
	}
	return nil, offered
}

func huaweiZoneID(region, az string) string {
	az = strings.TrimSpace(az)
	if az == "" {
		return ""
	}
	if strings.HasPrefix(az, region) {
		return az
	}
	if len(az) == 1 && az[0] >= 'a' && az[0] <= 'z' {
		return region + az
	}
	return ""
}

// huaweiGPU 从规格 extra_specs 提取 GPU 信息。
func huaweiGPU(extra *ecsmodel.FlavorExtraSpec) (spec string, count float64, memGiB float64, ok bool) {
	if extra == nil {
		return "", 0, 0, false
	}
	if extra.Ecsperformancetype != nil && *extra.Ecsperformancetype == "gpu" {
		ok = true
	}
	if extra.PciPassthroughenableGpu != nil && *extra.PciPassthroughenableGpu == "true" {
		ok = true
	}
	if extra.Infogpuname != nil && *extra.Infogpuname != "" {
		spec = *extra.Infogpuname
		ok = true
	}
	if extra.PciPassthroughgpuSpecs != nil && *extra.PciPassthroughgpuSpecs != "" && spec == "" {
		spec = *extra.PciPassthroughgpuSpecs
		ok = true
	}
	if extra.PciPassthroughalias != nil && *extra.PciPassthroughalias != "" && spec == "" {
		spec = *extra.PciPassthroughalias
		ok = true
	}
	if extra.Quotagpu != nil && *extra.Quotagpu != "" {
		ok = true
		if n, err := strconv.ParseFloat(*extra.Quotagpu, 64); err == nil {
			count = n
		}
	}
	if extra.Infogpus != nil && *extra.Infogpus != "" {
		ok = true
		if spec == "" {
			spec = *extra.Infogpus
		}
	}
	if !ok {
		return "", 0, 0, false
	}
	return spec, count, memGiB, true
}
