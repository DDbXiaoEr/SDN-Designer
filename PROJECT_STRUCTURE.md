# 项目结构

> 本文件描述 OVN-Designer 的目录与模块职责。会话开始时应先阅读本文件，避免重复探索整个项目。

## 技术栈

- Vue 3（`<script setup>` 组合式 API）+ Vite
- Vue Flow（`@vue-flow/core` 及 background/controls/minimap 子包）——拖拽式节点画布
- vue-i18n v9 —— 国际化（zh-CN / en-US）

## 目录结构

```
OVN-Designer/
├── index.html                 # 入口 HTML
├── package.json               # 依赖与脚本 (dev / build / preview)
├── vite.config.js             # Vite 配置（@vitejs/plugin-vue）
├── .env.example               # 在线清单环境变量示例（VITE_CATALOG_*）
├── README.md / README.en.md   # 中英文说明
├── PROJECT_STRUCTURE.md       # 本文件：目录结构与数据模型
├── server/                    # Go + Gin 在线清单服务（云厂商 AK/SK 代理，独立模块）
│   ├── main.go                # 入口：Gin 路由 / CORS / 优雅退出
│   ├── internal/config/       # 配置：YAML 文件（环境变量可覆盖，密钥全部可配置）
│   ├── internal/catalog/      # Item/Provider 抽象、TTL 缓存、HTTP 接口
│   ├── internal/provider/     # 腾讯/阿里/AWS/华为实现 + mock + 注册表
│   ├── config.example.yaml    # 服务配置示例（复制为 config.yaml）
│   └── README.md              # 接口与运行说明
└── src/
    ├── main.js                # 应用入口：createApp(App).use(i18n).mount('#app')
    ├── App.vue                # 主编排：画布、拖拽、连线校验（含可用区库存提示 toast）、示例加载、保存/导入、导出、创建对话框
    ├── styles/
    │   └── main.css           # 全局 CSS 变量（主题色）与基础样式
    ├── data/
    │   ├── nodeDefinitions.js # 节点类型元数据（唯一数据源）
    │   ├── vendors.js         # 云厂商列表 + 资源名/徽标按厂商解析 + provider 默认版本
    │   ├── regions.js         # 各云厂商地域列表与默认地域
    │   ├── chargeTypes.js     # 各云厂商实例计费方式（包年包月/按量付费/抢占式）
    │   ├── disks.js           # 各云厂商云盘类型（系统盘/数据盘）
    │   ├── outputs.js         # 云资源「创建后可获取」属性（资源 ID/公网 IP）
    │   ├── demo.js            # 内置示例拓扑（首次访问自动加载，工具栏可重新载入）
    │   ├── images.js          # 各云厂商本地内置镜像列表（在线清单兜底）
    │   └── instanceTypes.js   # 各云厂商本地内置实例规格列表（在线清单兜底）
    ├── store/
    │   ├── designer.js        # 状态管理（provide/inject 封装 useVueFlow）
    │   ├── catalog.js         # 镜像/实例规格清单：本地内置 + 在线 JSON/厂商 API 合并
    │   ├── persistence.js     # 设计序列化/反序列化 + localStorage 自动保存
    │   └── vendor.js          # 当前云厂商 + 各厂商 provider 版本（ref，持久化到 localStorage）
    ├── nodes/
    │   ├── BaseNode.vue       # 通用节点外观组件（徽标/名称/摘要/多连接点）
    │   ├── ClusterNode.vue    # 集群分组节点外观（Host 自动归并后的大节点）
    │   └── index.js           # nodeTypes 映射（markRaw(BaseNode) 复用）
    ├── components/
    │   ├── Palette.vue        # 左侧节点库（可拖拽）
    │   ├── Toolbar.vue        # 顶部工具栏（厂商/Provider 版本/语言/加载示例/清空/保存/导入/导出）
    │   ├── Inspector.vue      # 右侧属性面板（只读摘要 + 编辑/删除按钮）
    │   ├── NodeEditorDialog.vue # 节点编辑弹窗（字段编辑 + 网卡/规则/路由/磁盘/输出分区）
    │   ├── CreateHostDialog.vue # 创建宿主机对话框（填写网卡信息）
    │   └── ExportModal.vue    # 导出结果弹窗（分组查看/复制/下载/打包 ZIP/填写凭证）
    ├── export/
    │   ├── utils.js           # 通用工具：CIDR/MAC/图关系/computeZones/download/createZip
    │   ├── ovn.js             # exportOvn(nodes, edges) -> {targets, all}（按执行节点拆分）
    │   └── terraform/
    │       ├── common.js      # 导出共享上下文与工具（命名/引用/VPC解析/下一跳/密钥对/磁盘/tls）
    │       ├── outputs.js     # buildOutputs：生成 output.tf（创建后可获取属性）
    │       ├── index.js       # exportTerraform(nodes, edges, vendor) 按厂商分发
    │       ├── aliyun.js      # 阿里云 Terraform 导出
    │       ├── aws.js         # AWS Terraform 导出
    │       ├── tencent.js     # 腾讯云 Terraform 导出
    │       └── huawei.js      # 华为云 Terraform 导出
    └── i18n/
        ├── index.js           # createI18n、setLocale、translate、SUPPORTED_LOCALES
        └── locales/
            ├── zh-CN.js       # 中文文案
            └── en-US.js       # 英文文案
```

## 核心数据模型

### 节点（Node）

节点对象：`{ id, type, position: {x,y}, data: {...} }`

`data` 由 `NODE_TYPES[type].defaults()` 生成，各类型字段如下：

| type            | 分类    | data 关键字段                                      |
| --------------- | ------- | -------------------------------------------------- |
| LogicalSwitch   | ovn     | `name`, `subnet`                                   |
| LogicalRouter   | ovn     | `name`, `externalNetwork`                          |
| Host            | ovn     | `name`, `encapType`, `nics[{name,ip,tunnel}]`      |
| Cluster         | ovn     | `name`, `hostCount`（自动生成，不进节点库）        |
| VM              | ovn     | `name`, `ip`, `mac`                                |
| VPC             | cloud   | `name`, `cidr`, `region`                           |
| Subnet          | cloud   | `name`, `cidr`, `zone`                             |
| Gateway         | cloud   | `name`（NAT 网关）                                 |
| Eip             | cloud   | `name`, `bandwidth`, `internetChargeType`(payByTraffic/payByBandwidth) |
| SecurityGroup   | cloud   | `name`, `rules[]`                                  |
| Instance        | cloud   | `name`, `imageId`, `instanceType`, `chargeType`(subscription/payAsYouGo/spot), `privateIp`, `loginType`(keyPair/password), `keyPair`, `password`, `systemDisk{type,size}`, `dataDisks[{type,size}]` |
| RouteTable      | cloud   | `name`, `routes[]`                                 |
| Interconnect    | cloud   | `name`（VPC 对等连接，连接多个 VPC）               |
| KeyPair         | cloud   | `name`, `mode`(create/existing)（登录密钥对，绑定实例） |

### 连线（Edge）

- `NODE_TYPES` 的 `label` / `fields[].label` / `summary` 键 / `CONNECTION_RULES[].label`
  均为 i18n key，组件内用 `t()` 翻译（字面量选项如 `Geneve`/`VXLAN` 原样返回）。
- 连接规则见 `CONNECTION_RULES`，`canConnect(sourceType, targetType)` 校验。
- 「区域（zone）」= Host 节点通过 Host↔Host 隧道连线形成的连通分量，
  由 `computeZones(nodes, edges)` 计算；`LogicalSwitch → Host` 连线表示交换机部署到该区域。
- 当多个 Host 通过隧道互联时，`designer.js` 的 `recomputeClusters()` 会自动把它们归并为
  一个 `Cluster` 分组节点（Vue Flow parent/child），`VPC → Cluster` 连线表示 VPC 部署到该集群。
  删除 Cluster 节点会解散分组（移除内部隧道连线并还原 Host 绝对位置）。
- `NODE_TYPES` 中 `handles: { source, target }` 控制节点左右两侧的连接点数量（默认 2/2；
  Host 为 4/4、KeyPair 为 2/4、Interconnect 为 1/8）；`hidden: true` 的节点类型不会出现在左侧节点库。
- 点击连线即删除：`App.vue` 的 `onEdgeClick` → `removeEdge`（Host↔Host 隧道连线删除后重算集群）；
  连线通过 `interactionWidth` 与 CSS 扩大可点击热区，悬停时高亮为警示色作为反馈。

### 云厂商（vendor）

- 工具栏选择云厂商：`aliyun` / `tencent` / `aws` / `huawei`，存于 `store/vendor.js`，持久化到 localStorage。
- 工具栏「Provider 版本」输入框对应当前厂商，写入 `provider.tf` 中主 provider 的 `version` 约束
  （如 `~> 5.0` / `>= 1.200.0`）；各厂商版本独立保存于 `store/vendor.js` 的 `providerVersions`，
  留空时回退到 `vendors.js` 的 `DEFAULT_PROVIDER_VERSIONS`。`tls` / `local` 等辅助 provider 版本固定不变。
- 云资源节点的展示名与徽标按厂商变化（`vendors.js` 的 `nodeLabelKey` / `nodeBadge`）：
  i18n 中 `nodes.vpc` / `nodes.subnet` / `nodes.instance` 等为按厂商分组的对象。
- Terraform 导出按厂商分发（`export/terraform/index.js`）；OVN 导出与厂商无关。
- VPC 的「地域」按当前厂商从 `regions.js` 下拉选择；Terraform 导出的 provider 默认地域取自首个 VPC 的 `region`。
- Instance 的「计费方式」按当前厂商从 `chargeTypes.js` 下拉选择（包年包月/按量付费/抢占式）；
  导出时映射为各厂商字段（如阿里云 `instance_charge_type` + `spot_strategy`，腾讯云 `instance_charge_type`，华为云 `charging_mode`，AWS `instance_market_options`）。
- 独立 `Eip` 节点表示公网 IP；`Eip → Instance` 连线表示绑定到该实例，导出为厂商绑定资源
  （`alicloud_eip_association` / `tencentcloud_eip_association` / `huaweicloud_compute_eip_associate` / `aws_eip_association`）。
- Instance 的「镜像」与「实例规格」为「下拉 + 可手输」控件（`combo` 字段：`select` 列出全部候选 + 「自定义…」项，
  选中后显示文本框手输；当前值不在候选列表时自动进入自定义），清单来自 `store/catalog.js`：
  以 `images.js` / `instanceTypes.js` 的本地内置清单为基底，按 `value` 合并在线清单（同项在线覆盖）。
  在线来源通过构建时环境变量注入：`VITE_CATALOG_URL`（远程 JSON）优先，其次 `VITE_CATALOG_API_URL`
  （厂商 API 代理，支持 `{vendor}` / `{kind}` 占位符），配置见 `.env.example`；拉取失败时自动回退本地。
  代理服务见 `server/`（Go + Gin）：`GET /api/:kind/:vendor[/:region]` 用厂商 AK/SK 签名调用
  `DescribeImages` / `DescribeInstanceTypes`（腾讯云另有可用区库存 `zones`），未配置密钥的厂商返回 501；
  密钥等配置在 `server/config.yaml`（YAML，环境变量可覆盖），`server/config.example.yaml` 为示例，
  `mock: true` 可无凭证联调。
- 规格条目可带 `zones`（该规格有货的完整可用区 ID 列表，缺省表示不限制），`catalog.js` 归一化时保留，
  并导出 `instanceTypeZones(vendor, type)`；本地 `instanceTypes.js` 仅对腾讯云 SA3 系列标注
  `ap-guangzhou-5/6/7` 作为示例，真实库存由在线清单提供。
- 腾讯云 CVM 必须与子网同可用区，故「库存」约束作用在 `Subnet.zone`（部署可用区）上，
  判定统一由 `common.js` 的 `validateInstanceZones(nodes, edges, vendor, zonesOf)` 提供（返回项含 `subnetId`、`sameRegion`）：
  - 连线 `Subnet → Instance` 时，`App.vue` 的 `onConnect` 立即校验并弹出轻量提示（`toast`），
    带「子网改用某可用区」快捷动作；
  - 编辑 `Subnet` 时，「可用区库存」分区列出该子网下规格无货的实例，并给出一键改可用区按钮；
  - 编辑 `Instance` 时，若其规格不在所属子网可用区有货，给出同类提示；
  - 导出时汇总为 warning（不影响 Terraform 内容）。
- Instance 的「系统盘/数据盘」在编辑弹窗中配置：系统盘类型按厂商从 `disks.js` 下拉选择，容量单位 GiB；
  数据盘为可增删列表。导出时映射为各厂商字段（阿里云 `system_disk_category` + `data_disks`，
  腾讯云/华为云 `system_disk_type` + `data_disks`，AWS `root_block_device` + `ebs_block_device`）。
- `Interconnect` 节点表示 VPC 对等连接：`VPC → Interconnect` 可连多个 VPC；导出时按两两全互联生成对等连接
  （`alicloud_vpc_peer_connection` / `tencentcloud_vpc_peering_connection` / `aws_vpc_peering_connection` /
  `huaweicloud_vpc_peering_connection`），并为每个接入 VPC 已有的 `RouteTable` 自动补一条指向该对等连接的路由条目。
- 云资源节点可勾选「创建后可获取」的属性（资源 ID；Eip/Instance 另有公网 IP）存于 `data.outputs`：
  选项来自 `data/outputs.js`（按厂商映射只读属性名），在 `NodeEditorDialog` 的「导出输出」分区勾选。
  导出时 `export/terraform/outputs.js` 的 `buildOutputs` 生成 `output` 块，多文件导出中追加 `output.tf`；
  无任何勾选则不生成该文件。
- `KeyPair` 节点表示登录密钥对：`Instance → KeyPair` 连线表示绑定；`mode='create'` 由 Terraform 新建
  （`*_key_pair` 资源，腾讯云/AWS/华为云附带 `tls_private_key` 与 `.pem` 私钥文件，阿里云用 `key_file`），
  `mode='existing'` 关联云上已有密钥对（阿里云/AWS/华为云按名称引用；腾讯云因实例用 `key_ids`，生成
  `data "tencentcloud_key_pairs"` 按名称查询 ID）。实例已连接 KeyPair 节点时，编辑器隐藏内联「登录密钥对」字段，
  导出优先使用节点；未连线时回退到内联 `keyPair`（兼容旧设计），密码登录不受影响。
- 节点属性编辑在 `NodeEditorDialog` 弹窗中完成：双击节点或点击右侧面板的「编辑」打开；
  `Inspector` 仅显示只读摘要与编辑/删除按钮。
- 内置示例拓扑定义于 `data/demo.js`（`createDemoDesign()` 返回深拷贝）；首次访问（无本地保存设计）
  自动加载，工具栏「加载示例」可随时重新载入（画布非空时先确认）；边的标签在加载时按当前语言解析。

### OVN 导出（按执行节点拆分）

- `exportOvn(nodes, edges)` 返回 `{ targets, all }`：
  - `targets` = 按执行位置拆分的命令：`central`（控制节点，ovn-nbctl/ovn-sbctl）+
    每个 `Host`（各自的 ovs-vsctl 封装命令），各带独立 `content` 与 `filename`。
  - `all` = 完整合并脚本 `{ content, filename }`。
- `ExportModal` 接收 `groups`（分组列表），多组时显示下拉选择查看/下载对应节点的命令。

## 关键约定

1. **节点类型新增**：只需在 `nodeDefinitions.js` 加一条 `NODE_TYPES` 记录 + 必要的
   `CONNECTION_RULES` + i18n 文案（zh-CN / en-US 两处）。
2. **状态管理**：`App.vue` 调用 `createDesigner()`（内部 useVueFlow），
   子组件通过 `useDesigner()` inject；节点/边数据以 `nodes.value` / `edges.value` 读取，
   **不要**用 `v-model:nodes`，避免双向绑定导致节点在点击后丢失。
3. **所有 UI 文案必须走 i18n**（`t('key')`），新文案同时在两个 locale 文件补齐。
4. **导出逻辑**：`export/` 下均为纯函数，内部用 `translate('export.xxx')` 生成多语言注释；
   新增云厂商时在 `export/terraform/` 加对应导出器并在 `index.js` 分发。
