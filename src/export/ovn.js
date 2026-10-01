import { buildGraph, parseCidr, generateMac, slug, computeZones } from './utils.js'
import { translate } from '../i18n/index.js'

const tt = (key, params) => translate(`export.${key}`, params)

// 网卡角色：兼容旧的 tunnel 布尔字段
function roleOf(nic) {
  if (!nic) return 'mgmt'
  if (nic.role) return nic.role
  return nic.tunnel ? 'tunnel' : 'mgmt'
}

function tunnelNicOf(host) {
  return (host.data.nics || []).find((n) => roleOf(n) === 'tunnel') || null
}

// 外部网卡的 network_name，缺省回退 external
function nicNetworkName(nic) {
  return (nic && nic.networkName) || 'external'
}

function externalNicOf(host) {
  return (host.data.nics || []).find((n) => roleOf(n) === 'external') || null
}

function externalNicsOf(host) {
  return (host.data.nics || []).filter((n) => roleOf(n) === 'external')
}

function neighborsOf(id, sourceNodes, targetNodes) {
  return [...sourceNodes(id), ...targetNodes(id)]
}

// 计算节点接入控制面：直连控制节点，或所在集群连到控制节点（等效集群内全部节点接入）
function isJoinedToController(host, controllerHost, sourceNodes, targetNodes) {
  if (!controllerHost) return false
  if (neighborsOf(host.id, sourceNodes, targetNodes).some((n) => n.id === controllerHost.id)) return true
  const clusterId = host.parentNode
  if (!clusterId) return false
  return neighborsOf(clusterId, sourceNodes, targetNodes).some((n) => n.id === controllerHost.id)
}

// 逻辑交换机部署到的计算 Host：直连 Host，或连到 Cluster（= 该 zone 内全部节点）
function deployedHostsOf(ls, nodes, sourceNodes, targetNodes) {
  const ids = new Set()
  for (const n of [...sourceNodes(ls.id), ...targetNodes(ls.id)]) {
    if (!n) continue
    if (n.type === 'Host') ids.add(n.id)
    else if (n.type === 'Cluster') {
      for (const h of nodes) {
        if (h.type === 'Host' && h.parentNode === n.id) ids.add(h.id)
      }
    }
  }
  return [...ids]
}

// veth 名最长 15 字节：宿主机侧 vh-、临时对端 vn-（移入 netns 后改名为 eth0）
function vethPair(ns) {
  const base = ns.length <= 12 ? ns : ns.slice(0, 12)
  return { host: `vh-${base}`, peer: `vn-${base}` }
}

// 外部网桥 IP：nic.ip 已带前缀则原样使用，否则补上网段前缀
function nicCidr(nic, prefix) {
  const ip = String(nic.ip || '').trim()
  if (!ip) return ''
  return ip.includes('/') ? ip : `${ip}/${prefix || 24}`
}

function emitNetns(h, vm, info) {
  const ns = info.ns
  const { host: vethHost, peer: vethPeer } = vethPair(ns)
  const cidrInfo = info.ls ? parseCidr(info.ls.data.subnet) : null
  const prefix = cidrInfo ? cidrInfo.prefix : 24
  const gateway = cidrInfo ? cidrInfo.gateway : null
  h(`# ${tt('vmDeployedTo', { name: vm.data.name, host: info.host.data.name })}`)
  h(`ip netns add ${ns}`)
  h(`ip link add ${vethHost} type veth peer name ${vethPeer}`)
  h(`ip link set ${vethPeer} netns ${ns}`)
  h(`ip link set ${vethHost} up`)
  h(`ip netns exec ${ns} ip link set ${vethPeer} name eth0`)
  h(`ip netns exec ${ns} ip link set eth0 address ${info.mac}`)
  h(`ip netns exec ${ns} ip addr add ${info.ip}/${prefix} dev eth0`)
  h(`ip netns exec ${ns} ip link set eth0 up`)
  h(`ip netns exec ${ns} ip link set lo up`)
  if (gateway) h(`ip netns exec ${ns} ip route add default via ${gateway}`)
  h(`ovs-vsctl --may-exist add-port br-int ${vethHost} -- set Interface ${vethHost} external_ids:iface-id="${info.port}"`)
  h()
}

// 规划路由器端口：每个「交换机-路由器」连接一对端口，端口 MAC 全局唯一
// 外部交换机对应的端口使用 externalIp/externalMac；内部端口使用子网网关地址
export function routerPortPlan(nodes, edges) {
  const { sourceNodes, targetNodes } = buildGraph(nodes, edges)
  const switches = nodes.filter((n) => n.type === 'LogicalSwitch')
  const plan = []
  const seen = new Set()
  let seq = 0
  for (const ls of switches) {
    const cidr = parseCidr(ls.data.subnet)
    for (const n of [...sourceNodes(ls.id), ...targetNodes(ls.id)]) {
      if (!n || n.type !== 'LogicalRouter') continue
      const key = `${n.id}|${ls.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const external = !!ls.data.isExternal
      const seed = 0x1000 + seq++
      const mac = external && n.data.externalMac ? n.data.externalMac : generateMac(seed)
      const rawIp = external ? String(n.data.externalIp || '').trim() : ''
      let ip
      if (external) {
        if (rawIp.includes('/')) ip = rawIp
        else ip = `${rawIp || (cidr ? cidr.gateway : '172.16.130.10')}/${cidr ? cidr.prefix : 24}`
      } else {
        ip = cidr ? `${cidr.gateway}/${cidr.prefix}` : '10.0.0.1/24'
      }
      plan.push({
        lr: n,
        ls,
        external,
        lrPort: `${slug(n.data.name)}_to_${slug(ls.data.name)}`,
        lsPort: `${slug(ls.data.name)}_to_${slug(n.data.name)}`,
        mac,
        ip,
        prefix: cidr ? cidr.prefix : 24,
      })
    }
  }
  return plan
}

// 网关 chassis 宿主机的物理链路健康探测脚本（方案 B：轮询 + ovn-nbctl 动态调整）
// OVN 不感知物理链路 down：link down 时撤销本节点 gateway-chassis，link up 恢复
function gatewayHaScript(host, enic, entries, centralIp) {
  const lines = []
  const h = (s = '') => lines.push(s)
  h(`# ${tt('haScriptTitle', { name: host.data.name, nic: enic ? enic.name : '' })}`)
  h(`# ${tt('haScriptHint')}`)
  // 常驻探测：关闭 errexit，且各命令容错，避免重复 set/del 报错导致探针退出
  h(`set +e  # ${tt('haNoErrexit')}`)
  h(`CENTRAL_NB="tcp:${centralIp}:6641"  # ${tt('haCentralDb')}`)
  h(`NIC="${enic ? enic.name : ''}"`)
  h(`INTERVAL=5  # ${tt('haWatchInterval')}`)
  h()
  h('check() {')
  h('  local lrport="$1" priority="$2"')
  h('  if ip link show "$NIC" 2>/dev/null | grep -q "state UP"; then')
  h(`    ovn-nbctl --db="$CENTRAL_NB" lrp-set-gateway-chassis "$lrport" "${host.data.name}" "$priority" 2>/dev/null || true`)
  h('  else')
  h(`    ovn-nbctl --db="$CENTRAL_NB" lrp-del-gateway-chassis "$lrport" "${host.data.name}" 2>/dev/null || true`)
  h('  fi')
  h('}')
  h()
  h("trap 'exit 0' TERM INT")
  h('while true; do')
  for (const e of entries) h(`  check ${e.lrPort} ${e.priority}`)
  h('  sleep "$INTERVAL"')
  h('done')
  return lines.join('\n')
}

// 生成 ovn-nbctl / ovs-vsctl 命令行脚本
// 返回 { targets, all }：
//   targets - 按执行节点拆分的命令（central 控制节点 + 每个计算宿主机）
//   all     - 完整脚本 { content, filename }
// 控制节点运行 ovn-nbctl / ovn-sbctl（以及部署在其上的 netns）；不注册为 chassis，不参与隧道
export function exportOvn(nodes, edges) {
  const { byId, sourceNodes, targetNodes } = buildGraph(nodes, edges)
  const switches = nodes.filter((n) => n.type === 'LogicalSwitch')
  const routers = nodes.filter((n) => n.type === 'LogicalRouter')
  const vms = nodes.filter((n) => n.type === 'VM')
  const hosts = nodes.filter((n) => n.type === 'Host')
  const controllerHost = hosts.find((h) => h.data.controller) || null
  const computeHosts = hosts.filter((h) => h !== controllerHost)
  const centralHost = controllerHost || hosts[0] || null
  const centralIp = centralHost ? (tunnelNicOf(centralHost)?.ip || '') : ''

  const zones = computeZones(nodes, edges)
  const zoneByHost = new Map()
  zones.forEach((ids) => ids.forEach((id) => zoneByHost.set(id, ids)))

  const portPlan = routerPortPlan(nodes, edges)
  const defaultBridge = 'br-ex'

  // ---- 控制节点命令（ovn-nbctl / ovn-sbctl）----
  const central = []
  const c = (s = '') => central.push(s)

  if (controllerHost) {
    c(`# ${tt('centralOnHost', { name: controllerHost.data.name })}`)
    c(`# ${tt('centralNotChassis')}`)
    c()
  }

  if (switches.length) {
    c(`# ---- ${tt('logicalSwitches')} ----`)
    for (const ls of switches) {
      c(`ovn-nbctl ls-add ${slug(ls.data.name)}`)
      if (ls.data.isExternal) {
        const name = ls.data.networkName || 'external'
        const port = `${slug(ls.data.name)}-localnet`
        c(`ovn-nbctl lsp-add ${slug(ls.data.name)} ${port}`)
        c(`ovn-nbctl lsp-set-type ${port} localnet`)
        c(`ovn-nbctl lsp-set-options ${port} network_name=${name}`)
        if (ls.data.unknownAddresses !== false) c(`ovn-nbctl lsp-set-addresses ${port} unknown`)
      }
      const deployedHosts = deployedHostsOf(ls, nodes, sourceNodes, targetNodes)
      if (deployedHosts.length) {
        const zoneHosts = new Set()
        for (const id of deployedHosts) {
          const comp = zoneByHost.get(id) || [id]
          comp.forEach((zid) => zoneHosts.add(zid))
        }
        const hostNames = [...zoneHosts].map((id) => byId.get(id)?.data?.name).filter(Boolean).join(', ')
        c(`# ${tt('switchDeployedTo', { name: ls.data.name, hosts: hostNames })}`)
      }
    }
    c()
  }

  if (routers.length) {
    c(`# ---- ${tt('logicalRouters')} ----`)
    for (const lr of routers) {
      c(`ovn-nbctl lr-add ${slug(lr.data.name)}`)
      if (lr.data.externalNetwork) {
        c(`# ${tt(lr.data.distributed ? 'routerDistributed' : 'routerCentralized', { name: slug(lr.data.name) })}`)
      }
    }
    c()
  }

  c(`# ---- ${tt('switchRouter')} ----`)
  for (const p of portPlan) {
    c(`# ${tt('connect')} ${p.ls.data.name} <-> ${p.lr.data.name}`)
    c(`ovn-nbctl lrp-add ${slug(p.lr.data.name)} ${p.lrPort} ${p.mac} ${p.ip}`)
    c(`ovn-nbctl lsp-add ${slug(p.ls.data.name)} ${p.lsPort}`)
    c(`ovn-nbctl lsp-set-type ${p.lsPort} router`)
    c(`ovn-nbctl lsp-set-addresses ${p.lsPort} router`)
    c(`ovn-nbctl lsp-set-options ${p.lsPort} router-port=${p.lrPort}`)
    c()
  }

  // ---- NAT 规则（snat / dnat_and_snat）----
  const natLines = []
  for (const lr of routers) {
    const extPort = portPlan.find((p) => p.lr.id === lr.id && p.external)
    for (const nat of lr.data.nats || []) {
      if (nat.enabled === false) continue
      const externalIp = String(nat.externalIp || lr.data.externalIp || '').trim()
      const logicalIp = String(nat.logicalIp || '').trim()
      if (!externalIp || !logicalIp) continue
      if (nat.type === 'dnat_and_snat') {
        const args = [externalIp, logicalIp]
        if (nat.logicalPort) args.push(nat.logicalPort)
        if (nat.externalMac) args.push(nat.externalMac)
        natLines.push(`ovn-nbctl lr-nat-add ${slug(lr.data.name)} dnat_and_snat ${args.join(' ')}`)
      } else {
        natLines.push(`ovn-nbctl lr-nat-add ${slug(lr.data.name)} snat ${externalIp} ${logicalIp}`)
      }
    }
    // 外部口但未配置 NAT 时给出注释，便于人工补齐
    if (lr.data.externalNetwork && extPort && !(lr.data.nats || []).length) {
      natLines.push(`# ${tt('natNoneForRouter', { name: slug(lr.data.name) })}`)
    }
  }
  if (natLines.length) {
    c(`# ---- ${tt('natRules')} ----`)
    natLines.forEach((l) => c(l))
    c()
  }

  // ---- 外部口网关 chassis（高可用，优先级高者优先）----
  const chassisPlan = []
  // 按宿主机聚合其网关 chassis 项，用于生成物理链路健康探测脚本
  const gatewayHosts = new Map()
  for (const lr of routers) {
    const extPort = portPlan.find((p) => p.lr.id === lr.id && p.external)
    if (!extPort) continue
    for (const entry of lr.data.gatewayChassis || []) {
      const host = byId.get(entry.hostId)
      if (!host) continue
      const priority = entry.priority != null && entry.priority !== '' ? Number(entry.priority) : 20
      chassisPlan.push(`ovn-nbctl lrp-set-gateway-chassis ${extPort.lrPort} ${slug(host.data.name)} ${priority}`)
      if (!gatewayHosts.has(host.id)) gatewayHosts.set(host.id, [])
      gatewayHosts.get(host.id).push({ lrPort: extPort.lrPort, priority })
    }
  }
  if (chassisPlan.length) {
    c(`# ---- ${tt('gatewayChassis')} ----`)
    chassisPlan.forEach((l) => c(l))
    c()
  }

  // 每个 VM(netns) 的端口信息：挂交换机 + 部署宿主机
  const vmInfos = vms.map((vm, i) => {
    const ls = targetNodes(vm.id).find((n) => n.type === 'LogicalSwitch') || null
    const host = targetNodes(vm.id).find((n) => n.type === 'Host') || null
    const ns = slug(vm.data.name)
    return {
      vm,
      ls,
      host,
      ns,
      mac: vm.data.mac || generateMac(0xbb00 + i),
      ip: vm.data.ip || '10.0.0.2',
      port: ls ? `${slug(ls.data.name)}_${ns}_port` : null,
    }
  })

  c(`# ---- ${tt('vmPorts')} ----`)
  for (const info of vmInfos) {
    const { vm, ls, host, mac, ip, port } = info
    if (!ls) {
      c(`# ${tt('vmNotAttached', { name: vm.data.name })}`)
      continue
    }
    c(`ovn-nbctl lsp-add ${slug(ls.data.name)} ${port}`)
    c(`ovn-nbctl lsp-set-addresses ${port} "${mac} ${ip}"`)
    // requested-chassis 把逻辑端口绑到部署宿主机，ovn-controller 只在该节点上绑定 VIF
    if (host) {
      c(`ovn-nbctl lsp-set-options ${port} requested-chassis=${host.data.name}`)
      if (host === controllerHost) {
        c(`# ${tt('vmOnController', { name: vm.data.name, host: host.data.name })}`)
      }
    } else {
      c(`# ${tt('vmNotDeployed', { name: vm.data.name })}`)
    }
    c()
  }

  // 控制节点本机也跑命令：部署在控制节点上的 netns 写进 central 脚本
  const onController = controllerHost
    ? vmInfos.filter((info) => info.host && info.host.id === controllerHost.id && info.ls)
    : []
  if (onController.length) {
    c(`# ---- ${tt('vmNetns')} ----`)
    c('ovs-vsctl --may-exist add-br br-int')
    for (const info of onController) emitNetns(c, info.vm, info)
  }

  // 控制面监听：NB/SB 数据库开启 TCP 端口（6641/6642），供计算节点 ovn-controller 连接
  c(`# ---- ${tt('centralConnection')} ----`)
  c('ovn-nbctl set-connection ptcp:6641')
  c('ovn-sbctl set-connection ptcp:6642')
  c()
  c(`# ${tt('chassisAuto')}`)
  c()

  // ---- 每个计算宿主机命令（ovs-vsctl）----
  const hostBodies = new Map()
  for (const host of computeHosts) {
    const lines = []
    const h = (s = '') => lines.push(s)
    const nic = tunnelNicOf(host)
    if (!nic) {
      h(`# ${tt('hostNoNic', { name: host.data.name })}`)
    } else {
      h(`# ${tt('hostTunnelNic', { name: host.data.name, nic: nic.name, ip: nic.ip })}`)
      const joined = !controllerHost || isJoinedToController(host, controllerHost, sourceNodes, targetNodes)
      const remoteIp = joined ? centralIp : ''
      if (controllerHost && !joined) {
        h(`# ${tt('hostNotJoined', { name: host.data.name })}`)
      } else if (!remoteIp) {
        h(`# ${tt('ovnRemoteTodo')}`)
      }
      const ids = [
        remoteIp ? `external_ids:ovn-remote="tcp:${remoteIp}:6642"` : null,
        `external_ids:system-id="${host.data.name}"`,
        `external_ids:ovn-encap-ip="${nic.ip}"`,
        `external_ids:ovn-encap-type=${host.data.encapType}`,
      ].filter(Boolean)
      h('ovs-vsctl set open_vswitch . \\')
      ids.forEach((id, i) => h(`  ${id}${i < ids.length - 1 ? ' \\' : ''}`))
    }

    // 外部网桥：每块外部网卡入桥、迁移 IP；bridge-mappings 按各网卡自己的 network_name 生成，
    // 实现「网卡 network_name ↔ 外部交换机 network_name」的精确绑定
    const enics = externalNicsOf(host)
    if (enics.length) {
      const prefix = parseCidr((switches.find((s) => s.data.isExternal) || {}).data?.subnet)?.prefix || 24
      const mappings = []
      for (const enic of enics) {
        const bridge = enic.bridge || defaultBridge
        const cidr = nicCidr(enic, prefix)
        mappings.push(`${nicNetworkName(enic)}:${bridge}`)
        h()
        h(`# ---- ${tt('externalBridge', { name: host.data.name, nic: enic.name, bridge })} ----`)
        h(`ovs-vsctl --may-exist add-br ${bridge}`)
        h(`ovs-vsctl --may-exist add-port ${bridge} ${enic.name}`)
        h(`ip addr flush dev ${enic.name} || true`)
        h(`ip link set ${enic.name} up`)
        if (cidr) h(`ip addr add ${cidr} dev ${bridge} || true`)
        h(`ip link set ${bridge} up`)
      }
      h(`ovs-vsctl set open_vswitch . external_ids:ovn-bridge-mappings="${mappings.join(',')}"`)
    }
    // 网关 chassis 宿主机：附加物理链路健康探测脚本提示（OVN 不感知 link down）
    if (gatewayHosts.has(host.id)) {
      h(`# ${tt('gatewayHaNote', { file: `ovn-gateway-ha-${slug(host.data.name)}.sh` })}`)
    }

    const hosted = vmInfos.filter((info) => info.host && info.host.id === host.id)
    if (hosted.length) {
      h()
      h(`# ---- ${tt('vmNetns')} ----`)
      h('ovs-vsctl --may-exist add-br br-int')
      for (const info of hosted) {
        if (!info.ls) {
          h(`# ${tt('vmNotAttached', { name: info.vm.data.name })}`)
          continue
        }
        emitNetns(h, info.vm, info)
      }
    }
    hostBodies.set(host.id, lines.join('\n'))
  }

  // ---- 完整脚本（全部）----
  const all = []
  const hdr = ['#!/bin/bash', `# ${tt('generated')}`, 'set -e', '']
  all.push(...hdr)
  all.push(...central)
  if (computeHosts.length) {
    all.push(`# ---- ${tt('tunnelNetwork')} ----`)
    for (const host of computeHosts) {
      all.push(hostBodies.get(host.id))
      all.push('')
    }
    const tunnels = edges.filter((e) => {
      const s = byId.get(e.source)
      const t = byId.get(e.target)
      return s && t && s.type === 'Host' && t.type === 'Host' &&
        s !== controllerHost && t !== controllerHost
    })
    if (tunnels.length) {
      all.push(`# ${tt('tunnelTopology')}`)
      for (const e of tunnels) {
        const s = byId.get(e.source)
        const t = byId.get(e.target)
        all.push(`#   ${s.data.name} <-> ${t.data.name}`)
      }
      all.push('')
    }
    if (controllerHost) {
      const clusters = nodes.filter((n) => n.type === 'Cluster')
      for (const cluster of clusters) {
        if (neighborsOf(cluster.id, sourceNodes, targetNodes).some((n) => n.id === controllerHost.id)) {
          all.push(`# ${tt('clusterJoinedController', { cluster: cluster.data.name, host: controllerHost.data.name })}`)
        }
      }
      for (const host of computeHosts) {
        if (neighborsOf(host.id, sourceNodes, targetNodes).some((n) => n.id === controllerHost.id)) {
          all.push(`# ${tt('hostJoinedController', { name: host.data.name, host: controllerHost.data.name })}`)
        }
      }
      if (clusters.length || computeHosts.length) all.push('')
    }
  }
  all.push(`# ---- ${tt('done')} ----`)

  const wrap = (body) => hdr.join('\n') + '\n' + body + '\n'

  const targets = [
    {
      id: 'central',
      kind: 'central',
      name: controllerHost ? controllerHost.data.name : null,
      content: wrap(central.join('\n')),
      filename: controllerHost ? `ovn-central-${slug(controllerHost.data.name)}.sh` : 'ovn-central.sh',
    },
    ...computeHosts.map((h) => ({
      id: `host:${h.id}`,
      kind: 'host',
      name: h.data.name,
      content: wrap(hostBodies.get(h.id)),
      filename: `ovn-host-${slug(h.data.name)}.sh`,
    })),
    // 网关 chassis 宿主机：物理链路健康探测（方案 B：轮询 + ovn-nbctl 动态调整）
    ...[...gatewayHosts.keys()].map((hostId) => {
      const host = byId.get(hostId)
      const enic = externalNicOf(host)
      const entries = gatewayHosts.get(hostId)
      return {
        id: `gwha:${hostId}`,
        kind: 'gateway-ha',
        name: host.data.name,
        content: wrap(gatewayHaScript(host, enic, entries, centralIp)),
        filename: `ovn-gateway-ha-${slug(host.data.name)}.sh`,
      }
    }),
  ]

  return { targets, all: { content: all.join('\n'), filename: 'ovn-setup.sh' } }
}

// 导出前校验：返回 { key, params } 列表，由调用方用 t() 翻译后在导出弹窗展示
export function validateOvn(nodes, edges) {
  const { byId, sourceNodes, targetNodes } = buildGraph(nodes, edges)
  const switches = nodes.filter((n) => n.type === 'LogicalSwitch')
  const routers = nodes.filter((n) => n.type === 'LogicalRouter')
  const hosts = nodes.filter((n) => n.type === 'Host')
  const computeHosts = hosts.filter((h) => !h.data.controller)
  const externalSwitches = switches.filter((s) => s.data.isExternal)
  const portPlan = routerPortPlan(nodes, edges)
  const warnings = []

  // FR-7.5 外部交换机未设置 unknown，未知单播不会泛洪
  for (const ls of externalSwitches) {
    if (ls.data.unknownAddresses === false) {
      warnings.push({ key: 'export.ovnExternalUnknown', params: { name: ls.data.name } })
    }
  }

  // FR-7.3 外部交换机的 network_name 在「该交换机部署到的计算节点」上没有同名外部网卡，
  // 无法生成匹配的 ovn-bridge-mappings（未连宿主机时退化为全局检查）
  for (const ls of externalSwitches) {
    const name = ls.data.networkName || 'external'
    const deployed = deployedHostsOf(ls, nodes, sourceNodes, targetNodes)
    const candidates = (deployed.length
      ? deployed.map((id) => byId.get(id)).filter(Boolean)
      : computeHosts
    ).filter((h) => !h.data.controller)
    const matched = candidates.some((h) =>
      externalNicsOf(h).some((nic) => nicNetworkName(nic) === name)
    )
    if (!matched) {
      warnings.push({ key: 'export.ovnNoBridgeMapping', params: { name } })
    }
  }

  for (const lr of routers) {
    if (!lr.data.externalNetwork) continue
    const extPort = portPlan.find((p) => p.lr.id === lr.id && p.external)
    const chassis = (lr.data.gatewayChassis || []).filter((e) => byId.get(e.hostId))
    // FR-7.1 有外部口但未配置 gateway chassis
    if (extPort && chassis.length === 0) {
      warnings.push({ key: 'export.ovnExternalNoGateway', params: { name: lr.data.name } })
    }
    // FR-7.2 仅 1 个网关 chassis，单点故障
    if (chassis.length === 1) {
      warnings.push({ key: 'export.ovnSingleGateway', params: { name: lr.data.name } })
    }
    // FR-7.4 NAT external_ip 不在外部子网内
    const cidr = extPort ? parseCidr(extPort.ls.data.subnet) : null
    for (const nat of lr.data.nats || []) {
      if (nat.enabled === false) continue
      const externalIp = String(nat.externalIp || lr.data.externalIp || '').trim()
      if (!externalIp || !cidr) continue
      const ip = externalIp.includes('/') ? externalIp.split('/')[0] : externalIp
      if (!ipInCidr(ip, cidr)) {
        warnings.push({ key: 'export.ovnNatExternalIpOutOfSubnet', params: { name: lr.data.name, ip } })
      }
    }
  }

  // FR-7.6 路由器端口 MAC 重复
  const macs = new Set()
  for (const p of portPlan) {
    if (macs.has(p.mac)) {
      warnings.push({ key: 'export.ovnDuplicateMac', params: { mac: p.mac } })
    }
    macs.add(p.mac)
  }

  return warnings
}

function ipInCidr(ip, cidr) {
  try {
    const toInt = (s) =>
      s.split('.').reduce((acc, o) => (acc << 8) + (parseInt(o, 10) || 0), 0) >>> 0
    const mask = cidr.prefix === 0 ? 0 : (0xffffffff << (32 - cidr.prefix)) >>> 0
    return (toInt(ip) & mask) === (toInt(cidr.network) & mask)
  } catch {
    return false
  }
}
