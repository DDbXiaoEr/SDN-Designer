package provider

import (
	"context"
	"fmt"
	"sort"

	"ovndesigner/server/internal/catalog"
	"ovndesigner/server/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
)

type awsProvider struct {
	ak, sk string
}

func newAWS(vc config.VendorConfig) catalog.Provider {
	return &awsProvider{ak: vc.AccessKey, sk: vc.SecretKey}
}

func (p *awsProvider) client(ctx context.Context, region string) (*ec2.Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(p.ak, p.sk, ""),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}
	return ec2.NewFromConfig(cfg), nil
}

func (p *awsProvider) Images(ctx context.Context, region string) ([]catalog.Item, error) {
	client, err := p.client(ctx, region)
	if err != nil {
		return nil, err
	}
	out, err := client.DescribeImages(ctx, &ec2.DescribeImagesInput{
		Owners: []string{"amazon"},
		Filters: []ec2types.Filter{
			{Name: aws.String("state"), Values: []string{"available"}},
			{Name: aws.String("is-public"), Values: []string{"true"}},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("aws DescribeImages: %w", err)
	}
	items := make([]catalog.Item, 0, len(out.Images))
	for _, img := range out.Images {
		if img.ImageId == nil {
			continue
		}
		items = append(items, catalog.Item{
			Value: *img.ImageId,
			Label: awsLabel(aws.ToString(img.Name), aws.ToString(img.Description), *img.ImageId),
		})
	}
	return items, nil
}

func (p *awsProvider) InstanceTypes(ctx context.Context, region string) ([]catalog.Item, error) {
	client, err := p.client(ctx, region)
	if err != nil {
		return nil, err
	}

	zonesByType, err := p.offeredZones(ctx, client)
	if err != nil {
		return nil, err
	}

	type meta struct {
		cpu, memMiB int32
	}
	metas := map[string]meta{}
	typesPager := ec2.NewDescribeInstanceTypesPaginator(client, &ec2.DescribeInstanceTypesInput{})
	for typesPager.HasMorePages() {
		page, err := typesPager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("aws DescribeInstanceTypes: %w", err)
		}
		for _, it := range page.InstanceTypes {
			id := string(it.InstanceType)
			if id == "" {
				continue
			}
			m := metas[id]
			if it.VCpuInfo != nil && it.VCpuInfo.DefaultVCpus != nil {
				m.cpu = *it.VCpuInfo.DefaultVCpus
			}
			if it.MemoryInfo != nil && it.MemoryInfo.SizeInMiB != nil {
				m.memMiB = int32(*it.MemoryInfo.SizeInMiB)
			}
			metas[id] = m
		}
	}

	items := make([]catalog.Item, 0, len(metas))
	for id, m := range metas {
		label := id
		if m.cpu > 0 || m.memMiB > 0 {
			label = fmt.Sprintf("%s (%d vCPU / %g GiB)", id, m.cpu, float64(m.memMiB)/1024)
		}
		items = append(items, catalog.Item{Value: id, Label: label, Zones: zonesByType[id]})
	}
	return items, nil
}

// offeredZones 返回 实例规格 -> 提供该规格的可用区 列表。
func (p *awsProvider) offeredZones(ctx context.Context, client *ec2.Client) (map[string][]string, error) {
	out := map[string][]string{}
	offerPager := ec2.NewDescribeInstanceTypeOfferingsPaginator(client, &ec2.DescribeInstanceTypeOfferingsInput{
		LocationType: ec2types.LocationTypeAvailabilityZone,
	})
	for offerPager.HasMorePages() {
		page, err := offerPager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("aws DescribeInstanceTypeOfferings: %w", err)
		}
		for _, o := range page.InstanceTypeOfferings {
			id := string(o.InstanceType)
			if id == "" || o.Location == nil {
				continue
			}
			out[id] = append(out[id], *o.Location)
		}
	}
	for id := range out {
		sort.Strings(out[id])
	}
	return out, nil
}

func awsLabel(name, description, id string) string {
	switch {
	case name != "" && description != "":
		return name + " (" + description + ")"
	case name != "":
		return name
	case description != "":
		return description
	default:
		return id
	}
}
