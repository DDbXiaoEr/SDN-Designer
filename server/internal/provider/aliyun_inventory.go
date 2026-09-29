package provider

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"ovndesigner/server/internal/inventory"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	ecs "github.com/alibabacloud-go/ecs-20140526/v4/client"
	"github.com/alibabacloud-go/tea/tea"
	vpc "github.com/alibabacloud-go/vpc-20160428/v6/client"
)

func (p *aliyunProvider) vpcClient(region string) (*vpc.Client, error) {
	cfg := &openapi.Config{}
	cfg.SetAccessKeyId(p.ak)
	cfg.SetAccessKeySecret(p.sk)
	cfg.SetRegionId(region)
	cfg.SetEndpoint("vpc." + region + ".aliyuncs.com")
	return vpc.NewClient(cfg)
}

func (p *aliyunProvider) Inventory(_ context.Context, region string) (*inventory.Graph, error) {
	ecsClient, err := p.client(region)
	if err != nil {
		return nil, fmt.Errorf("aliyun ecs client: %w", err)
	}
	vpcClient, err := p.vpcClient(region)
	if err != nil {
		return nil, fmt.Errorf("aliyun vpc client: %w", err)
	}
	g := &inventory.Graph{}
	if err := aliyunFillVPCs(vpcClient, region, g); err != nil {
		return nil, err
	}
	if err := aliyunFillSubnets(vpcClient, region, g); err != nil {
		return nil, err
	}
	if err := aliyunFillInstances(ecsClient, region, g); err != nil {
		return nil, err
	}
	if err := aliyunFillSecurityGroups(ecsClient, region, g); err != nil {
		return nil, err
	}
	if err := aliyunFillEIPs(vpcClient, region, g); err != nil {
		return nil, err
	}
	if err := aliyunFillGateways(vpcClient, region, g); err != nil {
		return nil, err
	}
	if err := aliyunFillRouteTables(vpcClient, region, g); err != nil {
		return nil, err
	}
	return g, nil
}

func aliyunFillVPCs(client *vpc.Client, region string, g *inventory.Graph) error {
	const pageSize = int32(50)
	for page := int32(1); ; page++ {
		resp, err := client.DescribeVpcs(&vpc.DescribeVpcsRequest{
			RegionId:   tea.String(region),
			PageNumber: tea.Int32(page),
			PageSize:   tea.Int32(pageSize),
		})
		if err != nil {
			return fmt.Errorf("aliyun DescribeVpcs: %w", err)
		}
		if resp.Body == nil || resp.Body.Vpcs == nil || resp.Body.Vpcs.Vpc == nil {
			break
		}
		set := resp.Body.Vpcs.Vpc
		for _, v := range set {
			id := tea.StringValue(v.VpcId)
			if id == "" {
				continue
			}
			name := tea.StringValue(v.VpcName)
			if name == "" {
				name = id
			}
			g.VPCs = append(g.VPCs, inventory.VPC{ID: id, Name: name, CIDR: tea.StringValue(v.CidrBlock)})
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	return nil
}

func aliyunFillSubnets(client *vpc.Client, region string, g *inventory.Graph) error {
	const pageSize = int32(50)
	for page := int32(1); ; page++ {
		resp, err := client.DescribeVSwitches(&vpc.DescribeVSwitchesRequest{
			RegionId:   tea.String(region),
			PageNumber: tea.Int32(page),
			PageSize:   tea.Int32(pageSize),
		})
		if err != nil {
			return fmt.Errorf("aliyun DescribeVSwitches: %w", err)
		}
		if resp.Body == nil || resp.Body.VSwitches == nil || resp.Body.VSwitches.VSwitch == nil {
			break
		}
		set := resp.Body.VSwitches.VSwitch
		for _, s := range set {
			id := tea.StringValue(s.VSwitchId)
			if id == "" {
				continue
			}
			name := tea.StringValue(s.VSwitchName)
			if name == "" {
				name = id
			}
			g.Subnets = append(g.Subnets, inventory.Subnet{
				ID:    id,
				Name:  name,
				CIDR:  tea.StringValue(s.CidrBlock),
				Zone:  tea.StringValue(s.ZoneId),
				VPCID: tea.StringValue(s.VpcId),
			})
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	return nil
}

func aliyunFillInstances(client *ecs.Client, region string, g *inventory.Graph) error {
	keys := map[string]struct{}{}
	const pageSize = int32(50)
	for page := int32(1); ; page++ {
		resp, err := client.DescribeInstances(&ecs.DescribeInstancesRequest{
			RegionId:   tea.String(region),
			PageNumber: tea.Int32(page),
			PageSize:   tea.Int32(pageSize),
		})
		if err != nil {
			return fmt.Errorf("aliyun DescribeInstances: %w", err)
		}
		if resp.Body == nil || resp.Body.Instances == nil || resp.Body.Instances.Instance == nil {
			break
		}
		set := resp.Body.Instances.Instance
		for _, inst := range set {
			id := tea.StringValue(inst.InstanceId)
			if id == "" {
				continue
			}
			status := tea.StringValue(inst.Status)
			if status == "Released" {
				continue
			}
			item := inventory.Instance{
				ID:           id,
				Name:         firstNonEmpty(tea.StringValue(inst.InstanceName), id),
				ImageID:      tea.StringValue(inst.ImageId),
				InstanceType: tea.StringValue(inst.InstanceType),
				ChargeType:   aliyunCharge(tea.StringValue(inst.InstanceChargeType), tea.StringValue(inst.SpotStrategy)),
				Zone:         tea.StringValue(inst.ZoneId),
				KeyPair:      tea.StringValue(inst.KeyPairName),
				GPU:          tea.Int32Value(inst.GPUAmount) > 0 || tea.StringValue(inst.GPUSpec) != "",
			}
			if inst.VpcAttributes != nil {
				item.VPCID = tea.StringValue(inst.VpcAttributes.VpcId)
				item.SubnetID = tea.StringValue(inst.VpcAttributes.VSwitchId)
				if inst.VpcAttributes.PrivateIpAddress != nil && len(inst.VpcAttributes.PrivateIpAddress.IpAddress) > 0 {
					item.PrivateIP = tea.StringValue(inst.VpcAttributes.PrivateIpAddress.IpAddress[0])
				}
			}
			if inst.SecurityGroupIds != nil {
				for _, sg := range inst.SecurityGroupIds.SecurityGroupId {
					if sg != nil && *sg != "" {
						item.SecurityGroupIDs = append(item.SecurityGroupIDs, *sg)
					}
				}
			}
			if item.KeyPair != "" {
				keys[item.KeyPair] = struct{}{}
			}
			g.Instances = append(g.Instances, item)
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	for name := range keys {
		g.KeyPairs = append(g.KeyPairs, inventory.KeyPair{Name: name})
	}
	return nil
}

func aliyunFillSecurityGroups(client *ecs.Client, region string, g *inventory.Graph) error {
	const pageSize = int32(50)
	for page := int32(1); ; page++ {
		resp, err := client.DescribeSecurityGroups(&ecs.DescribeSecurityGroupsRequest{
			RegionId:   tea.String(region),
			PageNumber: tea.Int32(page),
			PageSize:   tea.Int32(pageSize),
		})
		if err != nil {
			return fmt.Errorf("aliyun DescribeSecurityGroups: %w", err)
		}
		if resp.Body == nil || resp.Body.SecurityGroups == nil || resp.Body.SecurityGroups.SecurityGroup == nil {
			break
		}
		set := resp.Body.SecurityGroups.SecurityGroup
		for _, sg := range set {
			id := tea.StringValue(sg.SecurityGroupId)
			if id == "" {
				continue
			}
			item := inventory.SecurityGroup{
				ID:    id,
				Name:  firstNonEmpty(tea.StringValue(sg.SecurityGroupName), id),
				VPCID: tea.StringValue(sg.VpcId),
			}
			if rules, err := aliyunSGRules(client, region, id); err == nil {
				item.Rules = rules
			}
			g.SecurityGroups = append(g.SecurityGroups, item)
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	return nil
}

func aliyunSGRules(client *ecs.Client, region, sgID string) ([]inventory.SGRule, error) {
	resp, err := client.DescribeSecurityGroupAttribute(&ecs.DescribeSecurityGroupAttributeRequest{
		RegionId:        tea.String(region),
		SecurityGroupId: tea.String(sgID),
	})
	if err != nil {
		return nil, err
	}
	if resp.Body == nil || resp.Body.Permissions == nil {
		return nil, nil
	}
	var out []inventory.SGRule
	for _, p := range resp.Body.Permissions.Permission {
		if p == nil {
			continue
		}
		dir := strings.ToLower(tea.StringValue(p.Direction))
		if dir == "ingress" || dir == "in" {
			dir = "ingress"
		} else {
			dir = "egress"
		}
		proto := strings.ToLower(tea.StringValue(p.IpProtocol))
		cidr := tea.StringValue(p.SourceCidrIp)
		if dir == "egress" {
			cidr = tea.StringValue(p.DestCidrIp)
		}
		if cidr == "" {
			cidr = "0.0.0.0/0"
		}
		out = append(out, inventory.SGRule{
			Direction:   dir,
			Protocol:    proto,
			Port:        tea.StringValue(p.PortRange),
			CIDR:        cidr,
			Description: tea.StringValue(p.Description),
		})
	}
	return out, nil
}

func aliyunFillEIPs(client *vpc.Client, region string, g *inventory.Graph) error {
	const pageSize = int32(50)
	for page := int32(1); ; page++ {
		resp, err := client.DescribeEipAddresses(&vpc.DescribeEipAddressesRequest{
			RegionId:   tea.String(region),
			PageNumber: tea.Int32(page),
			PageSize:   tea.Int32(pageSize),
		})
		if err != nil {
			return fmt.Errorf("aliyun DescribeEipAddresses: %w", err)
		}
		if resp.Body == nil || resp.Body.EipAddresses == nil || resp.Body.EipAddresses.EipAddress == nil {
			break
		}
		set := resp.Body.EipAddresses.EipAddress
		for _, e := range set {
			id := tea.StringValue(e.AllocationId)
			if id == "" {
				continue
			}
			item := inventory.EIP{
				ID:                 id,
				Name:               firstNonEmpty(tea.StringValue(e.Name), id),
				Address:            tea.StringValue(e.IpAddress),
				Bandwidth:          atoi(tea.StringValue(e.Bandwidth)),
				InternetChargeType: aliyunInternetCharge(tea.StringValue(e.InternetChargeType)),
			}
			instType := tea.StringValue(e.InstanceType)
			instID := tea.StringValue(e.InstanceId)
			if instType == "Nat" || instType == "NAT" {
				item.GatewayID = instID
			} else if instID != "" {
				item.InstanceID = instID
			}
			g.EIPs = append(g.EIPs, item)
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	return nil
}

func aliyunFillGateways(client *vpc.Client, region string, g *inventory.Graph) error {
	const pageSize = int32(50)
	for page := int32(1); ; page++ {
		resp, err := client.DescribeNatGateways(&vpc.DescribeNatGatewaysRequest{
			RegionId:   tea.String(region),
			PageNumber: tea.Int32(page),
			PageSize:   tea.Int32(pageSize),
		})
		if err != nil {
			return fmt.Errorf("aliyun DescribeNatGateways: %w", err)
		}
		if resp.Body == nil || resp.Body.NatGateways == nil || resp.Body.NatGateways.NatGateway == nil {
			break
		}
		set := resp.Body.NatGateways.NatGateway
		for _, n := range set {
			id := tea.StringValue(n.NatGatewayId)
			if id == "" {
				continue
			}
			g.Gateways = append(g.Gateways, inventory.Gateway{
				ID:    id,
				Name:  firstNonEmpty(tea.StringValue(n.Name), id),
				VPCID: tea.StringValue(n.VpcId),
			})
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	return nil
}

func aliyunFillRouteTables(client *vpc.Client, region string, g *inventory.Graph) error {
	const pageSize = int32(50)
	for page := int32(1); ; page++ {
		resp, err := client.DescribeRouteTableList(&vpc.DescribeRouteTableListRequest{
			RegionId:   tea.String(region),
			PageNumber: tea.Int32(page),
			PageSize:   tea.Int32(pageSize),
		})
		if err != nil {
			return fmt.Errorf("aliyun DescribeRouteTableList: %w", err)
		}
		if resp.Body == nil || resp.Body.RouterTableList == nil || resp.Body.RouterTableList.RouterTableListType == nil {
			break
		}
		set := resp.Body.RouterTableList.RouterTableListType
		for _, rt := range set {
			id := tea.StringValue(rt.RouteTableId)
			if id == "" {
				continue
			}
			item := inventory.RouteTable{
				ID:    id,
				Name:  firstNonEmpty(tea.StringValue(rt.RouteTableName), id),
				VPCID: tea.StringValue(rt.VpcId),
			}
			if rt.VSwitchIds != nil {
				for _, idp := range rt.VSwitchIds.VSwitchId {
					if idp != nil && *idp != "" {
						item.SubnetIDs = append(item.SubnetIDs, *idp)
					}
				}
			}
			g.RouteTables = append(g.RouteTables, item)
		}
		if int32(len(set)) < pageSize {
			break
		}
	}
	return nil
}

func aliyunCharge(charge, spot string) string {
	if strings.EqualFold(charge, "PrePaid") {
		return "subscription"
	}
	if strings.Contains(strings.ToLower(spot), "spot") {
		return "spot"
	}
	return "payAsYouGo"
}

func aliyunInternetCharge(v string) string {
	if strings.EqualFold(v, "PayByBandwidth") {
		return "payByBandwidth"
	}
	return "payByTraffic"
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func atoi(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}
