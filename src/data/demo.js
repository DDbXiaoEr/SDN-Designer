// 内置示例拓扑：一个典型的云上部署（VPC + 交换机 + ECS + 安全组 + EIP）
// 边不存储本地化标签，加载时按当前语言从 CONNECTION_RULES 解析

const DEMO_NODES = [
  {
    id: 'demo_vpc',
    type: 'VPC',
    position: { x: 80, y: 240 },
    data: { name: 'vpc-terraform', cidr: '10.0.0.0/16', region: 'cn-zhongwei' },
  },
  {
    id: 'demo_subnet',
    type: 'Subnet',
    position: { x: 400, y: 240 },
    data: { name: 'vsw-terraform', cidr: '10.0.1.0/24', zone: 'cn-zhongwei-a' },
  },
  {
    id: 'demo_instance',
    type: 'Instance',
    position: { x: 720, y: 240 },
    data: {
      name: 'ecs-terraform',
      imageId: 'aliyun_3_x64_20G_alibase_20260720.vhd',
      instanceType: 'ecs.c9i.large',
      chargeType: 'payAsYouGo',
      privateIp: '10.0.1.15',
      loginType: 'keyPair',
      keyPair: 'terraformtest',
      password: '',
      systemDisk: { type: 'cloud_essd', size: 40 },
      dataDisks: [],
    },
  },
  {
    id: 'demo_sg',
    type: 'SecurityGroup',
    position: { x: 1040, y: 160 },
    data: {
      name: 'sg1',
      rules: [
        { direction: 'ingress', protocol: 'tcp', port: '22/22', cidr: '0.0.0.0/0', description: 'SSH' },
      ],
    },
  },
  {
    id: 'demo_eip',
    type: 'Eip',
    position: { x: 720, y: 500 },
    data: { name: 'eip1', bandwidth: 5, internetChargeType: 'payByTraffic' },
  },
  {
    id: 'demo_keypair',
    type: 'KeyPair',
    position: { x: 1040, y: 400 },
    data: { name: 'terraformtest', mode: 'create' },
  },
]

const DEMO_EDGES = [
  { id: 'demo_e_vpc_subnet', source: 'demo_vpc', target: 'demo_subnet', sourceHandle: 'source-0', targetHandle: 'target-0' },
  { id: 'demo_e_subnet_instance', source: 'demo_subnet', target: 'demo_instance', sourceHandle: 'source-1', targetHandle: 'target-0' },
  { id: 'demo_e_eip_instance', source: 'demo_eip', target: 'demo_instance', sourceHandle: 'source-0', targetHandle: 'target-1' },
  { id: 'demo_e_instance_sg', source: 'demo_instance', target: 'demo_sg', sourceHandle: 'source-1', targetHandle: 'target-0' },
  { id: 'demo_e_instance_keypair', source: 'demo_instance', target: 'demo_keypair', sourceHandle: 'source-0', targetHandle: 'target-0' },
]

// 每次返回深拷贝，避免加载后被画布编辑污染原始定义
export function createDemoDesign() {
  return {
    nodes: JSON.parse(JSON.stringify(DEMO_NODES)),
    edges: JSON.parse(JSON.stringify(DEMO_EDGES)),
  }
}
