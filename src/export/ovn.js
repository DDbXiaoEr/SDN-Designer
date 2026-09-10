import { buildGraph, parseCidr, generateMac, slug, computeZones } from './utils.js'
import { translate } from '../i18n/index.js'

const tt = (key, params) => translate(`export.${key}`, params)

// 生成 ovn-nbctl / ovs-vsctl 命令行脚本
export function exportOvn(nodes, edges) {
  const { byId, targetNodes } = buildGraph(nodes, edges)
  const lines = []
  const push = (s = '') => lines.push(s)

  push('#!/bin/bash')
  push(`# ${tt('generated')}`)
  push('set -e')
  push()

  const switches = nodes.filter((n) => n.type === 'LogicalSwitch')
  const routers = nodes.filter((n) => n.type === 'LogicalRouter')
  const vms = nodes.filter((n) => n.type === 'VM')

  // 区域：Host 隧道连线形成的连通分量
  const zones = computeZones(nodes, edges)
  const zoneByHost = new Map()
  zones.forEach((hostIds) => hostIds.forEach((id) => zoneByHost.set(id, hostIds)))

  // 1. 创建逻辑交换机（并标注其部署区域）
  if (switches.length) {
    push(`# ---- ${tt('logicalSwitches')} ----`)
    for (const ls of switches) {
      push(`ovn-nbctl ls-add ${slug(ls.data.name)}`)
      const deployedHosts = targetNodes(ls.id).filter((n) => n.type === 'Host')
      if (deployedHosts.length) {
        const zoneHosts = new Set()
        for (const h of deployedHosts) {
          const comp = zoneByHost.get(h.id) || [h.id]
          comp.forEach((id) => zoneHosts.add(id))
        }
        const hostNames = [...zoneHosts].map((id) => byId.get(id)?.data?.name).filter(Boolean).join(', ')
        push(`# ${tt('switchDeployedTo', { name: ls.data.name, hosts: hostNames })}`)
      }
    }
    push()
  }

  // 2. 创建逻辑路由器
  if (routers.length) {
    push(`# ---- ${tt('logicalRouters')} ----`)
    for (const lr of routers) {
      push(`ovn-nbctl lr-add ${slug(lr.data.name)}`)
      if (lr.data.externalNetwork) {
        push(`# TODO: ${tt('externalNetworkTodo', { name: slug(lr.data.name) })}`)
      }
    }
    push()
  }

  // 3. 连接交换机与路由器
  push(`# ---- ${tt('switchRouter')} ----`)
  for (const ls of switches) {
    const cidrInfo = parseCidr(ls.data.subnet)
    const routersConnected = targetNodes(ls.id).filter((n) => n.type === 'LogicalRouter')
    routersConnected.forEach((lr, i) => {
      const lrPort = `${slug(lr.data.name)}_to_${slug(ls.data.name)}`
      const lsPort = `${slug(ls.data.name)}_to_${slug(lr.data.name)}`
      const mac = generateMac(0xaa00 + i)
      const ip = cidrInfo ? `${cidrInfo.gateway}/${cidrInfo.prefix}` : '10.0.0.1/24'
      push(`# ${tt('connect')} ${ls.data.name} <-> ${lr.data.name}`)
      push(`ovn-nbctl lrp-add ${slug(lr.data.name)} ${lrPort} ${mac} ${ip}`)
      push(`ovn-nbctl lsp-add ${slug(ls.data.name)} ${lsPort}`)
      push(`ovn-nbctl lsp-set-type ${lsPort} router`)
      push(`ovn-nbctl lsp-set-addresses ${lsPort} router`)
      push(`ovn-nbctl lsp-set-options ${lsPort} router-port=${lrPort}`)
      push()
    })
  }

  // 4. 虚拟机端口
  push(`# ---- ${tt('vmPorts')} ----`)
  for (const vm of vms) {
    const lsList = targetNodes(vm.id).filter((n) => n.type === 'LogicalSwitch')
    const ls = lsList[0]
    if (!ls) {
      push(`# ${tt('vmNotAttached', { name: vm.data.name })}`)
      continue
    }
    const port = `${slug(ls.data.name)}_${slug(vm.data.name)}_port`
    const mac = vm.data.mac || generateMac(0xbb00 + vms.indexOf(vm))
    const ip = vm.data.ip || '10.0.0.2'
    push(`ovn-nbctl lsp-add ${slug(ls.data.name)} ${port}`)
    push(`ovn-nbctl lsp-set-addresses ${port} "${mac} ${ip}"`)
    push()
  }

  // 5. 隧道网络（Overlay 封装）
  const hosts = nodes.filter((n) => n.type === 'Host')
  if (hosts.length) {
    push(`# ---- ${tt('tunnelNetwork')} ----`)
    for (const host of hosts) {
      const tunnelNic =
        (host.data.nics || []).find((n) => n.tunnel) || (host.data.nics || [])[0]
      if (!tunnelNic) {
        push(`# ${tt('hostNoNic', { name: host.data.name })}`)
        continue
      }
      push(`# ${tt('hostTunnelNic', { name: host.data.name, nic: tunnelNic.name, ip: tunnelNic.ip })}`)
      push(`ovs-vsctl set open_vswitch . external_ids:ovn-encap-ip="${tunnelNic.ip}" external_ids:ovn-encap-type=${host.data.encapType}`)
      push(`ovn-sbctl chassis-add ${slug(host.data.name)} ${host.data.encapType} ${tunnelNic.ip}`)
      push()
    }
    const tunnels = edges.filter((e) => {
      const s = byId.get(e.source)
      const t = byId.get(e.target)
      return s && t && s.type === 'Host' && t.type === 'Host'
    })
    if (tunnels.length) {
      push(`# ${tt('tunnelTopology')}`)
      for (const e of tunnels) {
        const s = byId.get(e.source)
        const t = byId.get(e.target)
        push(`#   ${s.data.name} <-> ${t.data.name}`)
      }
      push()
    }
  }

  push(`# ---- ${tt('done')} ----`)
  return lines.join('\n')
}
