import { exportAliyunTerraform } from './aliyun.js'
import { exportAwsTerraform } from './aws.js'
import { exportTencentTerraform } from './tencent.js'
import { exportHuaweiTerraform } from './huawei.js'

// 按厂商分发 Terraform 导出
export function exportTerraform(nodes, edges, vendor) {
  switch (vendor) {
    case 'aws':
      return exportAwsTerraform(nodes, edges)
    case 'tencent':
      return exportTencentTerraform(nodes, edges)
    case 'huawei':
      return exportHuaweiTerraform(nodes, edges)
    case 'aliyun':
    default:
      return exportAliyunTerraform(nodes, edges)
  }
}
