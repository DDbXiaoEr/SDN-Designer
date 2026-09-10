# SDN Designer

[English](./README.en.md) | 中文

纯前端、拖拽式的虚拟网络设计器。通过拖拽节点与连线，可视化搭建虚拟网络拓扑，并一键导出 **OVN 命令行脚本** 或 **阿里云 Terraform** 资源定义。

![技术栈](https://img.shields.io/badge/Vue%203-4FC08D?logo=vuedotjs&logoColor=white)
![技术栈](https://img.shields.io/badge/Vue%20Flow-1.48-blue)
![技术栈](https://img.shields.io/badge/vue--i18n-9-ff69b4)

## 特性

- 🖱️ 拖拽式画布：从左侧节点库拖入节点，拖动连接点完成连线，支持缩放、平移、小地图。
- 🔀 连接校验：只允许合法的网络关系（如 VM 挂载到逻辑交换机、VPC 包含子网等）。
- 🖥️ OVN 逻辑网络：逻辑交换机 / 逻辑路由器 / 虚拟机 / 宿主机（Chassis，可配置网卡与隧道封装）。
- ☁️ 阿里云资源：VPC / 交换机 / 网关（NAT、EIP）/ 安全组 / ECS 实例 / 路由表。
- 🕸️ 隧道网络：宿主机之间隧道互联，自动形成「区域」；逻辑交换机可部署到区域内的所有节点。
- 📤 双格式导出：
  - **OVN**：生成 `ovn-nbctl` / `ovs-vsctl` / `ovn-sbctl` 命令脚本。
  - **Terraform**：生成阿里云 `main.tf`（含资源引用与自动解析的下一跳）。
- 🌐 国际化：中英文双语，右上角一键切换，偏好保存在本地。

## 快速开始

```bash
npm install     # 安装依赖
npm run dev     # 开发服务器 http://localhost:5173/
npm run build   # 生产构建
npm run preview # 预览生产构建
```

## 使用方式

1. 从左侧「节点库」拖入节点到画布。
2. 拖拽节点右侧连接点到目标节点左侧，建立连线（非法关系会被忽略）。
3. 点击节点，在右侧属性面板编辑名称、网段、IP、规则等。
   - 拖入「宿主机」时会先弹出创建对话框，需填写节点名称与网卡信息（可勾选隧道封装网卡）。
4. 点击顶部「导出 OVN 命令」或「导出 Terraform」查看并复制 / 下载结果。

### 搭建跨物理节点的逻辑网络

1. 拖入多个「宿主机」，两两连线（隧道互联）形成「区域」。
2. 拖入「逻辑交换机」，将其连到区域内的任意宿主机（部署到节点）。
3. 拖入「虚拟机」，连线挂载到逻辑交换机。
4. 导出 OVN 命令，脚本会为区域内的所有宿主机生成隧道封装配置，并标注交换机的部署范围。

## 支持的节点

| 分类 | 节点 | 说明 |
| ---- | ---- | ---- |
| OVN | 逻辑交换机 | 二层广播域，携带子网 CIDR |
| OVN | 逻辑路由器 | 三层转发，可标记外部网络 |
| OVN | 宿主机 Chassis | 物理节点，可配多网卡 + 隧道封装 |
| OVN | 虚拟机 | 逻辑端口，含 IP / MAC |
| 云 | VPC | 专有网络网段 |
| 云 | 交换机 VSwitch | VPC 内子网 + 可用区 |
| 云 | 网关 | NAT 网关 / 弹性公网 IP |
| 云 | 安全组 | 入/出方向规则 |
| 云 | ECS 实例 | 镜像、规格、私网 IP |
| 云 | 路由表 | 路由条目与下一跳 |

## 项目结构

详细目录结构与数据模型见 [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md)。

```
src/
├── App.vue                 # 主编排
├── store/designer.js       # 状态管理
├── data/nodeDefinitions.js # 节点类型元数据
├── nodes/                  # 节点组件
├── components/             # 侧栏 / 工具栏 / 属性面板 / 弹窗
├── export/                 # OVN 与 Terraform 导出（纯函数）
└── i18n/                   # 中英文案
```

## 许可

[WTFPL](http://www.wtfpl.net/) — Do What The Fuck You Want To Public License
