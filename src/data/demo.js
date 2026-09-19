// 内置示例拓扑：按 key 提供多套示例，首次访问默认加载 basic。
// 边不存储本地化标签，加载时按当前语言从 CONNECTION_RULES 解析

const DEMOS = {
  // 基础示例：VPC + 交换机 + ECS + 安全组 + EIP + 密钥对
  basic: {
    nodes: [
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
    ],
    edges: [
      { id: 'demo_e_vpc_subnet', source: 'demo_vpc', target: 'demo_subnet', sourceHandle: 'source-0', targetHandle: 'target-0' },
      { id: 'demo_e_subnet_instance', source: 'demo_subnet', target: 'demo_instance', sourceHandle: 'source-1', targetHandle: 'target-0' },
      { id: 'demo_e_eip_instance', source: 'demo_eip', target: 'demo_instance', sourceHandle: 'source-0', targetHandle: 'target-1' },
      { id: 'demo_e_instance_sg', source: 'demo_instance', target: 'demo_sg', sourceHandle: 'source-1', targetHandle: 'target-0' },
      { id: 'demo_e_keypair_instance', source: 'demo_keypair', target: 'demo_instance', sourceHandle: 'source-0', targetHandle: 'target-2' },
    ],
  },

  // 负载均衡示例：VPC + 交换机 + 多台 ECS + 负载均衡 + EIP + 安全组
  loadbalancer: {
    nodes: [
      {
        id: 'demo_lb_vpc',
        type: 'VPC',
        position: { x: 176, y: 400 },
        data: { name: 'vpc-terraform', cidr: '10.0.0.0/16', region: 'cn-hangzhou' },
      },
      {
        id: 'demo_lb_subnet',
        type: 'Subnet',
        position: { x: 560, y: 80 },
        data: { name: 'subnet-terraform', cidr: '10.0.1.0/24', zone: 'cn-hangzhou-b' },
      },
      {
        id: 'demo_lb_instance',
        type: 'Instance',
        position: { x: 128, y: 64 },
        data: {
          name: 'ecs1-terraform',
          count: 3,
          imageId: 'ubuntu_22_04_x64_20G_alibase_20240101.vhd',
          instanceType: 'ecs.t5-lc1m2.small',
          chargeType: 'payAsYouGo',
          privateIp: '10.0.1.10,10.0.1.11,10.0.1.12',
          loginType: 'keyPair',
          keyPair: '',
          password: '',
          systemDisk: { type: 'cloud_essd', size: 40 },
          dataDisks: [],
        },
      },
      {
        id: 'demo_lb_lb',
        type: 'LoadBalancer',
        position: { x: 576, y: 400 },
        data: {
          name: 'elb-terraform',
          internal: false,
          rules: [
            {
              protocol: 'http',
              port: '80',
              backends: [
                'demo_lb_instance#0',
                'demo_lb_instance#1',
                'demo_lb_instance#2',
              ],
            },
          ],
        },
      },
      {
        id: 'demo_lb_eip',
        type: 'Eip',
        position: { x: 944, y: 448 },
        data: { name: 'eip-terraform', count: 2, bandwidth: '2', internetChargeType: 'payByTraffic' },
      },
      {
        id: 'demo_lb_sg',
        type: 'SecurityGroup',
        position: { x: 352, y: 576 },
        data: {
          name: 'sg-terraform',
          rules: [
            { direction: 'ingress', protocol: 'tcp', port: '22/22', cidr: '0.0.0.0/0', description: 'SSH' },
            { direction: 'ingress', protocol: 'tcp', port: '80/80', cidr: '0.0.0.0/0', description: 'HTTP' },
          ],
        },
      },
    ],
    edges: [
      { id: 'demo_lb_e_vpc_subnet', source: 'demo_lb_vpc', target: 'demo_lb_subnet', sourceHandle: 'source-0', targetHandle: 'target-0' },
      { id: 'demo_lb_e_subnet_instance', source: 'demo_lb_subnet', target: 'demo_lb_instance', sourceHandle: 'source-0', targetHandle: 'target-0' },
      { id: 'demo_lb_e_subnet_lb', source: 'demo_lb_subnet', target: 'demo_lb_lb', sourceHandle: 'source-1', targetHandle: 'target-0' },
      { id: 'demo_lb_e_instance_lb', source: 'demo_lb_instance', target: 'demo_lb_lb', sourceHandle: 'source-0', targetHandle: 'target-1' },
      { id: 'demo_lb_e_eip_lb', source: 'demo_lb_eip', target: 'demo_lb_lb', sourceHandle: 'source-0', targetHandle: 'target-2' },
      { id: 'demo_lb_e_instance_sg', source: 'demo_lb_instance', target: 'demo_lb_sg', sourceHandle: 'source-1', targetHandle: 'target-0' },
      { id: 'demo_lb_e_lb_sg', source: 'demo_lb_lb', target: 'demo_lb_sg', sourceHandle: 'source-1', targetHandle: 'target-0' },
      { id: 'demo_lb_e_eip_instance', source: 'demo_lb_eip', target: 'demo_lb_instance', sourceHandle: 'source-0', targetHandle: 'target-1' },
    ],
  },
}

// 工具栏展示顺序即此数组顺序；名称对应 i18n 的 toolbar.demo_<key>
export const DEMO_LIST = ['basic', 'loadbalancer']

// 返回指定示例的深拷贝，避免加载后被画布编辑污染原始定义
export function createDemoDesign(key = 'basic') {
  const demo = DEMOS[key] || DEMOS.basic
  return {
    nodes: JSON.parse(JSON.stringify(demo.nodes)),
    edges: JSON.parse(JSON.stringify(demo.edges)),
  }
}
