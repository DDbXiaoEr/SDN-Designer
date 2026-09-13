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
export function exportTerraform(nodes, edges, vendor) {
  const exporter = exporters[vendor] || exportAliyunTerraform
  const { provider, variables, main } = exporter(nodes, edges)
  return [
    { id: 'provider', filename: 'provider.tf', content: provider },
    { id: 'variables', filename: 'variables.tf', content: variables },
    { id: 'main', filename: 'main.tf', content: main },
  ]
}
