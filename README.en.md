# SDN Designer

English | [中文](./README.md)

A pure-frontend, drag-and-drop virtual network designer. Visually build virtual network topologies by dragging nodes and connecting them, then export **OVN command-line scripts** or **Alibaba Cloud Terraform** definitions in one click.

![Stack](https://img.shields.io/badge/Vue%203-4FC08D?logo=vuedotjs&logoColor=white)
![Stack](https://img.shields.io/badge/Vue%20Flow-1.48-blue)
![Stack](https://img.shields.io/badge/vue--i18n-9-ff69b4)

## Features

- 🖱️ Drag-and-drop canvas: drag nodes from the library, connect them by dragging handles, with zoom, pan and minimap.
- 🔀 Connection validation: only legal network relationships are allowed (e.g. VM attached to a logical switch, VPC containing a subnet).
- 🖥️ OVN logical network: logical switch / logical router / VM / host (Chassis, with configurable NICs and tunnel encapsulation).
- ☁️ Alibaba Cloud resources: VPC / VSwitch / Gateway (NAT, EIP) / Security Group / ECS instance / Route Table.
- 🕸️ Tunnel network: hosts interconnect via tunnels to form a "zone"; a logical switch can be deployed to all nodes in a zone.
- 📤 Dual-format export:
  - **OVN**: generates `ovn-nbctl` / `ovs-vsctl` / `ovn-sbctl` command scripts.
  - **Terraform**: generates Alibaba Cloud `main.tf` (with resource references and auto-resolved next hops).
- 🌐 Internationalization: bilingual (Chinese / English), one-click switch in the top-right corner, preference stored locally.

## Getting Started

```bash
npm install     # install dependencies
npm run dev     # dev server at http://localhost:5173/
npm run build   # production build
npm run preview # preview production build
```

## Usage

1. Drag nodes from the "Node Library" on the left onto the canvas.
2. Drag a node's right handle onto another node's left handle to connect them (illegal relationships are ignored).
3. Click a node to edit its name, CIDR, IP, rules, etc. in the properties panel on the right.
   - Dragging in a "Host" first opens a creation dialog where you must fill in the node name and NIC info (you can check the tunnel encapsulation NIC).
4. Click "Export OVN commands" or "Export Terraform" in the toolbar to view and copy / download the result.

### Building a logical network across physical nodes

1. Drag in multiple "Host" nodes and connect them pairwise (tunnel interconnect) to form a "zone".
2. Drag in a "Logical Switch" and connect it to any host in the zone (deploy to node).
3. Drag in "VM" nodes and connect them to the logical switch.
4. Export the OVN commands; the script generates tunnel encapsulation config for all hosts in the zone and annotates the switch's deployment scope.

## Supported Nodes

| Category | Node | Description |
| -------- | ---- | ----------- |
| OVN | Logical Switch | Layer-2 broadcast domain with a subnet CIDR |
| OVN | Logical Router | Layer-3 forwarding, can be marked external |
| OVN | Host Chassis | Physical node with multiple NICs + tunnel encapsulation |
| OVN | VM | Logical port with IP / MAC |
| Cloud | VPC | VPC CIDR block |
| Cloud | VSwitch | Subnet within a VPC + availability zone |
| Cloud | Gateway | NAT gateway / Elastic IP |
| Cloud | Security Group | Ingress / egress rules |
| Cloud | ECS Instance | Image, instance type, private IP |
| Cloud | Route Table | Route entries and next hops |

## Project Structure

See [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) for the detailed directory structure and data model.

```
src/
├── App.vue                 # main orchestration
├── store/designer.js       # state management
├── data/nodeDefinitions.js # node type metadata
├── nodes/                  # node components
├── components/             # sidebars / toolbar / inspector / dialogs
├── export/                 # OVN & Terraform exporters (pure functions)
└── i18n/                   # locale messages
```

## License

[WTFPL](http://www.wtfpl.net/) — Do What The Fuck You Want To Public License
