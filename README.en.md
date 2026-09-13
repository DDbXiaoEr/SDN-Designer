# SDN Designer

English | [中文](./README.md)

A pure-frontend, drag-and-drop virtual network designer. Visually build virtual network topologies by dragging nodes and connecting them, then export **OVN command-line scripts** or **multi-cloud Terraform** definitions (Alibaba Cloud / Tencent Cloud / AWS / Huawei Cloud) in one click.

![Stack](https://img.shields.io/badge/Vue%203-4FC08D?logo=vuedotjs&logoColor=white)
![Stack](https://img.shields.io/badge/Vue%20Flow-1.48-blue)
![Stack](https://img.shields.io/badge/vue--i18n-9-ff69b4)

## Features

- 🖱️ Drag-and-drop canvas: drag nodes from the library, connect them by dragging handles, with zoom, pan and minimap.
- 🔀 Connection validation: only legal network relationships are allowed (e.g. VM attached to a logical switch, VPC containing a subnet).
- 🖥️ OVN logical network: logical switch / logical router / VM / host (Chassis, with configurable NICs and tunnel encapsulation).
- ☁️ Multi-cloud resources: switch between Alibaba Cloud / Tencent Cloud / AWS / Huawei Cloud, covering VPC / subnet / gateway / EIP / security group / instance / route table.
- 🔗 Multi-VPC interconnect: drag a "VPC Peering" node and connect multiple VPCs; on export it generates pairwise peerings and auto-fills routes in each VPC's route table.
- 🧩 Instance config: image and instance type as editable dropdowns (local built-in list merged with online lists), plus billing method and key pair / password login.
- 🕸️ Tunnel network: hosts interconnect via tunnels to form a "zone"; a logical switch can be deployed to all nodes in a zone.
- 📤 Dual-format export:
  - **OVN**: generates `ovn-nbctl` / `ovs-vsctl` / `ovn-sbctl` command scripts.
  - **Terraform**: generates resource definitions for the selected vendor (resource references, auto-resolved next hops, system disk, key pair resources) and validates availability zone against region on export.
  - Multiple files can be downloaded as a single ZIP archive; the Terraform export dialog lets you optionally fill in cloud credentials (written to the `variables.tf` defaults; leave blank to use environment variables — generated files contain secrets, do not commit them).
- 🌐 Internationalization: bilingual (Chinese / English), one-click switch in the top-right corner, preference stored locally.

## Getting Started

```bash
npm install     # install dependencies
npm run dev     # dev server at http://localhost:5173/
npm run build   # production build
npm run preview # preview production build
```

## Usage

1. Choose a cloud vendor (Alibaba Cloud / Tencent Cloud / AWS / Huawei Cloud) in the toolbar; cloud node naming and exports follow the selection.
2. Drag nodes from the "Node Library" on the left onto the canvas.
3. Drag a node's right handle onto another node's left handle to connect them (illegal relationships are ignored).
4. Double-click a node (or select it and click "Edit" on the right) to edit its name, CIDR, IP, rules, etc. in a dialog; an instance's image and type can be picked from a dropdown or typed directly.
   - Dragging in a "Host" first opens a creation dialog where you must fill in the node name and NIC info (you can check the tunnel encapsulation NIC).
5. Click "Export OVN commands" or "Export Terraform" in the toolbar to view and copy / download the result.

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
| Cloud | Gateway | NAT gateway |
| Cloud | Elastic IP | Standalone EIP, can be associated with an instance |
| Cloud | Security Group | Ingress / egress rules |
| Cloud | ECS Instance | Image, instance type, billing method, login auth, private IP |
| Cloud | Route Table | Route entries and next hops |
| Cloud | VPC Peering | Connect multiple VPCs, exported as VPC peering |

## Instance Image & Type Catalog

An instance's image and instance type are based on a local built-in list, optionally merged with online lists (merged by `value`, online wins on duplicates):

- Local built-in: `src/data/images.js`, `src/data/instanceTypes.js`.
- Online lists are injected via build-time environment variables, see [`.env.example`](./.env.example):
  - `VITE_CATALOG_URL`: remote JSON with the shape `{ "images": { "<vendor>": [{ "value", "label" }] }, "instanceTypes": { ... } }`; partial vendors are allowed.
  - `VITE_CATALOG_API_URL`: a vendor API proxy (calling vendor APIs directly from the browser needs signing and CORS handling, so a backend proxy is recommended). If the URL contains `{vendor}` / `{kind}` placeholders it is requested per vendor/kind, otherwise it is expected to return the full catalog.
- If the online fetch fails, it falls back to the local list automatically and works offline.

## Project Structure

See [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) for the detailed directory structure and data model.

```
src/
├── App.vue        # main orchestration
├── store/         # designer state / vendor / catalog (local + online)
├── data/          # node definitions, vendors, regions, billing, images, types
├── nodes/         # node components
├── components/    # sidebars / toolbar / inspector / dialogs
├── export/        # OVN export + per-vendor Terraform export (pure functions)
└── i18n/          # locale messages
```

## License

[WTFPL](http://www.wtfpl.net/) — Do What The Fuck You Want To Public License
