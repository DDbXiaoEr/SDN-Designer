# OVN-Designer Usage Guide

English | [中文](./usage.md)

> This guide is for users: it covers the UI, operations and step-by-step workflows. For development conventions and the data model, see [`../PROJECT_STRUCTURE.en.md`](../PROJECT_STRUCTURE.en.md).

OVN-Designer is a pure-frontend, drag-and-drop virtual network designer: drag nodes and connect them on the canvas, then export **OVN command-line scripts** or **multi-cloud Terraform** definitions (Alibaba Cloud / Tencent Cloud / AWS / Huawei Cloud) in one click. The whole design is stored in your browser locally, so no backend is required.

- Built-in demo (cloud resources: VPC + subnet + ECS + security group + EIP + key pair):

  ![Cloud resources demo topology](./cloud-resources.en.png)

- Cross-physical-node OVN topology demo:

  ![Cross-physical-node OVN topology demo](./ovn-topology.en.png)

---

## Contents

1. [Getting Started](#getting-started)
2. [UI at a Glance](#ui-at-a-glance)
3. [Basic Canvas Operations](#basic-canvas-operations)
4. [Node Reference](#node-reference)
5. [Step-by-Step Workflows](#step-by-step-workflows)
6. [Export](#export)
7. [Online Catalogs and Vendor Proxy (Optional)](#online-catalogs-and-vendor-proxy-optional)
8. [Validation Hints and FAQ](#validation-hints-and-faq)

---

## Getting Started

```bash
npm install     # install dependencies
npm run dev     # dev server at http://localhost:5173/
npm run build   # production build
npm run preview # preview production build
```

After opening the page:

- The built-in demo (`Basic demo`) loads automatically on first visit. Use the "Load demo" dropdown in the toolbar to switch demos (`Basic demo` / `Load balancer demo`); if the canvas is not empty you'll be asked to confirm before overwriting.
- The design is **auto-saved** to browser localStorage and survives a refresh; use "Save design" / "Import design" in the toolbar for explicit JSON backup and migration.

---

## UI at a Glance

```
┌──────────────────────────── Toolbar ────────────────────────────┐
│ Vendor · Provider version · Language · Load demo · Clear · Save/Import · Link existing · Export │
├──────────┬───────────────────────────────────────┬─────────────┤
│ Palette  │              Canvas (Vue Flow)         │ Inspector   │
│ (drag)   │  zoom controls / grid / scrollbars     │ (read-only) │
├──────────┴───────────────────────────────────────┤             │
│ Messages                        │ Minimap         │             │
└─────────────────────────────────┴─────────────────┴─────────────┘
```

- **Toolbar (top)**: switch cloud vendor, set the Provider version, switch language, load a demo, clear the canvas, save/import a design, link existing instances, export OVN / Terraform.
- **Palette (left)**: two groups, "OVN Logical Network" and "Cloud Resources"; drag onto the canvas to create a node. The footer toggles **light / dark theme**.
- **Canvas (center)**: drag nodes and connect them; the bottom-left controls zoom / fit view / lock; the grid snaps to 16px; the bottom-right minimap can pan and zoom.
- **Inspector (right)**: shows a read-only spec summary for the selected node, plus "Edit" and "Delete" buttons.
- **Messages (bottom)**: rejected or duplicate connections are logged here; you can clear them.

---

## Basic Canvas Operations

### Adding and deleting nodes

- **Drag** a node from the left palette onto the canvas.
- Dropping a "Host Chassis" opens a creation dialog first; fill in the node name and NIC info (at least one NIC; a tunnel NIC requires an IP).
- To delete a node: select it and click "Delete" in the right inspector. Deleting a cluster group node dissolves the grouping and restores the inner hosts' positions.

### Connecting

- Generally, hold the **source node's right handle** and drag to the **target node's left handle** (the canvas uses Loose mode, so either side can start a connection); only legal relationships are allowed.
- Direction matters: e.g. `Subnet → Instance` means "deploy instance", `Instance → SecurityGroup` means "join security group".
- Illegal or duplicate connections are not created, and the reason plus a suggestion (e.g. "reversed direction, should be …") appears in the bottom message panel.
- **Click a connection to delete it**; hovering highlights it in a warning color as feedback. Deleting a Host↔Host tunnel connection recomputes the cluster grouping.

### Editing nodes

- **Double-click a node**, or select it and click "Edit" in the inspector, to open the editor dialog.
- The editor shows different sections per node type (NICs, security group rules, route entries, system/data disks, GPU, NAT, gateway chassis, load-balancer rules, EIP binding, export outputs, ...).

### View operations

- Scroll to zoom, drag empty space to pan; the bottom-left controls zoom in/out, fit the view, and lock interaction.
- The grid snaps to 16px; the bottom horizontal/vertical scrollbars are linked to the viewport.
- The bottom-right minimap can pan by dragging and zoom by scrolling.

---

## Node Reference

### OVN Logical Network

| Node | Purpose | Key properties |
| ---- | ---- | ---- |
| Logical Switch (LS) | Layer-2 broadcast domain | `Subnet CIDR`; can be marked "External network (localnet)" (external switches need `network_name` and `unknown`) |
| Logical Router (LR) | Layer-3 forwarding | Can be marked "External network" with external port IP/MAC, distributed gateway, gateway chassis (HA), NAT rules |
| Host Chassis (HOST) | Physical node | Tunnel protocol (Geneve/VXLAN/STT), multiple NICs (tunnel / external / management), "Control node" flag |
| VM (netns) | Logical port + host network namespace | IP, MAC |
| Host cluster (CLUSTER) | Auto grouping | Compute hosts tunnel-interconnected with each other are auto-merged; not shown in the palette |

**Connection rules (OVN)**:

| Source → Target | Meaning |
| ---- | ---- |
| VM → Logical Switch | Attach port |
| VM → Host | Deploy this VM (netns) to the host |
| Logical Switch → Logical Router | Connect to router |
| Logical Router → Logical Switch | Connect to switch |
| Host → Host | Tunnel interconnect (compute nodes auto-merge into a cluster) |
| Logical Switch → Host | Deploy to node |
| Logical Switch → Cluster | Deploy to all compute nodes in the cluster |
| Cluster → Host (control node) | Join control plane (arrow points to the control node) |

> A host marked "Control node" does not join the compute cluster; the other compute hosts form a "zone" through tunnel interconnections and are merged into a cluster group node.

### Cloud Resources

| Node | Purpose | Key properties |
| ---- | ---- | ---- |
| VPC | Virtual private network | CIDR, region (per vendor) |
| Subnet / VSwitch | Subnet within a VPC | CIDR, availability zone |
| Gateway | NAT gateway | Name |
| Elastic IP (EIP) | Standalone public IP | Count, bandwidth, internet charge type; can be bound to an instance/gateway |
| Security Group | Ingress / egress rules | Name; rules are maintained in the editor |
| Instance (ECS/CVM/EC2) | Compute instance | Image, type, count, billing method, private IP, login method, system/data disks, GPU |
| Load Balancer | Listener + backends | Type (some vendors), listener rules, backend instances (transfer box), health check |
| Route Table | Route entries | Destination CIDR, next hop |
| VPC Peering | Connect multiple VPCs | Name (exported as pairwise fully-meshed peerings) |
| Key Pair | Login key | Source (create / use existing) |

**Connection rules (cloud resources)**:

| Source → Target | Meaning |
| ---- | ---- |
| VPC → Subnet | Contains subnet |
| Subnet → Instance | Deploy instance |
| Instance → Security Group | Join security group |
| Key Pair → Instance | Bind key pair |
| EIP → Instance | Associate instance |
| EIP → Gateway | Associate gateway |
| Subnet → Gateway | Deploy gateway |
| Instance → Gateway | Per-instance egress |
| VPC → Gateway | Attach VPC to gateway |
| Instance → Load Balancer | Join load balancer |
| Subnet → Load Balancer | Attach subnet to load balancer |
| VPC → Load Balancer | Attach VPC to load balancer |
| Subnet → Route Table / VPC → Route Table | Associate route table |
| VPC → VPC Peering | Join peering |

---

## Step-by-Step Workflows

### 1. A cross-physical-node OVN logical network

Goal: one control node plus several compute nodes, a logical switch deployed to the cluster, and VMs deployed as netns on different hosts.

1. Drag in multiple "Host Chassis" and fill in NICs (including a tunnel NIC).
2. Connect the **compute hosts pairwise** (tunnel interconnect); they auto-merge into a cluster group. Mark one host as "Control node".
3. Connect "Cluster → Control node" to join the control plane (the arrow points to the control node; equivalent to all compute nodes in the cluster joining).
4. Drag in a "Logical Switch" and connect it to the "Cluster" (deploy to all nodes in the cluster) or directly to a host (deploy to that node).
5. Drag in "VM" nodes, connect them to the logical switch (attach port), then to the target host (deploy as netns).
6. Click "Export OVN commands": the script generates tunnel encapsulation config for hosts in the zone, sets `requested-chassis` for each VM, and creates the netns / veth on the target host.

See the OVN topology demo image at the top of this guide.

### 2. External network + NAT + gateway HA

1. Drag in a "Logical Switch", check "External network (localnet)", set `network_name` (default `external`) and keep "Set unknown".
2. Drag in a "Logical Router", check "External network", fill in the external port IP/MAC (leave the IP blank to use the external subnet gateway and auto-assign a MAC); optionally check "Distributed gateway".
3. Connections: `internal Logical Switch → Router` (connect to router) and `external Logical Switch → Router` (connect to router).
4. In the router editor, configure **gateway chassis** (check the hosts carrying the external egress and set priorities, higher wins, e.g. primary 20 / standby 10) and **NAT rules** (SNAT / DNAT&SNAT).
5. Hosts need an **external network NIC** whose `network_name` matches the external switch; only then is `ovn-bridge-mappings` generated on export.
6. Gateway-chassis hosts also get an extra `ovn-gateway-ha-<host>.sh` script that polls the external NIC link state for link-level high availability.

### 3. Basic cloud resources (VPC → subnet → ECS → security group / EIP / key pair)

1. Choose a cloud vendor in the toolbar (Alibaba Cloud by default).
2. Drag in a "VPC" and set its CIDR and region.
3. Drag in a "Subnet", connect `VPC → Subnet`, and set CIDR and availability zone.
4. Drag in an "Instance", connect `Subnet → Instance`; in the editor pick image/type (dropdown + free input), billing method, login method, system/data disks. A count > 1 is exported as Terraform `count`.
5. Drag in a "Security Group", connect `Instance → Security Group`, and maintain ingress/egress rules in the editor.
6. Optionally drag in an "EIP" and connect `EIP → Instance` to associate a public IP.
7. Key pair, either way:
   - Drag in a "Key Pair" and connect `Key Pair → Instance`; in its properties choose "Create new key pair" (generated by Terraform with the private key saved) or "Use existing key pair" (references one already in the cloud). Once bound, the instance login method is fixed to key-based login.
   - Or skip the key pair node and fill the login key pair / password directly in the instance editor (legacy designs are supported).

### 4. Multiple ECS sharing one EIP egress (NAT gateway)

1. Build `VPC → Subnet → multiple ECS`.
2. Drag in a "Gateway" and connect as needed: `VPC → Gateway` (whole VPC), `Subnet → Gateway` (per subnet) or `Instance → Gateway` (per instance).
3. Drag in an "EIP" and connect `EIP → Gateway` as the public egress.
4. Drag in a "Route Table", connect `Subnet → Route Table` (or `VPC → Route Table`), and add a route with destination `0.0.0.0/0` and next-hop type `NatGateway`.
5. On Terraform export, the matching resources are generated per vendor; some vendors do not support per-instance/per-VPC SNAT, in which case it is downgraded with a hint in the export dialog.

> Note: an ECS does not connect to a gateway/EIP directly. The correct way for multiple ECS to share an egress is `Subnet → Instance` + `Subnet → Gateway` + `Eip → Gateway`.

### 5. Load balancer

1. Drag in a "Load Balancer" and attach a network: `Subnet → Load Balancer` or `VPC → Load Balancer` (determines deployment location and zones); `internal` controls intranet/public.
2. Connect ECS directly (`Instance → Load Balancer`), or attach a subnet/VPC so the candidate backends automatically include all ECS in it.
3. In the editor, configure **listener rules**: protocol + port, and use the transfer box to move candidate ECS into "Selected backends"; each rule can have a health check (protocol, path, request method, interval, thresholds, ...).
4. Alibaba Cloud / Tencent Cloud additionally let you choose the load balancer type (CLB/ALB/NLB/GWLB) and advanced options; different types map to different Terraform resources and allowed listener protocols.
5. On export, the matching resources are generated per vendor, with hints for missing networks, missing backends, insufficient zones for the type, etc.

### 6. Multi-VPC interconnect

1. Drag in multiple "VPC" nodes.
2. Drag in a "VPC Peering" node and connect every VPC to it (`VPC → VPC Peering`).
3. On export it generates pairwise fully-meshed peerings and auto-adds a route pointing to the peering in each attached VPC's existing route table.

### 7. Deploying GPU instances

In the instance editor, check "Deploy GPU instance": the image and instance type dropdowns switch to the GPU catalog and show the GPU model / count / memory; you can choose to install the NVIDIA driver and a version (written into the instance user data). When unchecked, GPU types/images are excluded from the dropdowns.

### 8. Linking existing cloud resources

1. Click "Link existing instances" in the toolbar, pick a region for the current vendor, and click "Fetch".
2. Preview the VPC/subnet/instance/security group/EIP/NAT/key pair/route table/load balancer resources and relationships to be drawn, then confirm to draw (**this replaces the current canvas**).
3. Imported nodes are marked "existing"; on Terraform export they become `data` sources and are **not recreated**, while references from new resources go through the data sources.

---

## Export

### OVN commands

- Click "Export OVN commands"; the dialog groups output by **execution location**: `All` (merged script), `OVN control node`, each compute `Host <name>`, and the gateway HA `Gateway HA <name>`.
- The commands cover: creating logical switches/routers, localnet external ports, switch-router connections, NAT rules, gateway chassis, tunnel encapsulation (`ovn-remote` / `system-id` / `encap`), external bridges and `ovn-bridge-mappings`, VM netns/veth, etc.
- You can copy, download a single file, or "Download all (ZIP)" to export every file.
- The "Validation hints" at the top of the dialog list potential issues (e.g. external port without a gateway chassis, only one gateway chassis, external `network_name` without a matching NIC, NAT external IP outside the external subnet, ...).

### Terraform

- Click "Export Terraform" to generate resource definitions for the current vendor, resolving resource references and next hops automatically; system/data disks, key pairs and outputs are reflected.
- Multiple files can be downloaded as a single ZIP; the dialog lets you **optionally** fill in cloud credentials (written to `variables.tf` defaults; leave blank to use environment variables).
- **Generated files may contain secrets; do not commit them to version control.**
- On export it validates whether the availability zone belongs to the region and whether the instance type is in stock in the target zone, and shows the results under "Validation hints".

### Post-creation outputs (output.tf)

A cloud resource node can have "available after creation" attributes checked (resource ID; EIP/instance also have public IP), configured in the editor's "Export outputs" section. On export an extra `output.tf` is appended to the result; with nothing checked, that file is not generated.

### Provider version

The toolbar's "Provider version" is written as the main provider's `version` constraint in `provider.tf` (e.g. `~> 5.0`, `>= 1.200.0`) and stored per vendor locally.

- You can type any constraint, or click the arrow on the right of the input to pick from a **published-version dropdown** (with search; picking one generates `~> major.minor`, e.g. `1.98.2` → `~> 1.98`).
- Published versions come from the `VITE_PROVIDER_VERSIONS_URL` environment variable (when unset or failing, only manual input is available); by default they are pulled from the Terraform Registry by the bundled Go service.

---

## Online Catalogs and Vendor Proxy (Optional)

An instance's image and instance type are based on a local built-in list and can optionally be merged with online lists. Calling vendor APIs directly from the browser requires AK/SK signing and CORS handling, so a backend proxy is recommended. This repo bundles a Go + Gin proxy (see [`../server/README.en.md`](../server/README.en.md)); configuration and environment variables are described in [`.env.example`](../.env.example):

- `VITE_CATALOG_URL`: a remote JSON catalog (can return all vendors at once).
- `VITE_CATALOG_API_URL`: a vendor API proxy that supports `{vendor}` / `{kind}` / `{region}` placeholders.
- `VITE_INVENTORY_API_URL`: the inventory endpoint used by "Link existing instances" (falls back to `VITE_CATALOG_API_URL` when unset).
- `VITE_PROVIDER_VERSIONS_URL`: source of published provider versions.

If an online fetch fails it falls back to the local list automatically and works offline.

---

## Validation Hints and FAQ

| Symptom / Hint | Explanation and fix |
| ---- | ---- |
| "Unsupported connection: A → B" | The direction or type does not match a rule; adjust the direction per the message or route through an intermediate node (e.g. an ECS must connect to a subnet first). |
| "This connection already exists" | Duplicate connection; no need to add it again. |
| External `network_name` has no matching host external NIC | The host needs an "external network" NIC whose `network_name` matches the external switch to generate `ovn-bridge-mappings`. |
| Router has only 1 gateway chassis | Single point of failure; configure a primary and a standby gateway chassis and use the HA script. |
| Instance type out of stock in the zone | Shown immediately when connecting `Subnet → Instance`; you can switch the subnet to an in-stock zone in one click, change the type, or adjust the VPC region. |
| Subnet zone does not belong to the chosen region | Auto-adjusted on export, with a hint in the export dialog. |
| AWS EC2 has no password login | Use a key pair or SSM. |
| Tencent Cloud ALB cannot be exported | The Tencent Cloud Terraform Provider has no ALB resource yet; the load balancer is skipped on export (the design is kept). |
| Load-balancer listener has no backend / no network attached | Add backends in the editor and connect `Subnet/VPC → Load Balancer`. |
| Import design failed | Only JSON files exported via "Save design" are supported. |

For more implementation details, the data model and development conventions, see [`../PROJECT_STRUCTURE.en.md`](../PROJECT_STRUCTURE.en.md).
