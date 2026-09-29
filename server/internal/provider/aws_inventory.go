package provider

import (
	"context"
	"fmt"
	"strings"

	"ovndesigner/server/internal/inventory"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
)

func (p *awsProvider) Inventory(ctx context.Context, region string) (*inventory.Graph, error) {
	client, err := p.client(ctx, region)
	if err != nil {
		return nil, err
	}

	g := &inventory.Graph{}
	if err := awsFillVPCs(ctx, client, g); err != nil {
		return nil, err
	}
	if err := awsFillSubnets(ctx, client, g); err != nil {
		return nil, err
	}
	if err := awsFillInstances(ctx, client, g); err != nil {
		return nil, err
	}
	if err := awsFillSecurityGroups(ctx, client, g); err != nil {
		return nil, err
	}
	if err := awsFillEIPs(ctx, client, g); err != nil {
		return nil, err
	}
	if err := awsFillGateways(ctx, client, g); err != nil {
		return nil, err
	}
	if err := awsFillRouteTables(ctx, client, g); err != nil {
		return nil, err
	}
	return g, nil
}

func awsFillVPCs(ctx context.Context, client *ec2.Client, g *inventory.Graph) error {
	pager := ec2.NewDescribeVpcsPaginator(client, &ec2.DescribeVpcsInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("aws DescribeVpcs: %w", err)
		}
		for _, v := range page.Vpcs {
			id := aws.ToString(v.VpcId)
			if id == "" {
				continue
			}
			cidr := aws.ToString(v.CidrBlock)
			g.VPCs = append(g.VPCs, inventory.VPC{ID: id, Name: awsName(v.Tags, id), CIDR: cidr})
		}
	}
	return nil
}

func awsFillSubnets(ctx context.Context, client *ec2.Client, g *inventory.Graph) error {
	pager := ec2.NewDescribeSubnetsPaginator(client, &ec2.DescribeSubnetsInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("aws DescribeSubnets: %w", err)
		}
		for _, s := range page.Subnets {
			id := aws.ToString(s.SubnetId)
			if id == "" {
				continue
			}
			g.Subnets = append(g.Subnets, inventory.Subnet{
				ID:    id,
				Name:  awsName(s.Tags, id),
				CIDR:  aws.ToString(s.CidrBlock),
				Zone:  aws.ToString(s.AvailabilityZone),
				VPCID: aws.ToString(s.VpcId),
			})
		}
	}
	return nil
}

func awsFillInstances(ctx context.Context, client *ec2.Client, g *inventory.Graph) error {
	keys := map[string]struct{}{}
	pager := ec2.NewDescribeInstancesPaginator(client, &ec2.DescribeInstancesInput{
		Filters: []ec2types.Filter{{
			Name:   aws.String("instance-state-name"),
			Values: []string{"pending", "running", "stopping", "stopped"},
		}},
	})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("aws DescribeInstances: %w", err)
		}
		for _, res := range page.Reservations {
			for _, inst := range res.Instances {
				id := aws.ToString(inst.InstanceId)
				if id == "" {
					continue
				}
				zone := ""
				if inst.Placement != nil {
					zone = aws.ToString(inst.Placement.AvailabilityZone)
				}
				item := inventory.Instance{
					ID:           id,
					Name:         awsName(inst.Tags, id),
					ImageID:      aws.ToString(inst.ImageId),
					InstanceType: string(inst.InstanceType),
					ChargeType:   "payAsYouGo",
					Zone:         zone,
					VPCID:        aws.ToString(inst.VpcId),
					SubnetID:     aws.ToString(inst.SubnetId),
					PrivateIP:    aws.ToString(inst.PrivateIpAddress),
					KeyPair:      aws.ToString(inst.KeyName),
				}
				if inst.InstanceLifecycle == ec2types.InstanceLifecycleTypeSpot {
					item.ChargeType = "spot"
				}
				for _, sg := range inst.SecurityGroups {
					if sg.GroupId != nil {
						item.SecurityGroupIDs = append(item.SecurityGroupIDs, *sg.GroupId)
					}
				}
				if item.KeyPair != "" {
					keys[item.KeyPair] = struct{}{}
				}
				if root := awsRootDisk(inst.BlockDeviceMappings); root != nil {
					item.SystemDisk = root
				}
				g.Instances = append(g.Instances, item)
			}
		}
	}
	for name := range keys {
		g.KeyPairs = append(g.KeyPairs, inventory.KeyPair{Name: name})
	}
	return nil
}

func awsFillSecurityGroups(ctx context.Context, client *ec2.Client, g *inventory.Graph) error {
	pager := ec2.NewDescribeSecurityGroupsPaginator(client, &ec2.DescribeSecurityGroupsInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("aws DescribeSecurityGroups: %w", err)
		}
		for _, sg := range page.SecurityGroups {
			id := aws.ToString(sg.GroupId)
			if id == "" {
				continue
			}
			name := aws.ToString(sg.GroupName)
			if tagged := awsName(sg.Tags, ""); tagged != "" {
				name = tagged
			}
			item := inventory.SecurityGroup{ID: id, Name: name, VPCID: aws.ToString(sg.VpcId)}
			item.Rules = append(item.Rules, awsSGRules(sg.IpPermissions, "ingress")...)
			item.Rules = append(item.Rules, awsSGRules(sg.IpPermissionsEgress, "egress")...)
			g.SecurityGroups = append(g.SecurityGroups, item)
		}
	}
	return nil
}

func awsFillEIPs(ctx context.Context, client *ec2.Client, g *inventory.Graph) error {
	out, err := client.DescribeAddresses(ctx, &ec2.DescribeAddressesInput{})
	if err != nil {
		return fmt.Errorf("aws DescribeAddresses: %w", err)
	}
	for _, a := range out.Addresses {
		id := aws.ToString(a.AllocationId)
		if id == "" {
			continue
		}
		g.EIPs = append(g.EIPs, inventory.EIP{
			ID:         id,
			Name:       awsName(a.Tags, id),
			Address:    aws.ToString(a.PublicIp),
			InstanceID: aws.ToString(a.InstanceId),
		})
	}
	return nil
}

func awsFillGateways(ctx context.Context, client *ec2.Client, g *inventory.Graph) error {
	pager := ec2.NewDescribeNatGatewaysPaginator(client, &ec2.DescribeNatGatewaysInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("aws DescribeNatGateways: %w", err)
		}
		for _, n := range page.NatGateways {
			if n.State == ec2types.NatGatewayStateDeleted || n.State == ec2types.NatGatewayStateDeleting {
				continue
			}
			id := aws.ToString(n.NatGatewayId)
			if id == "" {
				continue
			}
			g.Gateways = append(g.Gateways, inventory.Gateway{
				ID:       id,
				Name:     awsName(n.Tags, id),
				VPCID:    aws.ToString(n.VpcId),
				SubnetID: aws.ToString(n.SubnetId),
			})
			if len(n.NatGatewayAddresses) > 0 {
				alloc := aws.ToString(n.NatGatewayAddresses[0].AllocationId)
				if alloc != "" {
					for i := range g.EIPs {
						if g.EIPs[i].ID == alloc {
							g.EIPs[i].GatewayID = id
							break
						}
					}
				}
			}
		}
	}
	return nil
}

func awsFillRouteTables(ctx context.Context, client *ec2.Client, g *inventory.Graph) error {
	pager := ec2.NewDescribeRouteTablesPaginator(client, &ec2.DescribeRouteTablesInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("aws DescribeRouteTables: %w", err)
		}
		for _, rt := range page.RouteTables {
			id := aws.ToString(rt.RouteTableId)
			if id == "" {
				continue
			}
			item := inventory.RouteTable{
				ID:    id,
				Name:  awsName(rt.Tags, id),
				VPCID: aws.ToString(rt.VpcId),
			}
			for _, a := range rt.Associations {
				if a.SubnetId != nil {
					item.SubnetIDs = append(item.SubnetIDs, *a.SubnetId)
				}
			}
			for _, r := range rt.Routes {
				dest := aws.ToString(r.DestinationCidrBlock)
				if dest == "" {
					continue
				}
				route := inventory.Route{Destination: dest}
				switch {
				case r.NatGatewayId != nil && *r.NatGatewayId != "":
					route.NextHopType = "NatGateway"
					route.NextHop = *r.NatGatewayId
				case r.InstanceId != nil && *r.InstanceId != "":
					route.NextHopType = "Instance"
					route.NextHop = *r.InstanceId
				default:
					continue
				}
				item.Routes = append(item.Routes, route)
			}
			g.RouteTables = append(g.RouteTables, item)
		}
	}
	return nil
}

func awsName(tags []ec2types.Tag, fallback string) string {
	for _, t := range tags {
		if aws.ToString(t.Key) == "Name" && aws.ToString(t.Value) != "" {
			return aws.ToString(t.Value)
		}
	}
	return fallback
}

func awsSGRules(perms []ec2types.IpPermission, direction string) []inventory.SGRule {
	var out []inventory.SGRule
	for _, p := range perms {
		proto := strings.ToLower(aws.ToString(p.IpProtocol))
		if proto == "-1" {
			proto = "all"
		}
		port := awsPort(p, proto)
		cidrs := p.IpRanges
		if len(cidrs) == 0 {
			out = append(out, inventory.SGRule{Direction: direction, Protocol: proto, Port: port, CIDR: "0.0.0.0/0"})
			continue
		}
		for _, r := range cidrs {
			out = append(out, inventory.SGRule{
				Direction:   direction,
				Protocol:    proto,
				Port:        port,
				CIDR:        aws.ToString(r.CidrIp),
				Description: aws.ToString(r.Description),
			})
		}
	}
	return out
}

func awsPort(p ec2types.IpPermission, proto string) string {
	if proto == "all" || proto == "icmp" {
		return "-1/-1"
	}
	from, to := int32(-1), int32(-1)
	if p.FromPort != nil {
		from = *p.FromPort
	}
	if p.ToPort != nil {
		to = *p.ToPort
	}
	return fmt.Sprintf("%d/%d", from, to)
}

func awsRootDisk(maps []ec2types.InstanceBlockDeviceMapping) *inventory.Disk {
	for _, m := range maps {
		if aws.ToString(m.DeviceName) == "/dev/sda1" || aws.ToString(m.DeviceName) == "/dev/xvda" {
			if m.Ebs != nil {
				return &inventory.Disk{Type: "gp3", Size: 0}
			}
		}
	}
	if len(maps) > 0 && maps[0].Ebs != nil {
		return &inventory.Disk{Type: "gp3"}
	}
	return nil
}


