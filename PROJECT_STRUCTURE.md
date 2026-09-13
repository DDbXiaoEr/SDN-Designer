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
└── src/
    ├── main.js                # 应用入口：createApp(App).use(i18n).mount('#app')
    ├── App.vue                # 主编排：画布、拖拽、连线校验、导出、创建对话框
    ├── styles/
    │   └── main.css           # 全局 CSS 变量（主题色）与基础样式
    ├── data/
    │   ├── nodeDefinitions.js # 节点类型元数据（唯一数据源）
    │   ├── vendors.js         # 云厂商列表 + 资源名/徽标按厂商解析
    │   ├── regions.js         # 各云厂商地域列表与默认地域
    │   ├── chargeTypes.js     # 各云厂商实例计费方式（包年包月/按量付费/抢占式）
    │   ├── images.js          # 各云厂商本地内置镜像列表（在线清单兜底）
    │   └── instanceTypes.js   # 各云厂商本地内置实例规格列表（在线清单兜底）
    ├── store/
    │   ├── designer.js        # 状态管理（provide/inject 封装 useVueFlow）
    │   ├── catalog.js         # 镜像/实例规格清单：本地内置 + 在线 JSON/厂商 API 合并
    │   └── vendor.js          # 当前云厂商（ref，持久化到 localStorage）
    ├── nodes/
    │   ├── BaseNode.vue       # 通用节点外观组件（徽标/名称/摘要/多连接点）
    │   ├── ClusterNode.vue    # 集群分组节点外观（Host 自动归并后的大节点）
    │   └── index.js           # nodeTypes 映射（markRaw(BaseNode) 复用）
    ├── components/
    │   ├── Palette.vue        # 左侧节点库（可拖拽）
    │   ├── Toolbar.vue        # 顶部工具栏（厂商/语言切换/清空/导出）
    │   ├── Inspector.vue      # 右侧属性面板（编辑选中节点）
    │   ├── CreateHostDialog.vue # 创建宿主机对话框（填写网卡信息）
    │   └── ExportModal.vue    # 导出结果弹窗（按节点分组选择/复制/下载/关闭）
    ├── export/
    │   ├── utils.js           # 通用工具：CIDR/MAC/图关系/computeZones/download
    │   ├── ovn.js             # exportOvn(nodes, edges) -> {targets, all}（按执行节点拆分）
    │   └── terraform/
    │       ├── common.js      # 云资源导出共享上下文（命名/引用/VPC解析/下一跳）
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
| Instance        | cloud   | `name`, `imageId`, `instanceType`, `chargeType`(subscription/payAsYouGo/spot), `privateIp`, `loginType`(keyPair/password), `keyPair`, `password` |
| RouteTable      | cloud   | `name`, `routes[]`                                 |

### 连线（Edge）

- `NODE_TYPES` 的 `label` / `fields[].label` / `summary` 键 / `CONNECTION_RULES[].label`
  均为 i18n key，组件内用 `t()` 翻译（字面量选项如 `Geneve`/`VXLAN` 原样返回）。
- 连接规则见 `CONNECTION_RULES`，`canConnect(sourceType, targetType)` 校验。
- 「区域（zone）」= Host 节点通过 Host↔Host 隧道连线形成的连通分量，
  由 `computeZones(nodes, edges)` 计算；`LogicalSwitch → Host` 连线表示交换机部署到该区域。
- 当多个 Host 通过隧道互联时，`designer.js` 的 `recomputeClusters()` 会自动把它们归并为
  一个 `Cluster` 分组节点（Vue Flow parent/child），`VPC → Cluster` 连线表示 VPC 部署到该集群。
  删除 Cluster 节点会解散分组（移除内部隧道连线并还原 Host 绝对位置）。
- `NODE_TYPES` 中 `handles: { source, target }` 控制节点左右两侧的连接点数量（Host 默认 4/4，其余 2/2）；
  `hidden: true` 的节点类型不会出现在左侧节点库。
- 点击连线即删除：`App.vue` 的 `onEdgeClick` → `removeEdge`（Host↔Host 隧道连线删除后重算集群）；
  连线通过 `interactionWidth` 与 CSS 扩大可点击热区，悬停时高亮为警示色作为反馈。

### 云厂商（vendor）

- 工具栏选择云厂商：`aliyun` / `tencent` / `aws` / `huawei`，存于 `store/vendor.js`，持久化到 localStorage。
- 云资源节点的展示名与徽标按厂商变化（`vendors.js` 的 `nodeLabelKey` / `nodeBadge`）：
  i18n 中 `nodes.vpc` / `nodes.subnet` / `nodes.instance` 等为按厂商分组的对象。
- Terraform 导出按厂商分发（`export/terraform/index.js`）；OVN 导出与厂商无关。
- VPC 的「地域」按当前厂商从 `regions.js` 下拉选择；Terraform 导出的 provider 默认地域取自首个 VPC 的 `region`。
- Instance 的「计费方式」按当前厂商从 `chargeTypes.js` 下拉选择（包年包月/按量付费/抢占式）；
  导出时映射为各厂商字段（如阿里云 `instance_charge_type` + `spot_strategy`，腾讯云 `instance_charge_type`，华为云 `charging_mode`，AWS `instance_market_options`）。
- 独立 `Eip` 节点表示公网 IP；`Eip → Instance` 连线表示绑定到该实例，导出为厂商绑定资源
  （`alicloud_eip_association` / `tencentcloud_eip_association` / `huaweicloud_compute_eip_associate` / `aws_eip_association`）。
- Instance 的「镜像」与「实例规格」为可编辑下拉（input + datalist），清单来自 `store/catalog.js`：
  以 `images.js` / `instanceTypes.js` 的本地内置清单为基底，按 `value` 合并在线清单（同项在线覆盖）。
  在线来源通过构建时环境变量注入：`VITE_CATALOG_URL`（远程 JSON）优先，其次 `VITE_CATALOG_API_URL`
  （厂商 API 代理，支持 `{vendor}` / `{kind}` 占位符），配置见 `.env.example`；拉取失败时自动回退本地。

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
