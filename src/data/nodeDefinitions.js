// 节点类型元数据：定义所有可拖拽的网络节点类型、默认属性、展示摘要与连接规则
// label / summary 键为 i18n key，组件中通过 t() 翻译

import { defaultRegion, regionOptions } from './regions.js'

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
    defaults: () => ({
      name: 'vsw1',
      cidr: '10.0.1.0/24',
      zone: 'cn-hangzhou-b',
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
    defaults: () => ({
      name: 'nat1',
      kind: 'nat',
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      {
        key: 'kind',
        label: 'fields.type',
        type: 'select',
        options: [
          { value: 'nat', label: 'fields.gatewayNat' },
          { value: 'eip', label: 'fields.gatewayEip' },
        ],
      },
    ],
    summary: (d) => [['summary.type', d.kind === 'eip' ? 'EIP' : 'NAT']],
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
    defaults: () => ({
      name: 'ecs1',
      imageId: 'ubuntu_22_04_x64_20G_alibase_20240101.vhd',
      instanceType: 'ecs.t5-lc1m2.small',
      privateIp: '10.0.1.10',
    }),
    fields: [
      { key: 'name', label: 'fields.name', type: 'text' },
      { key: 'imageId', label: 'fields.imageId', type: 'text' },
      { key: 'instanceType', label: 'fields.instanceType', type: 'text' },
      { key: 'privateIp', label: 'fields.privateIp', type: 'text' },
    ],
    summary: (d) => [
      ['summary.ip', d.privateIp],
      ['summary.spec', d.instanceType],
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
  { source: 'Subnet', target: 'Gateway', label: 'connections.subnetToGateway' },
  { source: 'Subnet', target: 'RouteTable', label: 'connections.subnetToRouteTable' },
  { source: 'VPC', target: 'RouteTable', label: 'connections.subnetToRouteTable' },
]

export function canConnect(sourceType, targetType) {
  return CONNECTION_RULES.find(
    (r) => r.source === sourceType && r.target === targetType
  )
}
