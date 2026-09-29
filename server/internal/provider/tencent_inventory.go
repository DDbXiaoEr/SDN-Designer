package provider

import (
	"context"
	"fmt"
	"strings"

	"ovndesigner/server/internal/inventory"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	cvm "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/cvm/v20170312"
	vpc "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/vpc/v20170312"
)

func (p *tencentProvider) vpcClient(region string) (*vpc.Client, error) {
	cpf := profile.NewClientProfile()
	cpf.HttpProfile.Endpoint = "vpc.tencentcloudapi.com"
	cpf.HttpProfile.ReqTimeout = p.cpf.HttpProfile.ReqTimeout
	return vpc.NewClient(p.cred, region, cpf)
}

func (p *tencentProvider) Inventory(ctx context.Context, region string) (*inventory.Graph, error) {
	cvmClient, err := p.client(region)
	if err != nil {
		return nil, fmt.Errorf("tencent cvm client: %w", err)
	}
	vpcClient, err := p.vpcClient(region)
	if err != nil {
		return nil, fmt.Errorf("tencent vpc client: %w", err)
	}
	g := &inventory.Graph{}
	if err := tencentFillVPCs(ctx, vpcClient, g); err != nil {
		return nil, err
	}
	if err := tencentFillSubnets(ctx, vpcClient, g); err != nil {
		return nil, err
	}
	if err := tencentFillInstances(ctx, cvmClient, g); err != nil {
		return nil, err
	}
	if err := tencentFillSecurityGroups(ctx, vpcClient, g); err != nil {
		return nil, err
	}
	if err := tencentFillEIPs(ctx, vpcClient, g); err != nil {
		return nil, err
	}
	if err := tencentFillGateways(ctx, vpcClient, g); err != nil {
		return nil, err
	}
	if err := tencentFillRouteTables(ctx, vpcClient, g); err != nil {
		return nil, err
	}
	return g, nil
}

func tencentFillVPCs(ctx context.Context, client *vpc.Client, g *inventory.Graph) error {
	const limit = uint64(100)
	for offset := uint64(0); ; offset += limit {
		req := vpc.NewDescribeVpcsRequest()
		req.Offset = common.StringPtr(fmt.Sprintf("%d", offset))
		req.Limit = common.StringPtr(fmt.Sprintf("%d", limit))
		resp, err := client.DescribeVpcsWithContext(ctx, req)
		if err != nil {
			return fmt.Errorf("tencent DescribeVpcs: %w", err)
		}
		set := resp.Response.VpcSet
		for _, v := range set {
			id := stringValue(v.VpcId)
			if id == "" {
				continue
			}
			g.VPCs = append(g.VPCs, inventory.VPC{
				ID:   id,
				Name: firstNonEmpty(stringValue(v.VpcName), id),
				CIDR: stringValue(v.CidrBlock),
			})
		}
		if uint64(len(set)) < limit {
			break
		}
	}
	return nil
}

func tencentFillSubnets(ctx context.Context, client *vpc.Client, g *inventory.Graph) error {
	const limit = uint64(100)
	for offset := uint64(0); ; offset += limit {
		req := vpc.NewDescribeSubnetsRequest()
		req.Offset = common.StringPtr(fmt.Sprintf("%d", offset))
		req.Limit = common.StringPtr(fmt.Sprintf("%d", limit))
		resp, err := client.DescribeSubnetsWithContext(ctx, req)
		if err != nil {
			return fmt.Errorf("tencent DescribeSubnets: %w", err)
		}
		set := resp.Response.SubnetSet
		for _, s := range set {
			id := stringValue(s.SubnetId)
			if id == "" {
				continue
			}
			g.Subnets = append(g.Subnets, inventory.Subnet{
				ID:    id,
				Name:  firstNonEmpty(stringValue(s.SubnetName), id),
				CIDR:  stringValue(s.CidrBlock),
				Zone:  stringValue(s.Zone),
				VPCID: stringValue(s.VpcId),
			})
		}
		if uint64(len(set)) < limit {
			break
		}
	}
	return nil
}

func tencentFillInstances(ctx context.Context, client *cvm.Client, g *inventory.Graph) error {
	type row struct {
		inst   inventory.Instance
		keyIDs []string
	}
	var rows []row
	keyIDs := map[string]struct{}{}
	const limit = uint64(100)
	for offset := uint64(0); ; offset += limit {
		req := cvm.NewDescribeInstancesRequest()
		req.Offset = common.Int64Ptr(int64(offset))
		req.Limit = common.Int64Ptr(int64(limit))
		resp, err := client.DescribeInstancesWithContext(ctx, req)
		if err != nil {
			return fmt.Errorf("tencent DescribeInstances: %w", err)
		}
		set := resp.Response.InstanceSet
		for _, inst := range set {
			id := stringValue(inst.InstanceId)
			if id == "" {
				continue
			}
			zone := ""
			if inst.Placement != nil {
				zone = stringValue(inst.Placement.Zone)
			}
			item := inventory.Instance{
				ID:           id,
				Name:         firstNonEmpty(stringValue(inst.InstanceName), id),
				ImageID:      stringValue(inst.ImageId),
				InstanceType: stringValue(inst.InstanceType),
				ChargeType:   tencentCharge(stringValue(inst.InstanceChargeType)),
				Zone:         zone,
				GPU:          inst.GPUInfo != nil,
			}
			if inst.VirtualPrivateCloud != nil {
				item.VPCID = stringValue(inst.VirtualPrivateCloud.VpcId)
				item.SubnetID = stringValue(inst.VirtualPrivateCloud.SubnetId)
			}
			if len(inst.PrivateIpAddresses) > 0 {
				item.PrivateIP = stringValue(inst.PrivateIpAddresses[0])
			}
			for _, sg := range inst.SecurityGroupIds {
				if sg != nil && *sg != "" {
					item.SecurityGroupIDs = append(item.SecurityGroupIDs, *sg)
				}
			}
			var ids []string
			if inst.LoginSettings != nil {
				for _, k := range inst.LoginSettings.KeyIds {
					if k != nil && *k != "" {
						ids = append(ids, *k)
						keyIDs[*k] = struct{}{}
					}
				}
			}
			if inst.SystemDisk != nil {
				item.SystemDisk = &inventory.Disk{
					Type: stringValue(inst.SystemDisk.DiskType),
					Size: int(int64Value(inst.SystemDisk.DiskSize)),
				}
			}
			rows = append(rows, row{inst: item, keyIDs: ids})
		}
		if uint64(len(set)) < limit {
			break
		}
	}

	idToName := map[string]string{}
	if len(keyIDs) > 0 {
		req := cvm.NewDescribeKeyPairsRequest()
		req.Limit = common.Int64Ptr(100)
		resp, err := client.DescribeKeyPairsWithContext(ctx, req)
		if err == nil {
			for _, kp := range resp.Response.KeyPairSet {
				id := stringValue(kp.KeyId)
				name := stringValue(kp.KeyName)
				if id != "" && name != "" {
					idToName[id] = name
				}
			}
		}
	}
	seenName := map[string]struct{}{}
	for _, r := range rows {
		item := r.inst
		for _, id := range r.keyIDs {
			if name := idToName[id]; name != "" {
				item.KeyPair = name
				if _, ok := seenName[name]; !ok {
					seenName[name] = struct{}{}
					g.KeyPairs = append(g.KeyPairs, inventory.KeyPair{Name: name})
				}
				break
			}
		}
		g.Instances = append(g.Instances, item)
	}
	return nil
}

func tencentFillSecurityGroups(ctx context.Context, client *vpc.Client, g *inventory.Graph) error {
	const limit = uint64(100)
	for offset := uint64(0); ; offset += limit {
		req := vpc.NewDescribeSecurityGroupsRequest()
		req.Offset = common.StringPtr(fmt.Sprintf("%d", offset))
		req.Limit = common.StringPtr(fmt.Sprintf("%d", limit))
		resp, err := client.DescribeSecurityGroupsWithContext(ctx, req)
		if err != nil {
			return fmt.Errorf("tencent DescribeSecurityGroups: %w", err)
		}
		set := resp.Response.SecurityGroupSet
		for _, sg := range set {
			id := stringValue(sg.SecurityGroupId)
			if id == "" {
				continue
			}
			g.SecurityGroups = append(g.SecurityGroups, inventory.SecurityGroup{
				ID:   id,
				Name: firstNonEmpty(stringValue(sg.SecurityGroupName), id),
			})
		}
		if uint64(len(set)) < limit {
			break
		}
	}
	return nil
}

func tencentFillEIPs(ctx context.Context, client *vpc.Client, g *inventory.Graph) error {
	const limit = uint64(100)
	for offset := uint64(0); ; offset += limit {
		req := vpc.NewDescribeAddressesRequest()
		req.Offset = common.Int64Ptr(int64(offset))
		req.Limit = common.Int64Ptr(int64(limit))
		resp, err := client.DescribeAddressesWithContext(ctx, req)
		if err != nil {
			return fmt.Errorf("tencent DescribeAddresses: %w", err)
		}
		set := resp.Response.AddressSet
		for _, a := range set {
			id := stringValue(a.AddressId)
			if id == "" {
				continue
			}
			item := inventory.EIP{
				ID:                 id,
				Name:               firstNonEmpty(stringValue(a.AddressName), id),
				Address:            stringValue(a.AddressIp),
				Bandwidth:          int(uint64Value(a.Bandwidth)),
				InternetChargeType: tencentInternetCharge(stringValue(a.InternetChargeType)),
			}
			instID := stringValue(a.InstanceId)
			if strings.HasPrefix(instID, "nat-") {
				item.GatewayID = instID
			} else {
				item.InstanceID = instID
			}
			g.EIPs = append(g.EIPs, item)
		}
		if uint64(len(set)) < limit {
			break
		}
	}
	return nil
}

func tencentFillGateways(ctx context.Context, client *vpc.Client, g *inventory.Graph) error {
	const limit = uint64(100)
	for offset := uint64(0); ; offset += limit {
		req := vpc.NewDescribeNatGatewaysRequest()
		req.Offset = common.Uint64Ptr(offset)
		req.Limit = common.Uint64Ptr(limit)
		resp, err := client.DescribeNatGatewaysWithContext(ctx, req)
		if err != nil {
			return fmt.Errorf("tencent DescribeNatGateways: %w", err)
		}
		set := resp.Response.NatGatewaySet
		for _, n := range set {
			id := stringValue(n.NatGatewayId)
			if id == "" {
				continue
			}
			g.Gateways = append(g.Gateways, inventory.Gateway{
				ID:    id,
				Name:  firstNonEmpty(stringValue(n.NatGatewayName), id),
				VPCID: stringValue(n.VpcId),
			})
		}
		if uint64(len(set)) < limit {
			break
		}
	}
	return nil
}

func tencentFillRouteTables(ctx context.Context, client *vpc.Client, g *inventory.Graph) error {
	const limit = uint64(100)
	for offset := uint64(0); ; offset += limit {
		req := vpc.NewDescribeRouteTablesRequest()
		req.Offset = common.StringPtr(fmt.Sprintf("%d", offset))
		req.Limit = common.StringPtr(fmt.Sprintf("%d", limit))
		resp, err := client.DescribeRouteTablesWithContext(ctx, req)
		if err != nil {
			return fmt.Errorf("tencent DescribeRouteTables: %w", err)
		}
		set := resp.Response.RouteTableSet
		for _, rt := range set {
			id := stringValue(rt.RouteTableId)
			if id == "" {
				continue
			}
			item := inventory.RouteTable{
				ID:    id,
				Name:  firstNonEmpty(stringValue(rt.RouteTableName), id),
				VPCID: stringValue(rt.VpcId),
			}
			for _, assoc := range rt.AssociationSet {
				if assoc != nil && assoc.SubnetId != nil {
					item.SubnetIDs = append(item.SubnetIDs, *assoc.SubnetId)
				}
			}
			g.RouteTables = append(g.RouteTables, item)
		}
		if uint64(len(set)) < limit {
			break
		}
	}
	return nil
}

func tencentCharge(v string) string {
	switch strings.ToUpper(v) {
	case "PREPAID":
		return "subscription"
	case "SPOTPAID":
		return "spot"
	default:
		return "payAsYouGo"
	}
}

func tencentInternetCharge(v string) string {
	if strings.EqualFold(v, "BANDWIDTH_PREPAID") || strings.EqualFold(v, "BANDWIDTH_POSTPAID_BY_HOUR") {
		return "payByBandwidth"
	}
	return "payByTraffic"
}

func int64Value(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

func uint64Value(p *uint64) uint64 {
	if p == nil {
		return 0
	}
	return *p
}
