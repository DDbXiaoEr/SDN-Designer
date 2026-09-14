import { outputOptions } from '../../data/outputs.js'

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
    const ref = ctx.ref(node)
    if (!resName || !ref) continue
    for (const def of defs) {
      if (!selected.includes(def.key)) continue
      let outName = `${resName}_${def.suffix}`
      let seq = 2
      while (usedNames.has(outName)) outName = `${resName}_${def.suffix}_${seq++}`
      usedNames.add(outName)
      blocks.push(`output "${outName}" {\n  value = ${ref}.${def.attr}\n}`)
    }
  }
  return blocks.join('\n\n')
}
