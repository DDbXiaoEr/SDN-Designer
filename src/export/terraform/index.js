import { exportAliyunTerraform } from './aliyun.js'
import { exportAwsTerraform } from './aws.js'
import { exportTencentTerraform } from './tencent.js'
import { exportHuaweiTerraform } from './huawei.js'

const exporters = {
  aws: exportAwsTerraform,
  tencent: exportTencentTerraform,
  huawei: exportHuaweiTerraform,
  aliyun: exportAliyunTerraform,
}

// 按厂商分发 Terraform 导出，拆分为 provider / variables / main 三个文件
// 当有节点勾选了「创建后获取」的属性时，额外生成 output.tf
export function exportTerraform(nodes, edges, vendor) {
  const exporter = exporters[vendor] || exportAliyunTerraform
  const { provider, variables, main, outputs } = exporter(nodes, edges)
  const files = [
    { id: 'provider', filename: 'provider.tf', content: provider },
    { id: 'variables', filename: 'variables.tf', content: variables },
    { id: 'main', filename: 'main.tf', content: main },
  ]
  if (outputs && outputs.trim()) {
    files.push({ id: 'outputs', filename: 'output.tf', content: outputs + '\n' })
  }
  return files
}
