// 节点类型元数据：定义所有可拖拽的网络节点类型、默认属性、展示摘要与连接规则
// label / summary 键为 i18n key，组件中通过 t() 翻译

import { defaultRegion, defaultZone, regionOptions } from './regions.js'
import { chargeTypeOptions, defaultChargeType } from './chargeTypes.js'
import { defaultDiskType } from './disks.js'
import { imageOptions, defaultImage, instanceTypeOptions, defaultInstanceType } from '../store/catalog.js'

export const CATEGORIES = {
  ovn: { label: 'categories.ovn', color: 'var(--ovn)' },
  cloud: { label: 'categories.cloud', color: 'var(--cloud)' },
}

export const NODE_TYPES = {
  LogicalSwitch: {
    category: 'ovn',
    label: 'nodes.logicalSwitch',
    badge: 'LS',
    defaults: () => ({
      name: 'ls1',
      subnet: '10.0.0.0/24',
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'subnet', label: 'fields.subnet', type: 'text' },
    ],
    summary: (d) => [['summary.cidr', d.subnet]],
  },
  LogicalRouter: {
    category: 'ovn',
    label: 'nodes.logicalRouter',
    badge: 'LR',
    defaults: () => ({
      name: 'lr1',
      externalNetwork: false,
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'externalNetwork', label: 'fields.externalNetwork', type: 'checkbox' },
    ],
    summary: () => [],
  },
  Host: {
    category: 'ovn',
    label: 'nodes.host',
    badge: 'HOST',
    handles: { source: 4, target: 4 },
    defaults: () => ({
      name: 'host1',
      encapType: 'geneve',
      controller: false,
      nics: [{ name: 'eth0', ip: '192.168.1.10', tunnel: true }],
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      {
        key: 'encapType',
        label: 'fields.encapType',
        type: 'select',
        options: [
          { value: 'geneve', label: 'Geneve' },
          { value: 'vxlan', label: 'VXLAN' },
          { value: 'stt', label: 'STT' },
        ],
      },
      { key: 'controller', label: 'fields.controller', type: 'checkbox' },
    ],
    summary: (d) => {
      const nic = (d.nics || []).find((n) => n.tunnel) || (d.nics || [])[0]
      return [
        ['summary.encap', d.encapType],
        ['summary.nic', nic ? `${nic.name} ${nic.ip}` : '-'],
      ]
    },
  },
  Cluster: {
    category: 'ovn',
    label: 'nodes.cluster',
    badge: 'CLUSTER',
    hidden: true,
    defaults: () => ({
      name: 'cluster1',
      hostCount: 0,
    }),
    fields: [],
    summary: (d) => [['summary.hosts', String(d.hostCount ?? 0)]],
  },
  VM: {
    category: 'ovn',
    label: 'nodes.vm',
    badge: 'VM',
    defaults: () => ({
      name: 'vm1',
      ip: '10.0.0.2',
      mac: '02:00:00:00:00:02',
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'ip', label: 'fields.ip', type: 'text' },
      { key: 'mac', label: 'fields.mac', type: 'text' },
    ],
    summary: (d) => [
      ['summary.ip', d.ip],
      ['summary.mac', d.mac],
    ],
  },
  VPC: {
    category: 'cloud',
    label: 'nodes.vpc',
    badge: 'VPC',
    // 一个 VPC 通常挂多个子网/路由表/对等连接，source 侧支持一对多
    handles: { source: 8, target: 2 },
    defaults: (vendor) => ({
      name: 'vpc1',
      cidr: '10.0.0.0/16',
      region: defaultRegion(vendor),
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'cidr', label: 'fields.cidr', type: 'text' },
      {
        key: 'region',
        label: 'fields.region',
        type: 'select',
        options: (vendor) => regionOptions(vendor),
      },
    ],
    summary: (d) => [
      ['summary.cidr', d.cidr],
      ['summary.region', d.region],
    ],
  },
  Subnet: {
    category: 'cloud',
    label: 'nodes.subnet',
    badge: 'VSW',
    // 一个子网可承载多台 ECS，并连接网关/路由表，source 侧支持一对多
    handles: { source: 8, target: 2 },
    defaults: (vendor) => ({
      name: 'vsw1',
      cidr: '10.0.1.0/24',
      zone: defaultZone(vendor),
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'cidr', label: 'fields.cidr', type: 'text' },
      { key: 'zone', label: 'fields.zone', type: 'text' },
    ],
    summary: (d) => [
      ['summary.cidr', d.cidr],
      ['summary.zone', d.zone],
    ],
  },
  Gateway: {
    category: 'cloud',
    label: 'nodes.gateway',
    badge: 'GW',
    // 一个 NAT 网关需接入多个子网并绑定 EIP，target 侧支持一对多
    handles: { source: 2, target: 8 },
    defaults: () => ({
      name: 'nat1',
    }),
    fields: [{ key: 'name', label: 'fields.name', type: 'text' }],
    summary: () => [['summary.type', 'NAT']],
  },
  Eip: {
    category: 'cloud',
    label: 'nodes.eip',
    badge: 'EIP',
    defaults: () => ({
      name: 'eip1',
      bandwidth: 5,
      internetChargeType: 'payByTraffic',
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'bandwidth', label: 'fields.bandwidth', type: 'text' },
      {
        key: 'internetChargeType',
        label: 'fields.internetChargeType',
        type: 'select',
        options: [
          { value: 'payByTraffic', label: 'internetChargeTypes.traffic' },
          { value: 'payByBandwidth', label: 'internetChargeTypes.bandwidth' },
        ],
      },
    ],
    summary: (d) => [
      ['summary.bandwidth', `${d.bandwidth} Mbps`],
      ['summary.charge', d.internetChargeType === 'payByBandwidth' ? 'PayByBandwidth' : 'PayByTraffic'],
    ],
  },
  SecurityGroup: {
    category: 'cloud',
    label: 'nodes.securityGroup',
    badge: 'SG',
    defaults: () => ({
      name: 'sg1',
      rules: [
        { direction: 'ingress', protocol: 'tcp', port: '22/22', cidr: '0.0.0.0/0', description: 'SSH' },
      ],
    }),
    fields: [{ key: 'name', label: 'fields.name', type: 'text' }],
    summary: (d) => [['summary.rules', String(d.rules.length)]],
  },
  Instance: {
    category: 'cloud',
    label: 'nodes.instance',
    badge: 'ECS',
    // 实例可被 Subnet/Eip/KeyPair 接入，并可挂多个安全组
    handles: { source: 4, target: 4 },
    defaults: (vendor) => ({
      name: 'ecs1',
      imageId: defaultImage(vendor),
      instanceType: defaultInstanceType(vendor),
      chargeType: defaultChargeType(),
      privateIp: '10.0.1.10',
      loginType: 'keyPair',
      keyPair: '',
      password: '',
      systemDisk: { type: defaultDiskType(vendor), size: 40 },
      dataDisks: [],
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'imageId', label: 'fields.imageId', type: 'combo', options: (vendor) => imageOptions(vendor) },
      { key: 'instanceType', label: 'fields.instanceType', type: 'combo', options: (vendor) => instanceTypeOptions(vendor) },
      {
        key: 'chargeType',
        label: 'fields.chargeType',
        type: 'select',
        options: (vendor) => chargeTypeOptions(vendor),
      },
      { key: 'privateIp', label: 'fields.privateIp', type: 'text' },
      {
        key: 'loginType',
        label: 'fields.loginType',
        type: 'select',
        options: [
          { value: 'keyPair', label: 'fields.keyPair' },
          { value: 'password', label: 'fields.password' },
        ],
      },
      { key: 'keyPair', label: 'fields.keyPair', type: 'text', when: (d) => d.loginType !== 'password' },
      { key: 'password', label: 'fields.password', type: 'password', when: (d) => d.loginType === 'password' },
    ],
    summary: (d) => {
      const disk = d.systemDisk || {}
      const sys = Number(disk.size) > 0 ? Number(disk.size) : 40
      const dataCount = (d.dataDisks || []).filter((x) => Number(x.size) > 0).length
      return [
        ['summary.ip', d.privateIp],
        ['summary.spec', d.instanceType],
        ['summary.disk', dataCount ? `${sys} + ${dataCount}` : String(sys)],
      ]
    },
  },
  LoadBalancer: {
    category: 'cloud',
    label: 'nodes.loadBalancer',
    badge: 'LB',
    // 可接入多个 ECS/子网/VPC 作为后端来源，target 侧支持一对多
    handles: { source: 2, target: 8 },
    defaults: () => ({
      name: 'lb1',
      internal: false,
      // 每条规则 = 一个监听器（协议+端口）+ 后端实例（穿梭框选择，存实例节点 id）
      rules: [{ protocol: 'tcp', port: '80', backends: [] }],
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'internal', label: 'fields.internal', type: 'checkbox' },
    ],
    summary: (d) => [
      ['summary.listeners', String((d.rules || []).length)],
      ['summary.type', d.internal ? 'intranet' : 'internet'],
    ],
  },
  RouteTable: {
    category: 'cloud',
    label: 'nodes.routeTable',
    badge: 'RT',
    defaults: () => ({
      name: 'rt1',
      routes: [{ destination: '0.0.0.0/0', nextHopType: 'NatGateway', nextHop: '' }],
    }),
    fields: [{ key: 'name', label: 'fields.name', type: 'text' }],
    summary: (d) => [['summary.routes', String(d.routes.length)]],
  },
  Interconnect: {
    category: 'cloud',
    label: 'nodes.interconnect',
    badge: 'PEER',
    handles: { source: 1, target: 8 },
    defaults: () => ({
      name: 'peer1',
    }),
    fields: [{ key: 'name', label: 'fields.name', type: 'text' }],
    summary: () => [['summary.type', 'VPC Peering']],
  },
  KeyPair: {
    category: 'cloud',
    label: 'nodes.keyPair',
    badge: 'KEY',
    // 一个密钥对可绑定多个实例，target 连接点留足
    handles: { source: 2, target: 4 },
    defaults: () => ({
      name: 'key1',
      // create：由 Terraform 新建；existing：关联云上已有密钥对
      mode: 'create',
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      {
        key: 'mode',
        label: 'fields.keyPairMode',
        type: 'select',
        options: [
          { value: 'create', label: 'keyPairModes.create' },
          { value: 'existing', label: 'keyPairModes.existing' },
        ],
      },
    ],
    summary: (d) => [['summary.keyPairMode', d.mode === 'existing' ? 'existing' : 'create']],
  },
}

// 连接规则：source 类型 -> target 类型，带关系标签（i18n key）
export const CONNECTION_RULES = [
  { source: 'VM', target: 'LogicalSwitch', label: 'connections.vmToSwitch' },
  { source: 'LogicalSwitch', target: 'LogicalRouter', label: 'connections.switchToRouter' },
  { source: 'LogicalRouter', target: 'LogicalSwitch', label: 'connections.routerToSwitch' },
  { source: 'Host', target: 'Host', label: 'connections.hostToHost' },
  { source: 'LogicalSwitch', target: 'Host', label: 'connections.switchToHost' },
  { source: 'VPC', target: 'Cluster', label: 'connections.vpcToCluster' },
  { source: 'VPC', target: 'Subnet', label: 'connections.vpcToSubnet' },
  { source: 'Subnet', target: 'Instance', label: 'connections.subnetToInstance' },
  { source: 'Instance', target: 'SecurityGroup', label: 'connections.instanceToSg' },
  { source: 'KeyPair', target: 'Instance', label: 'connections.keyPairToInstance' },
  { source: 'Eip', target: 'Instance', label: 'connections.eipToInstance' },
  { source: 'Eip', target: 'Gateway', label: 'connections.eipToGateway' },
  { source: 'Subnet', target: 'Gateway', label: 'connections.subnetToGateway' },
  { source: 'Instance', target: 'Gateway', label: 'connections.instanceToGateway' },
  { source: 'VPC', target: 'Gateway', label: 'connections.vpcToGateway' },
  { source: 'Instance', target: 'LoadBalancer', label: 'connections.instanceToLb' },
  { source: 'Subnet', target: 'LoadBalancer', label: 'connections.subnetToLb' },
  { source: 'VPC', target: 'LoadBalancer', label: 'connections.vpcToLb' },
  { source: 'Subnet', target: 'RouteTable', label: 'connections.subnetToRouteTable' },
  { source: 'VPC', target: 'RouteTable', label: 'connections.subnetToRouteTable' },
  { source: 'VPC', target: 'Interconnect', label: 'connections.vpcToInterconnect' },
]

export function canConnect(sourceType, targetType) {
  return CONNECTION_RULES.find(
    (r) => r.source === sourceType && r.target === targetType
  )
}
