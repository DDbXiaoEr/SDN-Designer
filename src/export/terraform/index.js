import { exportAliyunTerraform } from './aliyun.js'
import { exportAwsTerraform } from './aws.js'
import { exportTencentTerraform } from './tencent.js'
import { exportHuaweiTerraform } from './huawei.js'
import { defaultProviderVersion } from '../../data/vendors.js'
import { translate } from '../../i18n/index.js'

const exporters = {
  aws: exportAwsTerraform,
  tencent: exportTencentTerraform,
  huawei: exportHuaweiTerraform,
  aliyun: exportAliyunTerraform,
}

// 按厂商分发 Terraform 导出，拆分为 provider / variables / main 三个文件
// 当有节点勾选了「创建后获取」的属性时，额外生成 output.tf
// providerVersion 为工具栏填写的主 provider 版本约束，空值时回退内置默认值
// adoptExisting=true 时以 resource + import 块接管已有资源（可 import 后 destroy 删除）
export function exportTerraform(nodes, edges, vendor, providerVersion, adoptExisting = false) {
  const exporter = exporters[vendor] || exportAliyunTerraform
  const version = String(providerVersion ?? '').trim() || defaultProviderVersion(vendor)
  const { provider, variables, main, outputs, imports } = exporter(nodes, edges, version, adoptExisting)
  const files = [
    { id: 'provider', filename: 'provider.tf', content: provider },
    { id: 'variables', filename: 'variables.tf', content: variables },
    { id: 'main', filename: 'main.tf', content: main },
  ]
  if (outputs && outputs.trim()) {
    files.push({ id: 'outputs', filename: 'output.tf', content: outputs + '\n' })
  }
  // 接管模式：已有资源的 import 块单独成文件，配合 resource 块纳入 state 后即可 destroy
  if (imports && imports.trim()) {
    const header = `# ${translate('export.adoptImportHint')}\n\n`
    files.push({ id: 'imports', filename: 'import.tf', content: header + imports + '\n' })
  }
  return files
}
