package provider

import (
	"context"
	"fmt"
	"strings"

	"ovndesigner/server/internal/inventory"

	hwregion "github.com/huaweicloud/huaweicloud-sdk-go-v3/core/region"
	ecs "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/ecs/v2"
	ecsmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/ecs/v2/model"
	eip "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/eip/v3"
	eipmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/eip/v3/model"
	nat "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/nat/v2"
	natmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/nat/v2/model"
	vpc "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/vpc/v2"
	vpcmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/vpc/v2/model"
	vpcv3 "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/vpc/v3"
	vpcv3model "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/vpc/v3/model"
)

func (p *huaweiProvider) vpcClient(region string) *vpc.VpcClient {
	return vpc.NewVpcClient(vpc.VpcClientBuilder().
		WithRegion(hwregion.NewRegion(region, "https://vpc."+region+".myhuaweicloud.com")).
		WithCredential(p.auth()).
		Build())
}

func (p *huaweiProvider) vpcV3Client(region string) *vpcv3.VpcClient {
	return vpcv3.NewVpcClient(vpcv3.VpcClientBuilder().
		WithRegion(hwregion.NewRegion(region, "https://vpc."+region+".myhuaweicloud.com")).
		WithCredential(p.auth()).
		Build())
}

func (p *huaweiProvider) natClient(region string) *nat.NatClient {
	return nat.NewNatClient(nat.NatClientBuilder().
		WithRegion(hwregion.NewRegion(region, "https://nat."+region+".myhuaweicloud.com")).
		WithCredential(p.auth()).
		Build())
}

func (p *huaweiProvider) eipClient(region string) *eip.EipClient {
	return eip.NewEipClient(eip.EipClientBuilder().
		WithRegion(hwregion.NewRegion(region, "https://eip."+region+".myhuaweicloud.com")).
		WithCredential(p.auth()).
		Build())
}

func (p *huaweiProvider) Inventory(_ context.Context, region string) (*inventory.Graph, error) {
	g := &inventory.Graph{}
	if err := huaweiFillVPCs(p.vpcClient(region), g); err != nil {
		return nil, err
	}
	if err := huaweiFillSubnets(p.vpcClient(region), g); err != nil {
		return nil, err
	}
	if err := huaweiFillInstances(p.ecsClient(region), g); err != nil {
		return nil, err
	}
	if err := huaweiFillSecurityGroups(p.vpcV3Client(region), g); err != nil {
		return nil, err
	}
	if err := huaweiFillEIPs(p.eipClient(region), g); err != nil {
		return nil, err
	}
	if err := huaweiFillGateways(p.natClient(region), g); err != nil {
		return nil, err
	}
	return g, nil
}

func huaweiFillVPCs(client *vpc.VpcClient, g *inventory.Graph) error {
	limit := int32(2000)
	resp, err := client.ListVpcs(&vpcmodel.ListVpcsRequest{Limit: &limit})
	if err != nil {
		return fmt.Errorf("huawei ListVpcs: %w", err)
	}
	if resp.Vpcs == nil {
		return nil
	}
	for _, v := range *resp.Vpcs {
		if v.Id == "" {
			continue
		}
		g.VPCs = append(g.VPCs, inventory.VPC{ID: v.Id, Name: firstNonEmpty(v.Name, v.Id), CIDR: v.Cidr})
	}
	return nil
}

func huaweiFillSubnets(client *vpc.VpcClient, g *inventory.Graph) error {
	limit := int32(2000)
	resp, err := client.ListSubnets(&vpcmodel.ListSubnetsRequest{Limit: &limit})
	if err != nil {
		return fmt.Errorf("huawei ListSubnets: %w", err)
	}
	if resp.Subnets == nil {
		return nil
	}
	for _, s := range *resp.Subnets {
		if s.Id == "" {
			continue
		}
		g.Subnets = append(g.Subnets, inventory.Subnet{
			ID:    s.Id,
			Name:  firstNonEmpty(s.Name, s.Id),
			CIDR:  s.Cidr,
			Zone:  s.AvailabilityZone,
			VPCID: s.VpcId,
		})
	}
	return nil
}

func huaweiFillInstances(client *ecs.EcsClient, g *inventory.Graph) error {
	keys := map[string]struct{}{}
	offset := int32(1)
	limit := int32(100)
	for {
		resp, err := client.ListServersDetails(&ecsmodel.ListServersDetailsRequest{
			Offset: &offset,
			Limit:  &limit,
		})
		if err != nil {
			return fmt.Errorf("huawei ListServersDetails: %w", err)
		}
		if resp.Servers == nil || len(*resp.Servers) == 0 {
			break
		}
		for _, s := range *resp.Servers {
			if s.Id == "" {
				continue
			}
			item := inventory.Instance{
				ID:         s.Id,
				Name:       firstNonEmpty(s.Name, s.Id),
				ChargeType: huaweiCharge(s.Metadata),
				KeyPair:    s.KeyName,
				Zone:       s.OSEXTAZavailabilityZone,
			}
			if s.Image != nil {
				item.ImageID = s.Image.Id
			}
			if s.Flavor != nil {
				item.InstanceType = firstNonEmpty(s.Flavor.Name, s.Flavor.Id)
			}
			for _, addrs := range s.Addresses {
				for _, a := range addrs {
					if a.OSEXTIPStype != nil && a.OSEXTIPStype.Value() == "fixed" && item.PrivateIP == "" {
						item.PrivateIP = a.Addr
					}
				}
			}
			for _, sg := range s.SecurityGroups {
				if sg.Id != "" {
					item.SecurityGroupIDs = append(item.SecurityGroupIDs, sg.Id)
				}
			}
			if s.Metadata != nil {
				if vpcID := s.Metadata["vpc_id"]; vpcID != "" {
					item.VPCID = vpcID
				}
			}
			if s.NetworkInterfaces != nil {
				for _, nic := range *s.NetworkInterfaces {
					if nic.Primary != nil && *nic.Primary && nic.SubnetId != nil {
						item.SubnetID = *nic.SubnetId
						break
					}
				}
			}
			if item.KeyPair != "" {
				keys[item.KeyPair] = struct{}{}
			}
			g.Instances = append(g.Instances, item)
		}
		if int32(len(*resp.Servers)) < limit {
			break
		}
		offset++
	}
	for name := range keys {
		g.KeyPairs = append(g.KeyPairs, inventory.KeyPair{Name: name})
	}
	return nil
}

func huaweiFillSecurityGroups(client *vpcv3.VpcClient, g *inventory.Graph) error {
	limit := int32(2000)
	resp, err := client.ListSecurityGroups(&vpcv3model.ListSecurityGroupsRequest{Limit: &limit})
	if err != nil {
		return fmt.Errorf("huawei ListSecurityGroups: %w", err)
	}
	if resp.SecurityGroups == nil {
		return nil
	}
	for _, sg := range *resp.SecurityGroups {
		if sg.Id == "" {
			continue
		}
		g.SecurityGroups = append(g.SecurityGroups, inventory.SecurityGroup{
			ID:   sg.Id,
			Name: firstNonEmpty(sg.Name, sg.Id),
		})
	}
	return nil
}

func huaweiFillEIPs(client *eip.EipClient, g *inventory.Graph) error {
	limit := int32(2000)
	resp, err := client.ListPublicips(&eipmodel.ListPublicipsRequest{Limit: &limit})
	if err != nil {
		return fmt.Errorf("huawei ListPublicips: %w", err)
	}
	if resp.Publicips == nil {
		return nil
	}
	for _, e := range *resp.Publicips {
		id := strPtr(e.Id)
		if id == "" {
			continue
		}
		item := inventory.EIP{
			ID:      id,
			Name:    firstNonEmpty(strPtr(e.Alias), id),
			Address: strPtr(e.PublicIpAddress),
		}
		if e.Bandwidth != nil {
			if e.Bandwidth.Size != nil {
				item.Bandwidth = int(*e.Bandwidth.Size)
			}
			if e.Bandwidth.ChargeMode != nil && strings.EqualFold(*e.Bandwidth.ChargeMode, "bandwidth") {
				item.InternetChargeType = "payByBandwidth"
			} else {
				item.InternetChargeType = "payByTraffic"
			}
		}
		assocType := ""
		if e.AssociateInstanceType != nil {
			assocType = e.AssociateInstanceType.Value()
		}
		assocID := strPtr(e.AssociateInstanceId)
		if strings.EqualFold(assocType, "NATGW") {
			item.GatewayID = assocID
		} else if assocID != "" {
			item.InstanceID = assocID
		}
		g.EIPs = append(g.EIPs, item)
	}
	return nil
}

func huaweiFillGateways(client *nat.NatClient, g *inventory.Graph) error {
	limit := int32(2000)
	resp, err := client.ListNatGateways(&natmodel.ListNatGatewaysRequest{Limit: &limit})
	if err != nil {
		return fmt.Errorf("huawei ListNatGateways: %w", err)
	}
	if resp.NatGateways == nil {
		return nil
	}
	for _, n := range *resp.NatGateways {
		id := strPtr(n.Id)
		if id == "" {
			continue
		}
		g.Gateways = append(g.Gateways, inventory.Gateway{
			ID:       id,
			Name:     firstNonEmpty(strPtr(n.Name), id),
			VPCID:    strPtr(n.RouterId),
			SubnetID: strPtr(n.InternalNetworkId),
		})
	}
	return nil
}

func huaweiCharge(meta map[string]string) string {
	if meta == nil {
		return "payAsYouGo"
	}
	switch meta["charging_mode"] {
	case "1", "prePaid":
		return "subscription"
	case "2":
		return "spot"
	default:
		return "payAsYouGo"
	}
}

func strPtr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
