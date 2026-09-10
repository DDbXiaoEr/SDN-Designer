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
    │   └── nodeDefinitions.js # 节点类型元数据（唯一数据源）
    ├── store/
    │   └── designer.js        # 状态管理（provide/inject 封装 useVueFlow）
    ├── nodes/
    │   ├── BaseNode.vue       # 通用节点外观组件（徽标/名称/摘要/连接点）
    │   └── index.js           # nodeTypes 映射（markRaw(BaseNode) 复用）
    ├── components/
    │   ├── Palette.vue        # 左侧节点库（可拖拽）
    │   ├── Toolbar.vue        # 顶部工具栏（语言切换/清空/导出）
    │   ├── Inspector.vue      # 右侧属性面板（编辑选中节点）
    │   ├── CreateHostDialog.vue # 创建宿主机对话框（填写网卡信息）
    │   └── ExportModal.vue    # 导出结果弹窗（复制/下载/关闭）
    ├── export/
    │   ├── utils.js           # 通用工具：CIDR/MAC/图关系/computeZones/download
    │   ├── ovn.js             # exportOvn(nodes, edges) -> ovn-nbctl/ovs-vsctl 脚本
    │   └── terraformAliyun.js # exportAliyunTerraform(nodes, edges) -> 阿里云 main.tf
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
| VM              | ovn     | `name`, `ip`, `mac`                                |
| VPC             | cloud   | `name`, `cidr`                                     |
| Subnet          | cloud   | `name`, `cidr`, `zone`                             |
| Gateway         | cloud   | `name`, `kind` (nat/eip)                           |
| SecurityGroup   | cloud   | `name`, `rules[]`                                  |
| Instance        | cloud   | `name`, `imageId`, `instanceType`, `privateIp`     |
| RouteTable      | cloud   | `name`, `routes[]`                                 |

### 连线（Edge）

- `NODE_TYPES` 的 `label` / `fields[].label` / `summary` 键 / `CONNECTION_RULES[].label`
  均为 i18n key，组件内用 `t()` 翻译（字面量选项如 `Geneve`/`VXLAN` 原样返回）。
- 连接规则见 `CONNECTION_RULES`，`canConnect(sourceType, targetType)` 校验。
- 「区域（zone）」= Host 节点通过 Host↔Host 隧道连线形成的连通分量，
  由 `computeZones(nodes, edges)` 计算；`LogicalSwitch → Host` 连线表示交换机部署到该区域。

## 关键约定

1. **节点类型新增**：只需在 `nodeDefinitions.js` 加一条 `NODE_TYPES` 记录 + 必要的
   `CONNECTION_RULES` + i18n 文案（zh-CN / en-US 两处）。
2. **状态管理**：`App.vue` 调用 `createDesigner()`（内部 useVueFlow），
   子组件通过 `useDesigner()` inject；节点/边数据以 `nodes.value` / `edges.value` 读取，
   **不要**用 `v-model:nodes`，避免双向绑定导致节点在点击后丢失。
3. **所有 UI 文案必须走 i18n**（`t('key')`），新文案同时在两个 locale 文件补齐。
4. **导出逻辑**：`export/ovn.js` 与 `export/terraformAliyun.js` 为纯函数，
   内部用 `translate('export.xxx')` 生成多语言注释。
