import { outputOptions } from '../../data/outputs.js'
import { isCountedInstance } from './common.js'

// 负载均衡资源引用：阿里云/腾讯云按所选类型指向不同资源，腾讯云 ALB 不导出
function loadBalancerRef(vendor, node, ctx) {
  const name = ctx.name(node)
  if (!name) return null
  const type = String((node.data.lbConfig && node.data.lbConfig.type) || 'clb').toLowerCase()
  if (vendor === 'aliyun') {
    const resources = {
      clb: 'alicloud_slb_load_balancer',
      alb: 'alicloud_alb_load_balancer',
      nlb: 'alicloud_nlb_load_balancer',
      gwlb: 'alicloud_gwlb_load_balancer',
    }
    return `${resources[type] || resources.clb}.${name}`
  }
  if (vendor === 'tencent') {
    if (type === 'alb') return null // 腾讯云 ALB 未导出
    return `${type === 'gwlb' ? 'tencentcloud_gwlb_instance' : 'tencentcloud_clb_instance'}.${name}`
  }
  return ctx.ref(node)
}

// 依据各节点勾选的 data.outputs，生成创建后才可知属性的 Terraform output 块
// output 名称取「资源名_属性后缀」，并保证整个配置内唯一
export function buildOutputs(ctx, nodes, vendor) {
  const usedNames = new Set()
  const blocks = []
  for (const node of nodes) {
    const defs = outputOptions(vendor, node.type)
    if (!defs.length) continue
    const selected = Array.isArray(node.data && node.data.outputs) ? node.data.outputs : []
    if (!selected.length) continue
      const resName = ctx.name(node)
      const ref = node.type === 'LoadBalancer' ? loadBalancerRef(vendor, node, ctx) : ctx.ref(node)
      if (!resName || !ref) continue
      // 多实例节点使用 splat 输出全部实例的属性
      const splat = isCountedInstance(node) ? '[*]' : ''
      for (const def of defs) {
        if (!selected.includes(def.key)) continue
        let outName = `${resName}_${def.suffix}`
        let seq = 2
        while (usedNames.has(outName)) outName = `${resName}_${def.suffix}_${seq++}`
        usedNames.add(outName)
        blocks.push(`output "${outName}" {\n  value = ${ref}${splat}.${def.attr}\n}`)
      }
  }
  return blocks.join('\n\n')
}
