import { createCloudContext, resolveNextHopNode, parsePortRange, resolveVpcRegion, resolveZone, instanceLoginAuth, resolveInstanceKeyPair, collectKeyPairs, resolveInterconnects, routeTablesOfVpc, tlsKeyBlocks, hclLines, systemDiskConfig, dataDiskConfigs, clean } from './common.js'
import { translate } from '../../i18n/index.js'
import { buildOutputs } from './outputs.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'huaweicloud_vpc',
  subnet: 'huaweicloud_vpc_subnet',
  instance: 'huaweicloud_compute_instance',
  securityGroup: 'huaweicloud_networking_secgroup',
  securityGroupRule: 'huaweicloud_networking_secgroup_rule',
  eip: 'huaweicloud_vpc_eip',
  natGateway: 'huaweicloud_nat_gateway',
  routeTable: 'huaweicloud_vpc_route_table',
  routeEntry: 'huaweicloud_vpc_route',
  interconnect: 'huaweicloud_vpc_peering_connection',
}

const providerBlock = () => `terraform {
  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = "~> 1.60"
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

provider "huaweicloud" {
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
  description = "${tt('huaweiAccessKey')}"
  default     = ""
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('huaweiSecretKey')}"
  default     = ""
  sensitive   = true
}
`

function hwProtocol(protocol) {
  if (protocol === 'all') return ''
  return protocol
}

// 华为云实例镜像：ID 形如 UUID 时用 image_id，否则按镜像名称使用 image_name
function huaweiImageRow(image) {
  const value = clean(image)
  if (/^[0-9a-f][0-9a-f-]{31,}$/i.test(value)) return ['image_id', `"${value}"`]
  return ['image_name', `"${value}"`]
}

function huaweiChargeRows(chargeType) {
  if (chargeType === 'subscription') {
    return [
      ['charging_mode', '"prePaid"'],
      ['period_unit', '"month"'],
      ['period', '1'],
    ]
  }
  if (chargeType === 'spot') {
    return [
      ['charging_mode', '"spot"'],
      ['spot_maximum_price', '"0.5"'],
    ]
  }
  return [['charging_mode', '"postPaid"']]
}

export function exportHuaweiTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const region = resolveVpcRegion(nodes, 'cn-north-4')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "huaweicloud_vpc" "${ctx.name(vpc)}" {
  name = "${clean(vpc.data.name)}"
  cidr = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "huaweicloud_vpc_subnet" "${ctx.name(sub)}" {
  name              = "${clean(sub.data.name)}"
  cidr              = "${sub.data.cidr}"
  vpc_id            = ${vpcRef}
  availability_zone = "${resolveZone(sub.data.zone, vpc?.data.region || region, 'huawei')}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    blocks.push(`resource "huaweicloud_networking_secgroup" "${ctx.name(sg)}" {
  name = "${clean(sg.data.name)}"
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const port = parsePortRange(rule.port, rule.protocol)
      const min = port ? port.from : 'null'
      const max = port ? port.to : 'null'
      blocks.push(`resource "huaweicloud_networking_secgroup_rule" "${ctx.name(sg)}_${rule.direction}_${i}" {
  direction         = "${rule.direction}"
  protocol          = "${hwProtocol(rule.protocol)}"
  port_range_min    = ${min}
  port_range_max    = ${max}
  remote_ip_prefix  = "${rule.cidr}"
  security_group_id = ${ref(sg)}.id
  description       = "${rule.description || ''}"
}`)
    })
  }

  for (const eip of nodes.filter((n) => n.type === 'Eip')) {
    const chargeMode = eip.data.internetChargeType === 'payByBandwidth' ? 'bandwidth' : 'traffic'
    blocks.push(`resource "huaweicloud_vpc_eip" "${ctx.name(eip)}" {
  publicip {
    type = "5_bgp"
  }
  bandwidth {
    name        = "${clean(eip.data.name)}"
    share_type  = "PER"
    size        = ${Number(eip.data.bandwidth) || 5}
    charge_mode = "${chargeMode}"
  }
}`)
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Instance')
      .forEach((inst, i) => {
        blocks.push(`resource "huaweicloud_compute_eip_associate" "${ctx.name(eip)}_${i}" {
  public_ip   = ${ref(eip)}.address
  instance_id = ${ref(inst)}.id
}`)
      })
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const sub = findSubnet(gw)
    const vpc = findVpc(gw)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    const subRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    blocks.push(`resource "huaweicloud_nat_gateway" "${ctx.name(gw)}" {
  name      = "${clean(gw.data.name)}"
  vpc_id    = ${vpcRef}
  subnet_id = ${subRef}
  spec      = "1"
}`)
  }

  const keyPairs = collectKeyPairs(ctx, nodes)
  for (const [keyName, resName] of keyPairs) {
    blocks.push(`resource "huaweicloud_compute_keypair" "${resName}" {
  name       = "${keyName}"
  public_key = tls_private_key.${resName}.public_key_openssh
}

${tlsKeyBlocks(keyName, resName)}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const subRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgNames = sgs.map((s) => `"${clean(s.data.name)}"`)
    const auth = instanceLoginAuth(inst.data)
    const kp = resolveInstanceKeyPair(ctx, inst)
    const sysDisk = systemDiskConfig(inst.data, 'GPSSD')
    const dataDisks = dataDiskConfigs(inst.data, 'GPSSD')
    const rows = [
      ['name', `"${clean(inst.data.name)}"`],
      huaweiImageRow(inst.data.imageId),
      ['flavor_id', `"${inst.data.instanceType}"`],
      ...huaweiChargeRows(inst.data.chargeType),
      ['system_disk_type', `"${sysDisk.type}"`],
      ['system_disk_size', String(sysDisk.size)],
    ]
    if (kp) {
      // 新建密钥对引用生成的资源；关联现有密钥对直接按名称引用
      if (kp.mode === 'create') {
        rows.push(['key_pair', `huaweicloud_compute_keypair.${keyPairs.get(kp.name)}.name`])
      } else {
        rows.push(['key_pair', `"${kp.name}"`])
      }
    } else if (auth.type === 'password' && auth.value) {
      rows.push(['admin_pass', `"${auth.value}"`])
    }
    if (sgNames.length) rows.push(['security_groups', `[${sgNames.join(', ')}]`])
    const dataDiskBlock = dataDisks.length
      ? '\n\n' +
        dataDisks
          .map(
            (d) => `  data_disks {
    type = "${d.type}"
    size = ${d.size}
  }`
          )
          .join('\n')
      : ''
    blocks.push(`resource "huaweicloud_compute_instance" "${ctx.name(inst)}" {
${hclLines(rows)}${dataDiskBlock}

  network {
    uuid        = ${subRef}
    fixed_ip_v4 = "${inst.data.privateIp}"
  }
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "huaweicloud_vpc_route_table" "${ctx.name(rt)}" {
  name   = "${clean(rt.data.name)}"
  vpc_id = ${vpcRef}
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      const hop = resolveNextHopNode(ctx, route, vpc)
      let type
      let nexthop
      if (route.nextHop) {
        type = route.nextHopType === 'Instance' ? 'ecs' : route.nextHopType === 'NatGateway' ? 'nat' : 'vpn'
        nexthop = route.nextHop
      } else if (hop && route.nextHopType === 'NatGateway') {
        type = 'nat'
        nexthop = ref(hop) + '.id'
      } else if (hop && route.nextHopType === 'Instance') {
        type = 'ecs'
        nexthop = ref(hop) + '.id'
      } else {
        type = 'nat'
        nexthop = `"" # ${tt('fillNextHop')}`
      }
      blocks.push(`resource "huaweicloud_vpc_route" "${ctx.name(rt)}_${i}" {
  vpc_id      = ${vpcRef}
  destination = "${route.destination}"
  type        = "${type}"
  nexthop     = ${nexthop}
}`)
    })
  }

  let peerSeq = 0
  for (const { ic, pairs } of resolveInterconnects(ctx)) {
    for (const pair of pairs) {
      blocks.push(`resource "huaweicloud_vpc_peering_connection" "${ctx.name(ic)}_${pair.key}" {
  name        = "${clean(ic.data.name)}-${pair.key}"
  vpc_id      = ${ref(pair.a)}.id
  peer_vpc_id = ${ref(pair.b)}.id
}`)
    }
    for (const pair of pairs) {
      for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]]) {
        for (const rt of routeTablesOfVpc(ctx, from)) {
          blocks.push(`resource "huaweicloud_vpc_route" "${ctx.name(rt)}_peer_${peerSeq++}" {
  vpc_id      = ${ref(from)}.id
  destination = "${to.data.cidr}"
  type        = "peering"
  nexthop     = ${ref(ic)}_${pair.key}.id
}`)
        }
      }
    }
  }

  return {
    provider: providerBlock(),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
    outputs: buildOutputs(ctx, nodes, 'huawei'),
  }
}
