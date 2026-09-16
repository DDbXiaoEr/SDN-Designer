import { createCloudContext, resolveNextHopNode, parsePortRange, resolveVpcRegion, resolveZone, instanceLoginAuth, resolveInstanceKeyPair, collectKeyPairs, collectExistingKeyPairs, escapeRegex, resolveInterconnects, routeTablesOfVpc, tlsKeyBlocks, hclLines, systemDiskConfig, dataDiskConfigs, clean } from './common.js'
import { translate } from '../../i18n/index.js'
import { buildOutputs } from './outputs.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'tencentcloud_vpc',
  subnet: 'tencentcloud_subnet',
  instance: 'tencentcloud_instance',
  securityGroup: 'tencentcloud_security_group',
  securityGroupRule: 'tencentcloud_security_group_rule',
  eip: 'tencentcloud_eip',
  natGateway: 'tencentcloud_nat_gateway',
  routeTable: 'tencentcloud_route_table',
  routeEntry: 'tencentcloud_route_entry',
  interconnect: 'tencentcloud_vpc_peering_connection',
}

const providerBlock = (providerVersion) => `terraform {
  required_providers {
    tencentcloud = {
      source  = "tencentcloudstack/tencentcloud"
      version = "${providerVersion}"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }
}

provider "tencentcloud" {
  region     = var.region
  secret_id  = var.secret_id
  secret_key = var.secret_key
}
`

const variablesBlock = (region) => `variable "region" {
  type    = string
  default = "${region}"
}

variable "secret_id" {
  type        = string
  description = "${tt('tencentSecretId')}"
  default     = ""
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('tencentSecretKey')}"
  default     = ""
  sensitive   = true
}
`

function tcProtocol(protocol) {
  if (protocol === 'all') return 'ALL'
  if (protocol === 'icmp') return 'ICMP'
  return protocol.toUpperCase()
}

// 腾讯云 port_range 语义：单端口 "22"、多端口 "80,443"、范围 "80-90"；
// 内部统一存 "起始/结束"，故起止相同输出单值，否则输出 "起-止"。
function tcPortRange(rule) {
  if (rule.protocol === 'icmp' || rule.protocol === 'all') return 'ALL'
  const raw = String(rule.port || '').trim()
  if (raw.includes(',')) return raw
  const port = parsePortRange(rule.port, rule.protocol)
  if (!port) return 'ALL'
  return port.from === port.to ? String(port.from) : `${port.from}-${port.to}`
}

function tencentChargeRows(chargeType) {
  if (chargeType === 'subscription') {
    return [
      ['instance_charge_type', '"PREPAID"'],
      ['instance_charge_type_prepaid_period', '1'],
    ]
  }
  if (chargeType === 'spot') {
    return [
      ['instance_charge_type', '"SPOTPAID"'],
      ['spot_instance_type', '"ONE-TIME"'],
      ['spot_max_price', '"0.50"'],
    ]
  }
  return [['instance_charge_type', '"POSTPAID_BY_HOUR"']]
}

export function exportTencentTerraform(nodes, edges, providerVersion) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const region = resolveVpcRegion(nodes, 'ap-guangzhou')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "tencentcloud_vpc" "${ctx.name(vpc)}" {
  name       = "${clean(vpc.data.name)}"
  cidr_block = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_subnet" "${ctx.name(sub)}" {
  vpc_id            = ${vpcRef}
  name              = "${clean(sub.data.name)}"
  cidr_block        = "${sub.data.cidr}"
  availability_zone = "${resolveZone(sub.data.zone, vpc?.data.region || region, 'tencent')}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    blocks.push(`resource "tencentcloud_security_group" "${ctx.name(sg)}" {
  name = "${clean(sg.data.name)}"
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const portRange = tcPortRange(rule)
      blocks.push(`resource "tencentcloud_security_group_rule" "${ctx.name(sg)}_${rule.direction}_${i}" {
  security_group_id = ${ref(sg)}.id
  type              = "${rule.direction}"
  cidr_ip           = "${rule.cidr}"
  ip_protocol       = "${tcProtocol(rule.protocol)}"
  port_range        = "${portRange}"
  policy            = "ACCEPT"
  description       = "${rule.description || ''}"
}`)
    })
  }

  for (const eip of nodes.filter((n) => n.type === 'Eip')) {
    const internetChargeType =
      eip.data.internetChargeType === 'payByBandwidth'
        ? 'BANDWIDTH_POSTPAID_BY_HOUR'
        : 'TRAFFIC_POSTPAID_BY_HOUR'
    blocks.push(`resource "tencentcloud_eip" "${ctx.name(eip)}" {
  name                       = "${clean(eip.data.name)}"
  internet_charge_type       = "${internetChargeType}"
  internet_max_bandwidth_out = ${Number(eip.data.bandwidth) || 5}
}`)
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Instance')
      .forEach((inst, i) => {
        blocks.push(`resource "tencentcloud_eip_association" "${ctx.name(eip)}_${i}" {
  eip_id      = ${ref(eip)}.id
  instance_id = ${ref(inst)}.id
}`)
      })
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const vpc = findVpc(gw)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_nat_gateway" "${ctx.name(gw)}" {
  name           = "${clean(gw.data.name)}"
  vpc_id         = ${vpcRef}
  bandwidth      = 100
  max_concurrent = 1000000
}`)
  }

  const keyPairs = collectKeyPairs(ctx, nodes)
  for (const [keyName, resName] of keyPairs) {
    blocks.push(`resource "tencentcloud_key_pair" "${resName}" {
  key_name   = "${keyName}"
  public_key = tls_private_key.${resName}.public_key_openssh
}

${tlsKeyBlocks(keyName, resName)}`)
  }

  // 关联现有密钥对：实例的 key_ids 需要密钥 ID，按名称查询 data source
  const existingKeyPairs = collectExistingKeyPairs(ctx, nodes)
  for (const [keyName, resName] of existingKeyPairs) {
    blocks.push(`data "tencentcloud_key_pairs" "${resName}" {
  key_name = "^${escapeRegex(keyName)}$"
}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const vpc = findVpc(inst)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    const subRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const auth = instanceLoginAuth(inst.data)
    const kp = resolveInstanceKeyPair(ctx, inst)
    const sysDisk = systemDiskConfig(inst.data, 'CLOUD_PREMIUM')
    const dataDisks = dataDiskConfigs(inst.data, 'CLOUD_PREMIUM')
    // 腾讯云实例必须指定可用区，优先从关联子网的可用区推导（与子网保持一致）
    const az = resolveZone(sub?.data.zone, vpc?.data.region || region, 'tencent')
    const rows = [
      ['instance_name', `"${clean(inst.data.name)}"`],
      ['image_id', `"${inst.data.imageId}"`],
      ['instance_type', `"${inst.data.instanceType}"`],
      ...tencentChargeRows(inst.data.chargeType),
      ['vpc_id', vpcRef],
      ['subnet_id', subRef],
      ['availability_zone', `"${az}"`],
      ['private_ip', `"${inst.data.privateIp}"`],
      ['system_disk_type', `"${sysDisk.type}"`],
      ['system_disk_size', String(sysDisk.size)],
    ]
    if (sgRefs.length) rows.push(['security_groups', `[${sgRefs.join(', ')}]`])
    if (kp) {
      // 新建密钥对引用生成的资源；关联现有密钥对通过 data source 查询 ID
      if (kp.mode === 'create') {
        rows.push(['key_ids', `[tencentcloud_key_pair.${keyPairs.get(kp.name)}.id]`])
      } else {
        rows.push([
          'key_ids',
          `[data.tencentcloud_key_pairs.${existingKeyPairs.get(kp.name)}.key_pair_list[0].key_id]`,
        ])
      }
    } else if (auth.type === 'password' && auth.value) {
      rows.push(['password', `"${auth.value}"`])
    }
    const dataDiskBlock = dataDisks.length
      ? '\n\n' +
        dataDisks
          .map(
            (d) => `  data_disks {
    data_disk_type = "${d.type}"
    data_disk_size = ${d.size}
  }`
          )
          .join('\n')
      : ''
    blocks.push(`resource "tencentcloud_instance" "${ctx.name(inst)}" {
${hclLines(rows)}${dataDiskBlock}
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_route_table" "${ctx.name(rt)}" {
  name   = "${clean(rt.data.name)}"
  vpc_id = ${vpcRef}
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      const hop = resolveNextHopNode(ctx, route, vpc)
      let nextType
      let nextHub
      if (route.nextHop) {
        nextType = route.nextHopType === 'Instance' ? 'CVM' : route.nextHopType === 'NatGateway' ? 'NAT' : 'VPN'
        nextHub = route.nextHop
      } else if (hop && route.nextHopType === 'NatGateway') {
        nextType = 'NAT'
        nextHub = ref(hop) + '.id'
      } else if (hop && route.nextHopType === 'Instance') {
        nextType = 'CVM'
        nextHub = ref(hop) + '.id'
      } else {
        nextType = 'NAT'
        nextHub = `"" # ${tt('fillNextHop')}`
      }
      blocks.push(`resource "tencentcloud_route_entry" "${ctx.name(rt)}_${i}" {
  route_table_id         = ${ref(rt)}.id
  destination_cidr_block = "${route.destination}"
  next_type              = "${nextType}"
  next_hub               = ${nextHub}
}`)
    })
  }

  let peerSeq = 0
  for (const { ic, pairs } of resolveInterconnects(ctx)) {
    for (const pair of pairs) {
      const peerRegion = clean(pair.a.data.region) || region
      blocks.push(`resource "tencentcloud_vpc_peering_connection" "${ctx.name(ic)}_${pair.key}" {
  vpc_id                  = ${ref(pair.a)}.id
  peer_vpc_id             = ${ref(pair.b)}.id
  peering_connection_name = "${clean(ic.data.name)}-${pair.key}"
  peer_region             = "${peerRegion}"
}`)
    }
    for (const pair of pairs) {
      for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]]) {
        for (const rt of routeTablesOfVpc(ctx, from)) {
          blocks.push(`resource "tencentcloud_route_entry" "${ctx.name(rt)}_peer_${peerSeq++}" {
  route_table_id         = ${ref(rt)}.id
  destination_cidr_block = "${to.data.cidr}"
  next_type              = "PEER_CONNECTION"
  next_hub               = ${ref(ic)}_${pair.key}.id
}`)
        }
      }
    }
  }

  return {
    provider: providerBlock(providerVersion),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
    outputs: buildOutputs(ctx, nodes, 'tencent'),
  }
}
