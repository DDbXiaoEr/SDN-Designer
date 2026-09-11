import { buildGraph, parseCidr, generateMac, slug, computeZones } from './utils.js'
import { translate } from '../i18n/index.js'

const tt = (key, params) => translate(`export.${key}`, params)

function tunnelNicOf(host) {
  return (host.data.nics || []).find((n) => n.tunnel) || (host.data.nics || [])[0] || null
}

// 生成 ovn-nbctl / ovs-vsctl 命令行脚本
// 返回 { targets, all }：
//   targets - 按执行节点拆分的命令（central 控制节点 + 每个宿主机）
//   all     - 完整脚本 { content, filename }
export function exportOvn(nodes, edges) {
  const { byId, targetNodes } = buildGraph(nodes, edges)
  const switches = nodes.filter((n) => n.type === 'LogicalSwitch')
  const routers = nodes.filter((n) => n.type === 'LogicalRouter')
  const vms = nodes.filter((n) => n.type === 'VM')
  const hosts = nodes.filter((n) => n.type === 'Host')
  const controllerHost = hosts.find((h) => h.data.controller) || null
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

  c(`# ---- ${tt('vmPorts')} ----`)
  for (const vm of vms) {
    const lsList = targetNodes(vm.id).filter((n) => n.type === 'LogicalSwitch')
    const ls = lsList[0]
    if (!ls) {
      c(`# ${tt('vmNotAttached', { name: vm.data.name })}`)
      continue
    }
    const port = `${slug(ls.data.name)}_${slug(vm.data.name)}_port`
    const mac = vm.data.mac || generateMac(0xbb00 + vms.indexOf(vm))
    const ip = vm.data.ip || '10.0.0.2'
    c(`ovn-nbctl lsp-add ${slug(ls.data.name)} ${port}`)
    c(`ovn-nbctl lsp-set-addresses ${port} "${mac} ${ip}"`)
    c()
  }

  if (hosts.length) {
    c(`# ---- ${tt('chassis')} ----`)
    for (const host of hosts) {
      const nic = tunnelNicOf(host)
      if (!nic) {
        c(`# ${tt('hostNoNic', { name: host.data.name })}`)
        continue
      }
      c(`ovn-sbctl chassis-add ${host.data.name} ${host.data.encapType} ${nic.ip}`)
    }
    c()
  }

  // ---- 每个物理宿主机命令（ovs-vsctl）----
  const hostBodies = new Map()
  for (const host of hosts) {
    const lines = []
    const h = (s = '') => lines.push(s)
    const nic = tunnelNicOf(host)
    if (!nic) {
      h(`# ${tt('hostNoNic', { name: host.data.name })}`)
    } else {
      h(`# ${tt('hostTunnelNic', { name: host.data.name, nic: nic.name, ip: nic.ip })}`)
      if (!centralIp) {
        h(`# ${tt('ovnRemoteTodo')}`)
      }
      const ids = [
        centralIp ? `external_ids:ovn-remote="tcp:${centralIp}:6642"` : null,
        `external_ids:system-id="${host.data.name}"`,
        `external_ids:ovn-encap-ip="${nic.ip}"`,
        `external_ids:ovn-encap-type=${host.data.encapType}`,
      ].filter(Boolean)
      h('ovs-vsctl set open_vswitch . \\')
      ids.forEach((id, i) => h(`  ${id}${i < ids.length - 1 ? ' \\' : ''}`))
    }
    hostBodies.set(host.id, lines.join('\n'))
  }

  // ---- 完整脚本（全部）----
  const all = []
  const hdr = ['#!/bin/bash', `# ${tt('generated')}`, 'set -e', '']
  all.push(...hdr)
  all.push(...central)
  if (hosts.length) {
    all.push(`# ---- ${tt('tunnelNetwork')} ----`)
    for (const host of hosts) {
      all.push(hostBodies.get(host.id))
      all.push('')
    }
    const tunnels = edges.filter((e) => {
      const s = byId.get(e.source)
      const t = byId.get(e.target)
      return s && t && s.type === 'Host' && t.type === 'Host'
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
  }
  all.push(`# ---- ${tt('done')} ----`)

  const wrap = (body) => hdr.join('\n') + '\n' + body + '\n'

  const centralContent = controllerHost
    ? [central.join('\n'), hostBodies.get(controllerHost.id)].filter(Boolean).join('\n\n')
    : central.join('\n')

  const targets = [
    {
      id: 'central',
      kind: 'central',
      name: controllerHost ? controllerHost.data.name : null,
      content: wrap(centralContent),
      filename: controllerHost ? `ovn-central-${slug(controllerHost.data.name)}.sh` : 'ovn-central.sh',
    },
    ...hosts
      .filter((h) => !controllerHost || h.id !== controllerHost.id)
      .map((h) => ({
        id: `host:${h.id}`,
        kind: 'host',
        name: h.data.name,
        content: wrap(hostBodies.get(h.id)),
        filename: `ovn-host-${slug(h.data.name)}.sh`,
      })),
  ]

  return { targets, all: { content: all.join('\n'), filename: 'ovn-setup.sh' } }
}
