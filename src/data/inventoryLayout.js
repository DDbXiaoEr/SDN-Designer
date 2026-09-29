import { NODE_TYPES, canConnect } from './nodeDefinitions.js'
import { defaultDiskType } from './disks.js'
import { defaultChargeType } from './chargeTypes.js'

const COL_W = 320
const ROW_H = 140
const ORIGIN = { x: 80, y: 80 }

function cloneDefaults(type, vendor) {
  const def = NODE_TYPES[type]
  return def ? { ...def.defaults(vendor) } : {}
}

function handlePair(sourceType, targetType, used) {
  const srcDef = NODE_TYPES[sourceType]
  const tgtDef = NODE_TYPES[targetType]
  const srcN = (srcDef && srcDef.handles && srcDef.handles.source) || 2
  const tgtN = (tgtDef && tgtDef.handles && tgtDef.handles.target) || 2
  const key = `${sourceType}->${targetType}`
  const n = used.get(key) || 0
  used.set(key, n + 1)
  return {
    sourceHandle: `source-${n % srcN}`,
    targetHandle: `target-${n % tgtN}`,
  }
}

function edge(id, source, target, sourceType, targetType, used) {
  const rule = canConnect(sourceType, targetType)
  const handles = handlePair(sourceType, targetType, used)
  return {
    id,
    source,
    target,
    type: 'default',
    labelKey: rule ? rule.label : '',
    ...handles,
  }
}

function existingMeta(cloudId) {
  return { existing: true, cloudId: cloudId || '' }
}

// 将库存图转为画布节点/边：按 VPC → 子网 → 实例 分列，周边挂安全组/EIP/密钥对/网关/路由表
export function graphToDesign(graph, vendor) {
  const g = graph || {}
  const nodes = []
  const edges = []
  const used = new Map()
  const idMap = new Map() // cloudId -> nodeId
  let seq = 0
  const nid = (prefix) => `inv_${prefix}_${++seq}`

  const vpcs = g.vpcs || []
  const subnets = g.subnets || []
  const instances = g.instances || []
  const sgs = g.securityGroups || []
  const eips = g.eips || []
  const gateways = g.gateways || []
  const keyPairs = g.keyPairs || []
  const routeTables = g.routeTables || []
  const lbs = g.loadBalancers || []
  const region = g.region || ''

  const subnetsOf = new Map()
  for (const s of subnets) {
    const list = subnetsOf.get(s.vpcId) || []
    list.push(s)
    subnetsOf.set(s.vpcId, list)
  }
  const instOf = new Map()
  for (const inst of instances) {
    const key = inst.subnetId || inst.vpcId || '_'
    const list = instOf.get(key) || []
    list.push(inst)
    instOf.set(key, list)
  }

  // 列 0：VPC；列 1：子网；列 2：实例。各 VPC 纵向堆叠
  let yCursor = ORIGIN.y
  const vpcY = new Map()
  for (const vpc of vpcs) {
    const nodeId = nid('vpc')
    idMap.set(vpc.id, nodeId)
    const subs = subnetsOf.get(vpc.id) || []
    let instCount = 0
    for (const s of subs) instCount += (instOf.get(s.id) || []).length
    instCount += (instOf.get(vpc.id) || []).length
    const blockH = Math.max(ROW_H, Math.max(subs.length, instCount, 1) * ROW_H)
    vpcY.set(vpc.id, yCursor)
    nodes.push({
      id: nodeId,
      type: 'VPC',
      position: { x: ORIGIN.x, y: yCursor },
      data: {
        ...cloneDefaults('VPC', vendor),
        name: vpc.name || vpc.id,
        cidr: vpc.cidr || '10.0.0.0/16',
        region: region || cloneDefaults('VPC', vendor).region,
        ...existingMeta(vpc.id),
      },
    })
    yCursor += blockH + 48
  }

  const orphanVpcs = instances.filter((i) => i.vpcId && !idMap.has(i.vpcId))
  for (const inst of orphanVpcs) {
    if (idMap.has(inst.vpcId)) continue
    const nodeId = nid('vpc')
    idMap.set(inst.vpcId, nodeId)
    vpcY.set(inst.vpcId, yCursor)
    nodes.push({
      id: nodeId,
      type: 'VPC',
      position: { x: ORIGIN.x, y: yCursor },
      data: {
        ...cloneDefaults('VPC', vendor),
        name: inst.vpcId,
        region,
        ...existingMeta(inst.vpcId),
      },
    })
    yCursor += ROW_H + 48
  }

  const subnetY = new Map()
  for (const vpc of vpcs) {
    const subs = subnetsOf.get(vpc.id) || []
    let sy = vpcY.get(vpc.id) || ORIGIN.y
    for (const sub of subs) {
      const nodeId = nid('subnet')
      idMap.set(sub.id, nodeId)
      subnetY.set(sub.id, sy)
      nodes.push({
        id: nodeId,
        type: 'Subnet',
        position: { x: ORIGIN.x + COL_W, y: sy },
        data: {
          ...cloneDefaults('Subnet', vendor),
          name: sub.name || sub.id,
          cidr: sub.cidr || '10.0.1.0/24',
          zone: sub.zone || cloneDefaults('Subnet', vendor).zone,
          ...existingMeta(sub.id),
        },
      })
      if (idMap.has(sub.vpcId)) {
        edges.push(edge(nid('e'), idMap.get(sub.vpcId), nodeId, 'VPC', 'Subnet', used))
      }
      sy += Math.max(ROW_H, (instOf.get(sub.id) || []).length * ROW_H)
    }
  }

  const instY = new Map()
  for (const inst of instances) {
    const subId = inst.subnetId
    const baseY = (subId && subnetY.get(subId)) || (inst.vpcId && vpcY.get(inst.vpcId)) || ORIGIN.y
    const siblings = instOf.get(subId || inst.vpcId || '_') || []
    const idx = siblings.findIndex((x) => x.id === inst.id)
    const y = baseY + Math.max(0, idx) * ROW_H
    const nodeId = nid('ecs')
    idMap.set(inst.id, nodeId)
    instY.set(inst.id, y)
    const disk = inst.systemDisk || {}
    nodes.push({
      id: nodeId,
      type: 'Instance',
      position: { x: ORIGIN.x + COL_W * 2, y },
      data: {
        ...cloneDefaults('Instance', vendor),
        name: inst.name || inst.id,
        count: 1,
        imageId: inst.imageId || '',
        instanceType: inst.instanceType || '',
        chargeType: inst.chargeType || defaultChargeType(),
        privateIp: inst.privateIp || '',
        loginType: inst.keyPair ? 'keyPair' : 'keyPair',
        keyPair: inst.keyPair || '',
        gpu: !!inst.gpu,
        systemDisk: {
          type: disk.type || defaultDiskType(vendor),
          size: disk.size > 0 ? disk.size : 40,
        },
        dataDisks: Array.isArray(inst.dataDisks) ? inst.dataDisks : [],
        ...existingMeta(inst.id),
      },
    })
    if (subId && idMap.has(subId)) {
      edges.push(edge(nid('e'), idMap.get(subId), nodeId, 'Subnet', 'Instance', used))
    }
  }

  // 安全组：实例右侧
  let sgIndex = 0
  for (const sg of sgs) {
    const nodeId = nid('sg')
    idMap.set(sg.id, nodeId)
    const bound = instances.find((i) => (i.securityGroupIds || []).includes(sg.id))
    const y = (bound && instY.get(bound.id)) || ORIGIN.y + sgIndex * ROW_H
    nodes.push({
      id: nodeId,
      type: 'SecurityGroup',
      position: { x: ORIGIN.x + COL_W * 3, y },
      data: {
        ...cloneDefaults('SecurityGroup', vendor),
        name: sg.name || sg.id,
        rules: Array.isArray(sg.rules) && sg.rules.length ? sg.rules : cloneDefaults('SecurityGroup', vendor).rules,
        ...existingMeta(sg.id),
      },
    })
    sgIndex += 1
  }
  for (const inst of instances) {
    for (const sgId of inst.securityGroupIds || []) {
      if (idMap.has(inst.id) && idMap.has(sgId)) {
        edges.push(edge(nid('e'), idMap.get(inst.id), idMap.get(sgId), 'Instance', 'SecurityGroup', used))
      }
    }
  }

  const kpNodes = new Map()
  for (const kp of keyPairs) {
    if (!kp.name || kpNodes.has(kp.name)) continue
    const nodeId = nid('kp')
    kpNodes.set(kp.name, nodeId)
    nodes.push({
      id: nodeId,
      type: 'KeyPair',
      position: { x: ORIGIN.x + COL_W * 3, y: ORIGIN.y + (kpNodes.size - 1) * ROW_H + 40 },
      data: {
        ...cloneDefaults('KeyPair', vendor),
        name: kp.name,
        mode: 'existing',
        ...existingMeta(kp.name),
      },
    })
  }
  for (const inst of instances) {
    if (!inst.keyPair) continue
    const kpId = kpNodes.get(inst.keyPair)
    if (kpId && idMap.has(inst.id)) {
      edges.push(edge(nid('e'), kpId, idMap.get(inst.id), 'KeyPair', 'Instance', used))
    }
  }

  let eipIndex = 0
  for (const eip of eips) {
    const nodeId = nid('eip')
    idMap.set(eip.id, nodeId)
    const y = (eip.instanceId && instY.get(eip.instanceId)) || ORIGIN.y + eipIndex * ROW_H
    nodes.push({
      id: nodeId,
      type: 'Eip',
      position: { x: ORIGIN.x + COL_W * 2, y: y + 72 },
      data: {
        ...cloneDefaults('Eip', vendor),
        name: eip.name || eip.id,
        count: 1,
        bandwidth: eip.bandwidth > 0 ? eip.bandwidth : 5,
        internetChargeType: eip.internetChargeType || 'payByTraffic',
        ...existingMeta(eip.id),
      },
    })
    if (eip.instanceId && idMap.has(eip.instanceId)) {
      edges.push(edge(nid('e'), nodeId, idMap.get(eip.instanceId), 'Eip', 'Instance', used))
    }
    eipIndex += 1
  }

  let gwIndex = 0
  for (const gw of gateways) {
    const nodeId = nid('gw')
    idMap.set(gw.id, nodeId)
    const y = (gw.vpcId && vpcY.get(gw.vpcId)) || ORIGIN.y + gwIndex * ROW_H
    nodes.push({
      id: nodeId,
      type: 'Gateway',
      position: { x: ORIGIN.x + COL_W, y: y + 80 },
      data: {
        ...cloneDefaults('Gateway', vendor),
        name: gw.name || gw.id,
        ...existingMeta(gw.id),
      },
    })
    if (gw.vpcId && idMap.has(gw.vpcId)) {
      edges.push(edge(nid('e'), idMap.get(gw.vpcId), nodeId, 'VPC', 'Gateway', used))
    } else if (gw.subnetId && idMap.has(gw.subnetId)) {
      edges.push(edge(nid('e'), idMap.get(gw.subnetId), nodeId, 'Subnet', 'Gateway', used))
    }
    gwIndex += 1
  }
  for (const eip of eips) {
    if (eip.gatewayId && idMap.has(eip.id) && idMap.has(eip.gatewayId)) {
      edges.push(edge(nid('e'), idMap.get(eip.id), idMap.get(eip.gatewayId), 'Eip', 'Gateway', used))
    }
  }

  let rtIndex = 0
  for (const rt of routeTables) {
    const nodeId = nid('rt')
    idMap.set(rt.id, nodeId)
    const y = (rt.vpcId && vpcY.get(rt.vpcId)) || ORIGIN.y + rtIndex * ROW_H
    nodes.push({
      id: nodeId,
      type: 'RouteTable',
      position: { x: ORIGIN.x, y: y + 80 },
      data: {
        ...cloneDefaults('RouteTable', vendor),
        name: rt.name || rt.id,
        routes: Array.isArray(rt.routes) ? rt.routes.map((r) => ({
          destination: r.destination || '0.0.0.0/0',
          nextHopType: r.nextHopType || 'NatGateway',
          nextHop: r.nextHop || '',
        })) : cloneDefaults('RouteTable', vendor).routes,
        ...existingMeta(rt.id),
      },
    })
    if (rt.vpcId && idMap.has(rt.vpcId)) {
      edges.push(edge(nid('e'), idMap.get(rt.vpcId), nodeId, 'VPC', 'RouteTable', used))
    }
    for (const subId of rt.subnetIds || []) {
      if (idMap.has(subId)) {
        edges.push(edge(nid('e'), idMap.get(subId), nodeId, 'Subnet', 'RouteTable', used))
      }
    }
    rtIndex += 1
  }

  let lbIndex = 0
  for (const lb of lbs) {
    const nodeId = nid('lb')
    idMap.set(lb.id, nodeId)
    const y = (lb.vpcId && vpcY.get(lb.vpcId)) || ORIGIN.y + lbIndex * ROW_H
    const backends = []
    for (const rule of lb.rules || []) {
      for (const bid of rule.backends || []) {
        if (idMap.has(bid)) backends.push(idMap.get(bid))
      }
    }
    nodes.push({
      id: nodeId,
      type: 'LoadBalancer',
      position: { x: ORIGIN.x + COL_W, y: y + 160 },
      data: {
        ...cloneDefaults('LoadBalancer', vendor),
        name: lb.name || lb.id,
        internal: !!lb.internal,
        rules: (lb.rules || []).map((r) => ({
          protocol: r.protocol || 'tcp',
          port: r.port || '80',
          backends: (r.backends || []).map((bid) => idMap.get(bid)).filter(Boolean),
        })),
        ...existingMeta(lb.id),
      },
    })
    if (lb.vpcId && idMap.has(lb.vpcId)) {
      edges.push(edge(nid('e'), idMap.get(lb.vpcId), nodeId, 'VPC', 'LoadBalancer', used))
    }
    for (const subId of lb.subnetIds || []) {
      if (idMap.has(subId)) {
        edges.push(edge(nid('e'), idMap.get(subId), nodeId, 'Subnet', 'LoadBalancer', used))
      }
    }
    const seenInst = new Set()
    for (const bid of backends) {
      if (seenInst.has(bid)) continue
      seenInst.add(bid)
      edges.push(edge(nid('e'), bid, nodeId, 'Instance', 'LoadBalancer', used))
    }
    lbIndex += 1
  }

  return { nodes, edges }
}

export function inventorySummary(graph) {
  const g = graph || {}
  return {
    vpcs: (g.vpcs || []).length,
    subnets: (g.subnets || []).length,
    instances: (g.instances || []).length,
    securityGroups: (g.securityGroups || []).length,
    eips: (g.eips || []).length,
    gateways: (g.gateways || []).length,
    keyPairs: (g.keyPairs || []).length,
    routeTables: (g.routeTables || []).length,
    loadBalancers: (g.loadBalancers || []).length,
  }
}
