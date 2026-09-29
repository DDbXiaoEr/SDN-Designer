import { buildGraph, parseCidr, generateMac, slug, computeZones } from './utils.js'
import { translate } from '../i18n/index.js'

const tt = (key, params) => translate(`export.${key}`, params)

function tunnelNicOf(host) {
  return (host.data.nics || []).find((n) => n.tunnel) || (host.data.nics || [])[0] || null
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

// veth 名最长 15 字节：宿主机侧 vh-、临时对端 vn-（移入 netns 后改名为 eth0）
function vethPair(ns) {
  const base = ns.length <= 12 ? ns : ns.slice(0, 12)
  return { host: `vh-${base}`, peer: `vn-${base}` }
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
      const deployedHosts = targetNodes(ls.id).filter((n) => n.type === 'Host')
      if (deployedHosts.length) {
        const zoneHosts = new Set()
        for (const h of deployedHosts) {
          const comp = zoneByHost.get(h.id) || [h.id]
          comp.forEach((id) => zoneHosts.add(id))
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
        c(`# TODO: ${tt('externalNetworkTodo', { name: slug(lr.data.name) })}`)
      }
    }
    c()
  }

  c(`# ---- ${tt('switchRouter')} ----`)
  for (const ls of switches) {
    const cidrInfo = parseCidr(ls.data.subnet)
    const routersConnected = targetNodes(ls.id).filter((n) => n.type === 'LogicalRouter')
    routersConnected.forEach((lr, i) => {
      const lrPort = `${slug(lr.data.name)}_to_${slug(ls.data.name)}`
      const lsPort = `${slug(ls.data.name)}_to_${slug(lr.data.name)}`
      const mac = generateMac(0xaa00 + i)
      const ip = cidrInfo ? `${cidrInfo.gateway}/${cidrInfo.prefix}` : '10.0.0.1/24'
      c(`# ${tt('connect')} ${ls.data.name} <-> ${lr.data.name}`)
      c(`ovn-nbctl lrp-add ${slug(lr.data.name)} ${lrPort} ${mac} ${ip}`)
      c(`ovn-nbctl lsp-add ${slug(ls.data.name)} ${lsPort}`)
      c(`ovn-nbctl lsp-set-type ${lsPort} router`)
      c(`ovn-nbctl lsp-set-addresses ${lsPort} router`)
      c(`ovn-nbctl lsp-set-options ${lsPort} router-port=${lrPort}`)
      c()
    })
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

  if (computeHosts.length) {
    c(`# ---- ${tt('chassis')} ----`)
    for (const host of computeHosts) {
      const nic = tunnelNicOf(host)
      if (!nic) {
        c(`# ${tt('hostNoNic', { name: host.data.name })}`)
        continue
      }
      const joined = !controllerHost || isJoinedToController(host, controllerHost, sourceNodes, targetNodes)
      if (!joined) {
        c(`# ${tt('hostNotJoined', { name: host.data.name })}`)
        continue
      }
      c(`ovn-sbctl chassis-add ${host.data.name} ${host.data.encapType} ${nic.ip}`)
    }
    c()
  }

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
  ]

  return { targets, all: { content: all.join('\n'), filename: 'ovn-setup.sh' } }
}
