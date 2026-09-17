import { createCloudContext, resolveNextHopNode, resolveVpcRegion, resolveZone, gatewayEips, gatewaySnatSources, lbSubnets, instanceLoginAuth, resolveInstanceKeyPair, collectKeyPairs, resolveInterconnects, routeTablesOfVpc, hclLines, systemDiskConfig, dataDiskConfigs, clean } from './common.js'
import { translate } from '../../i18n/index.js'
import { buildOutputs } from './outputs.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'alicloud_vpc',
  subnet: 'alicloud_vswitch',
  instance: 'alicloud_instance',
  securityGroup: 'alicloud_security_group',
  securityGroupRule: 'alicloud_security_group_rule',
  eip: 'alicloud_eip',
  natGateway: 'alicloud_nat_gateway',
  loadBalancer: 'alicloud_slb_load_balancer',
  routeTable: 'alicloud_route_table',
  routeEntry: 'alicloud_route_entry',
  interconnect: 'alicloud_vpc_peer_connection',
}

const providerBlock = (providerVersion) => `terraform {
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = "${providerVersion}"
    }
  }
}

provider "alicloud" {
  region     = var.region
  access_key = var.access_key
  secret_key = var.secret_key
}
`

const variablesBlock = (region) => `variable "region" {
  type    = string
  default = "${region}"
}

variable "access_key" {
  type        = string
  description = "${tt('aliyunAccessKey')}"
  default     = ""
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('aliyunSecretKey')}"
  default     = ""
  sensitive   = true
}
`

function aliyunChargeRows(chargeType) {
  if (chargeType === 'subscription') {
    return [
      ['instance_charge_type', '"PrePaid"'],
      ['period_unit', '"Month"'],
      ['period', '1'],
    ]
  }
  if (chargeType === 'spot') {
    return [
      ['instance_charge_type', '"PostPaid"'],
      ['spot_strategy', '"SpotAsPriceGo"'],
    ]
  }
  return [['instance_charge_type', '"PostPaid"']]
}

export function exportAliyunTerraform(nodes, edges, providerVersion) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const region = resolveVpcRegion(nodes, 'cn-hangzhou')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "alicloud_vpc" "${ctx.name(vpc)}" {
  vpc_name   = "${clean(vpc.data.name)}"
  cidr_block = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_vswitch" "${ctx.name(sub)}" {
  vpc_id       = ${vpcRef}
  vswitch_name = "${clean(sub.data.name)}"
  cidr_block   = "${sub.data.cidr}"
  zone_id      = "${resolveZone(sub.data.zone, vpc?.data.region || region, 'aliyun')}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    const vpc = findVpc(sg)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_security_group" "${ctx.name(sg)}" {
  security_group_name = "${clean(sg.data.name)}"
  vpc_id              = ${vpcRef}
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const ipProtocol = rule.protocol === 'icmp' ? 'icmp' : rule.protocol === 'all' ? 'all' : rule.protocol
      const portRange = rule.protocol === 'icmp' || rule.protocol === 'all' ? '-1/-1' : rule.port
      blocks.push(`resource "alicloud_security_group_rule" "${ctx.name(sg)}_${rule.direction}_${i}" {
  type              = "${rule.direction}"
  ip_protocol       = "${ipProtocol}"
  port_range        = "${portRange}"
  security_group_id = ${ref(sg)}.id
  cidr_ip           = "${rule.cidr}"
  description       = "${rule.description || ''}"
}`)
    })
  }

  let snatSeq = 0 // SNAT 条目的资源名后缀，保证多个网关/子网组合唯一
  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const sub = findSubnet(gw)
    const vpc = findVpc(gw)
    const vpcRef = vpc ? ref(vpc) + '.id' : '""'
    const vswRef = sub ? ref(sub) + '.id' : '""'
    blocks.push(`resource "alicloud_nat_gateway" "${ctx.name(gw)}" {
  vpc_id           = ${vpcRef}
  vswitch_id       = ${vswRef}
  nat_gateway_name = "${clean(gw.data.name)}"
  nat_type         = "Enhanced"
}`)
    // SNAT 来源：子网按 vswitch 生成；实例降级到其实例所属子网；VPC 用 source_cidr（阿里云原生支持）
    const eips = gatewayEips(ctx, gw)
    const { vpcs, subnets, instances } = gatewaySnatSources(ctx, gw)
    const vpcIds = new Set(vpcs.map((v) => v.id))
    const snatSubnets = new Map(subnets.map((s) => [s.id, s]))
    for (const inst of instances) {
      const instSub = findSubnet(inst)
      if (instSub) snatSubnets.set(instSub.id, instSub)
    }
    for (const snatSub of snatSubnets.values()) {
      // 该子网所属 VPC 已接入时由 source_cidr 覆盖，避免重复/冲突的 SNAT 条目
      const subVpc = findVpc(snatSub)
      if (subVpc && vpcIds.has(subVpc.id)) continue
      for (const eip of eips) {
        blocks.push(`resource "alicloud_snat_entry" "${ctx.name(gw)}_snat_${snatSeq++}" {
  snat_table_id     = ${ref(gw)}.snat_table_ids
  source_vswitch_id = ${ref(snatSub)}.id
  snat_ip           = ${ref(eip)}.ip_address
}`)
      }
    }
    for (const vpcSrc of vpcs) {
      for (const eip of eips) {
        blocks.push(`resource "alicloud_snat_entry" "${ctx.name(gw)}_snat_${snatSeq++}" {
  snat_table_id = ${ref(gw)}.snat_table_ids
  source_cidr   = "${vpcSrc.data.cidr}"
  snat_ip       = ${ref(eip)}.ip_address
}`)
      }
    }
  }

  for (const eip of nodes.filter((n) => n.type === 'Eip')) {
    const internetChargeType =
      eip.data.internetChargeType === 'payByBandwidth' ? 'PayByBandwidth' : 'PayByTraffic'
    blocks.push(`resource "alicloud_eip" "${ctx.name(eip)}" {
  bandwidth            = "${eip.data.bandwidth}"
  internet_charge_type = "${internetChargeType}"
}`)
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Instance')
      .forEach((inst, i) => {
        blocks.push(`resource "alicloud_eip_association" "${ctx.name(eip)}_${i}" {
  allocation_id = ${ref(eip)}.id
  instance_id   = ${ref(inst)}.id
}`)
      })
    // Eip -> Gateway：把 EIP 绑定到 NAT 网关作为公网出口（instance_type 需为 Nat）
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Gateway')
      .forEach((gw, i) => {
        blocks.push(`resource "alicloud_eip_association" "${ctx.name(eip)}_gw_${i}" {
  allocation_id = ${ref(eip)}.id
  instance_id   = ${ref(gw)}.id
  instance_type = "Nat"
}`)
      })
  }

  // 负载均衡：SLB 实例 + 每个监听规则一个虚拟服务器组/监听器 + 后端附件
  for (const lb of nodes.filter((n) => n.type === 'LoadBalancer')) {
    const sub = lbSubnets(ctx, lb)[0]
    const rows = [
      ['load_balancer_name', `"${clean(lb.data.name)}"`],
      ['address_type', lb.data.internal ? '"intranet"' : '"internet"'],
      ['load_balancer_spec', '"slb.s2.small"'],
    ]
    if (sub) rows.push(['vswitch_id', `${ref(sub)}.id`])
    blocks.push(`resource "alicloud_slb_load_balancer" "${ctx.name(lb)}" {
${hclLines(rows)}
}`)
    ;(lb.data.rules || []).forEach((rule, ri) => {
      const ruleName = `${ctx.name(lb)}_${ri}`
      const sgName = `${ruleName}_sg`
      const port = Number(rule.port) || 80
      const proto = String(rule.protocol || 'tcp').toLowerCase()
      blocks.push(`resource "alicloud_slb_server_group" "${sgName}" {
  load_balancer_id = ${ref(lb)}.id
  name             = "${clean(lb.data.name)}-${ri}"
}`)
      const lrows = [
        ['load_balancer_id', `${ref(lb)}.id`],
        ['frontend_port', String(port)],
        ['backend_port', String(port)],
        ['protocol', `"${proto}"`],
        ['server_group_id', `alicloud_slb_server_group.${sgName}.id`],
      ]
      // HTTPS 监听器的 bandwidth 为必填
      if (proto === 'https') lrows.push(['bandwidth', '10'])
      blocks.push(`resource "alicloud_slb_listener" "${ruleName}" {
${hclLines(lrows)}
}`)
      ;(rule.backends || []).forEach((bid, bi) => {
        const inst = ctx.byId.get(bid)
        if (!inst || inst.type !== 'Instance') return
        blocks.push(`resource "alicloud_slb_server_group_server_attachment" "${ruleName}_${bi}" {
  server_group_id = alicloud_slb_server_group.${sgName}.id
  server_id       = ${ref(inst)}.id
  port            = ${port}
  type            = "ecs"
}`)
      })
    })
  }

  const keyPairs = collectKeyPairs(ctx, nodes)
  for (const [keyName, resName] of keyPairs) {
    blocks.push(`resource "alicloud_key_pair" "${resName}" {
  key_name = "${keyName}"
  key_file = "${keyName}.pem"
}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const auth = instanceLoginAuth(inst.data)
    const kp = resolveInstanceKeyPair(ctx, inst)
    const sysDisk = systemDiskConfig(inst.data, 'cloud_essd')
    const dataDisks = dataDiskConfigs(inst.data, 'cloud_essd')
    const rows = [
      ['instance_name', `"${clean(inst.data.name)}"`],
      ['instance_type', `"${inst.data.instanceType}"`],
      ['image_id', `"${inst.data.imageId}"`],
      ...aliyunChargeRows(inst.data.chargeType),
      ['vswitch_id', vswRef],
      ['private_ip', `"${inst.data.privateIp}"`],
      ['internet_max_bandwidth_out', '0'],
      ['system_disk_category', `"${sysDisk.type}"`],
      ['system_disk_size', String(sysDisk.size)],
    ]
    if (sgRefs.length) rows.push(['security_groups', `[${sgRefs.join(', ')}]`])
    if (kp) {
      // 新建密钥对引用生成的资源；关联现有密钥对直接按名称引用
      if (kp.mode === 'create') {
        rows.push(['key_name', `alicloud_key_pair.${keyPairs.get(kp.name)}.key_name`])
      } else {
        rows.push(['key_name', `"${kp.name}"`])
      }
    } else if (auth.type === 'password' && auth.value) {
      rows.push(['password', `"${auth.value}"`])
    }
    const dataDiskBlock = dataDisks.length
      ? '\n\n' +
        dataDisks
          .map(
            (d) => `  data_disks {
    category = "${d.type}"
    size     = ${d.size}
  }`
          )
          .join('\n')
      : ''
    blocks.push(`resource "alicloud_instance" "${ctx.name(inst)}" {
${hclLines(rows)}${dataDiskBlock}
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_route_table" "${ctx.name(rt)}" {
  vpc_id           = ${vpcRef}
  route_table_name = "${clean(rt.data.name)}"
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      let nexthopId = route.nextHop
      if (!nexthopId) {
        const hop = resolveNextHopNode(ctx, route, vpc)
        if (hop) nexthopId = ref(hop) + '.id'
      }
      if (!nexthopId) nexthopId = `"" # ${tt('fillNextHop')}`
      blocks.push(`resource "alicloud_route_entry" "${ctx.name(rt)}_${i}" {
  route_table_id        = ${ref(rt)}.id
  destination_cidrblock = "${route.destination}"
  nexthop_type          = "${route.nextHopType}"
  nexthop_id            = ${nexthopId}
}`)
    })
  }

  let peerSeq = 0
  for (const { ic, pairs } of resolveInterconnects(ctx)) {
    for (const pair of pairs) {
      const peerRegion = clean(pair.a.data.region) || region
      blocks.push(`resource "alicloud_vpc_peer_connection" "${ctx.name(ic)}_${pair.key}" {
  vpc_id         = ${ref(pair.a)}.id
  peer_vpc_id    = ${ref(pair.b)}.id
  peer_region_id = "${peerRegion}"
}`)
    }
    for (const pair of pairs) {
      for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]]) {
        for (const rt of routeTablesOfVpc(ctx, from)) {
          blocks.push(`resource "alicloud_route_entry" "${ctx.name(rt)}_peer_${peerSeq++}" {
  route_table_id        = ${ref(rt)}.id
  destination_cidrblock = "${to.data.cidr}"
  nexthop_type          = "VpcPeer"
  nexthop_id            = ${ref(ic)}_${pair.key}.id
}`)
        }
      }
    }
  }

  return {
    provider: providerBlock(providerVersion),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
    outputs: buildOutputs(ctx, nodes, 'aliyun'),
  }
}
