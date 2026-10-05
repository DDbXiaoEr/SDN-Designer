# Project Structure

[中文](./PROJECT_STRUCTURE.md) | English

> This document describes the directory and module responsibilities of OVN-Designer. Read it at the start of a session to avoid re-exploring the entire project.

## Tech Stack

- Vue 3 (`<script setup>` Composition API) + Vite
- Vue Flow (`@vue-flow/core` plus the background/controls/minimap subpackages) — drag-and-drop node canvas
- vue-i18n v9 — internationalization (zh-CN / en-US)

## Directory Structure

```
OVN-Designer/
├── index.html                 # Entry HTML (includes the first-paint theme preset script to avoid flashing)
├── package.json               # Dependencies and scripts (dev / build / preview)
├── vite.config.js             # Vite config (@vitejs/plugin-vue)
├── .env.example               # Example env vars for online catalogs (VITE_CATALOG_*)
├── README.md / README.en.md   # Chinese / English readme
├── PROJECT_STRUCTURE.md / PROJECT_STRUCTURE.en.md # This file: directory structure and data model (zh / en)
├── doc/                       # Usage docs and screenshots
│   ├── usage.md / usage.en.md # Usage guide (zh / en; UI/operations/workflows/export/FAQ)
│   └── cloud-resources(.en).png / ovn-topology(.en).png # zh / en demo screenshots
├── server/                    # Go + Gin online catalog service (vendor AK/SK proxy, standalone module)
│   ├── main.go                # Entry: Gin routes / CORS / graceful shutdown
│   ├── internal/config/       # Config: YAML file (env vars can override; all secrets configurable)
│   ├── internal/catalog/      # Item/Provider abstraction, TTL cache, HTTP endpoints
│   ├── internal/inventory/    # Existing cloud resource topology (VPC/subnet/instance, ...) abstraction, TTL cache, HTTP endpoints
│   ├── internal/provider/     # Tencent/Alibaba/AWS/Huawei implementations + mock + registry (incl. stock fetching)
│   ├── internal/tfversion/    # Terraform provider published versions (Registry fetch + cache + mock)
│   ├── config.example.yaml    # Example service config (copy to config.yaml)
│   └── README.md / README.en.md # API and run instructions (zh / en)
└── src/
    ├── main.js                # App entry: createApp(App).use(i18n).mount('#app')
    ├── App.vue                # Orchestration: canvas, drag-drop, connection validation (incl. zone stock toast), demo loading, save/import, link existing instances, export, creation dialogs
    ├── styles/
    │   └── main.css           # Global CSS variables and base styles (light/dark theme tokens)
    ├── data/
    │   ├── nodeDefinitions.js # Node type metadata (single source of truth)
    │   ├── vendors.js         # Vendor list + per-vendor resource names/badges + default provider versions + node config migration on vendor switch
    │   ├── regions.js         # Per-vendor region lists and default region
    │   ├── chargeTypes.js     # Per-vendor instance charge types (subscription/pay-as-you-go/spot)
    │   ├── disks.js           # Per-vendor disk types (system/data)
    │   ├── outputs.js         # Cloud resource "available after creation" attributes (resource ID / public IP)
    │   ├── demo.js            # Built-in demo topologies (basic/load-balancer; basic auto-loads on first visit, toolbar dropdown switches)
    │   ├── inventoryLayout.js # Cloud inventory graph -> canvas node/edge layout
    │   ├── images.js          # Per-vendor local built-in image lists (fallback for online catalogs)
    │   └── instanceTypes.js   # Per-vendor local built-in instance type lists (fallback for online catalogs)
    ├── store/
    │   ├── designer.js        # State management (provide/inject wrapper around useVueFlow)
    │   ├── catalog.js         # Image/instance type catalogs: local built-in + online JSON/vendor API merge
    │   ├── inventory.js       # Fetch existing cloud resources by region (from server /api/inventory)
    │   ├── providerVersions.js # Published Terraform provider versions (from server /api/providerVersions)
    │   ├── persistence.js     # Design serialize/deserialize + localStorage autosave + legacy design field migration (NIC role, external network/NAT defaults)
    │   ├── theme.js           # Theme (light/dark): <html data-theme> + localStorage, exposes setTheme/toggleTheme
    │   └── vendor.js          # Current vendor + per-vendor provider versions (ref, persisted to localStorage)
    ├── nodes/
    │   ├── BaseNode.vue       # Generic node appearance (badge/name/summary/multiple handles)
    │   ├── ClusterNode.vue    # Cluster group node appearance (large node after hosts auto-merge)
    │   └── index.js           # nodeTypes map (reuse markRaw(BaseNode))
    ├── components/
    │   ├── Palette.vue        # Left palette (draggable; light/dark theme toggle at the bottom)
    │   ├── Toolbar.vue        # Top toolbar (vendor/provider version/language/load demo/clear/save/import/link existing/export)
    │   ├── ProviderVersionSelect.vue # Provider version input + published-version dropdown (search; picking generates ~> major.minor)
    │   ├── Inspector.vue      # Right inspector (read-only summary + edit/delete buttons)
    │   ├── NodeEditorDialog.vue # Node editor dialog (field editing + NIC/rules/routes/disks/output sections)
    │   ├── CreateHostDialog.vue # Host creation dialog (fill in NIC info)
    │   ├── ImportInventoryDialog.vue # Link existing instances: pick region, fetch inventory, preview then draw to canvas
    │   ├── ExportModal.vue    # Export result dialog (grouped view/copy/download/ZIP pack/fill credentials)
    │   ├── MessagePanel.vue   # Bottom message area (rejected connections etc.; expand/collapse/clear)
    │   ├── TransferBox.vue    # Transfer box (load-balancer backend selection; candidates on the left / selected on the right)
    │   └── CanvasScrollbars.vue # Canvas scrollbars (horizontal/vertical sliders linked to the Vue Flow viewport)
    ├── export/
    │   ├── utils.js           # Common utilities: CIDR/MAC/graph relationships/computeZones/download/createZip
    │   ├── ovn.js             # exportOvn(nodes, edges) -> {targets, all} (split by execution node)
    │   └── terraform/
    │       ├── common.js      # Shared export context and utilities (naming/references/existing-resource data source and adopt import/VPC resolution/next hop/key pair/disks/tls)
    │       ├── outputs.js     # buildOutputs: generates output.tf (attributes available after creation)
    │       ├── index.js       # exportTerraform(nodes, edges, vendor, providerVersion, adoptExisting) dispatches per vendor (adopt mode adds import.tf)
    │       ├── aliyun.js      # Alibaba Cloud Terraform export
    │       ├── aws.js         # AWS Terraform export
    │       ├── tencent.js     # Tencent Cloud Terraform export
    │       └── huawei.js      # Huawei Cloud Terraform export
    └── i18n/
        ├── index.js           # createI18n, setLocale, translate, SUPPORTED_LOCALES
        └── locales/
            ├── zh-CN.js       # Chinese messages
            └── en-US.js       # English messages
```

## Core Data Model

### Node

Node object: `{ id, type, position: {x,y}, data: {...} }`

`data` is generated by `NODE_TYPES[type].defaults()`. Nodes imported via "Link existing instances" additionally carry `existing: true` and `cloudId` (cloud resource ID); on Terraform export they become `data` instead of `resource`. Fields per type:

| type            | category | key `data` fields                                  |
| --------------- | -------- | -------------------------------------------------- |
| LogicalSwitch   | ovn      | `name`, `subnet`, `isExternal`(provider/localnet), `networkName`(localnet network_name), `unknownAddresses`(default true) |
| LogicalRouter   | ovn      | `name`, `externalNetwork`, `externalNetworkName`, `externalIp`/`externalMac`(external port; leave blank to use the external subnet gateway and auto-assign a MAC), `distributed`(distributed gateway), `gatewayChassis[{hostId,priority}]`(external port gateway HA), `nats[{type:snat\|dnat_and_snat, externalIp, logicalIp, logicalPort, externalMac, enabled}]` |
| Host            | ovn      | `name`, `encapType`, `nics[{name,ip,role: tunnel\|external\|mgmt,networkName,bridge}]` (compatible with legacy `tunnel` boolean; external NIC `networkName` defaults to `external`, `bridge` defaults to `br-ex`) |
| Cluster         | ovn      | `name`, `hostCount` (auto-generated; not in the palette) |
| VM              | ovn      | `name`, `ip`, `mac` (a VM on the canvas is a netns on a host) |
| VPC             | cloud    | `name`, `cidr`, `region`                           |
| Subnet          | cloud    | `name`, `cidr`, `zone`                             |
| Gateway         | cloud    | `name` (NAT gateway)                               |
| Eip             | cloud    | `name`, `count`(count; >1 means multiple public IPs, exported as Terraform `count`), `bandwidth`, `internetChargeType`(payByTraffic/payByBandwidth), `bindings{index:{id,index}\|null}` (records bindings by EIP index; compatible with legacy `{instanceNodeId:index}`) |
| SecurityGroup   | cloud    | `name`, `rules[]`                                  |
| Instance        | cloud    | `name`, `count`(count; >1 means multiple instances of the same type, exported as Terraform `count`), `gpu`(deploy GPU instance, switches type/image to the GPU catalog), `gpuDriver`(none/nvidia), `gpuDriverVersion`, `imageId`, `instanceType`, `chargeType`(subscription/payAsYouGo/spot), `privateIp`, `loginType`(keyPair/password), `keyPair`, `password`, `systemDisk{type,size}`, `dataDisks[{type,size}]` |
| LoadBalancer    | cloud    | `name`, `internal`, `rules[{protocol, port, backends[], healthCheck{enabled,protocol,method,path,body,port,interval,timeout,healthyThreshold,unhealthyThreshold}}]` (each rule = listener + backend instance ids + health check), `lbConfig{type, ipVersion, scheduler, spec, internetChargeType, bandwidth, edition, addressAllocatedMode, stickySession, connectionDrain, crossZone, preserveClientIp, proxyProtocol, serverFailoverMode, geneveProtocol}` (Alibaba Cloud/Tencent Cloud load-balancer type and advanced options) |
| RouteTable      | cloud    | `name`, `routes[]`                                 |
| Interconnect    | cloud    | `name` (VPC peering, connects multiple VPCs)       |
| KeyPair         | cloud    | `name`, `mode`(create/existing) (login key pair, bound to an instance) |

### Edge

- `NODE_TYPES`' `label` / `fields[].label` / `summary` keys / `CONNECTION_RULES[].label`
  are all i18n keys, translated in components with `t()` (literal options such as `Geneve`/`VXLAN` are returned as-is).
- Connection rules are in `CONNECTION_RULES`, validated by `canConnect(sourceType, targetType)`.
- A "zone" = a connected component formed by compute Hosts connected via Host↔Host tunnels (Hosts marked "control node" are excluded),
  computed by `computeZones(nodes, edges)`; a `LogicalSwitch → Host` connection means the switch is deployed to that zone,
  and `LogicalSwitch → Cluster` means deployed to all nodes in that cluster (zone); external switches (`isExternal`) additionally generate a localnet port.
- `VM → LogicalSwitch` means attaching a logical port; `VM → Host` means deploying that VM (netns) to that host.
  On export, the control node sets `requested-chassis=<hostname>` for the port and generates
  `ip netns` + veth + `ovs-vsctl add-port br-int` (with `external_ids:iface-id` matching the logical port) in the target host's script.
  If a VM is deployed on the control node, the netns commands are written into the central script with a comment that the chassis is not registered.
- When multiple compute Hosts are tunnel-interconnected, `recomputeClusters()` in `designer.js` auto-merges them into
  a `Cluster` group node (Vue Flow parent/child); a `VPC → Cluster` connection means the VPC is deployed to that cluster.
  Deleting the Cluster node dissolves the grouping (removes the internal tunnel connections and restores hosts' absolute positions).
  `Cluster → Host(control node)` means the cluster joins the control plane (the arrow points to the control node; equivalent to all compute nodes in the cluster joining);
  an individual compute Host can also connect directly to the control node. On export, only joined compute nodes write `ovn-remote` and run `chassis-add`.
  The canvas minimap is Teleported to the right side of the bottom message bar (`#page-minimap`, same width as the inspector, 288px) so it does not cover canvas nodes.
- `handles: { source, target }` in `NODE_TYPES` controls the number of handles on the left/right sides of a node (default 2/2;
  Host is 4/8, VM is 4/2, KeyPair is 2/4, Interconnect is 1/8; to support many-to-one intake, VPC/Subnet are 8/2,
  Gateway/LoadBalancer are 2/8, Instance is 4/4); node types with `hidden: true` do not appear in the left palette.
- Canvas scrollbars `CanvasScrollbars` (a `VueFlow` slot child sharing the same instance as the canvas):
  the content area is the bounding box of all nodes plus margins; dragging the horizontal/vertical slider calls `setViewport` to pan,
  and the sliders update as the canvas is dragged/zoomed; when the content does not overflow, the slider fills the track (`axisGeo` computes the geometry).
- Clicking an edge deletes it: `onEdgeClick` in `App.vue` → `removeEdge` (deleting a Host↔Host tunnel edge recomputes clusters);
  edges enlarge their clickable hit area via `interactionWidth` and CSS, and highlight in the warning color on hover as feedback.
- Feedback when connection validation fails: for illegal (`canConnect` returns empty) or duplicate connections, `onConnect`
  writes a hint via `pushMessage` into the bottom message area `MessagePanel` (`messages` in `App.vue`),
  with targeted suggestions (reversed direction, ECS must connect to a subnet, generic connection-rule explanation); disallowed connections are not created.

### Vendor

- The toolbar's "Link existing instances" opens `ImportInventoryDialog`: after choosing the current vendor's region it requests `GET /api/inventory/:vendor/:region` (frontend `store/inventory.js`; the URL reuses `VITE_CATALOG_API_URL` with `{kind}=inventory`, or `VITE_INVENTORY_API_URL`) and lays out the returned VPC/subnet/instance/security group/EIP/NAT/key pair/route table/load balancer and relationships onto the canvas via `inventoryLayout.js`. If the canvas is not empty it asks to confirm overwriting first. Imported nodes carry `data.existing` + `data.cloudId` and show an "existing" badge; by default on Terraform export, `existingDataBlocks` in `common.js` generates read-only data sources per vendor, new-resource loops skip these nodes, and references go through data. In mock mode it returns a sample topology for credential-free integration testing.
  - **Adopting existing resources (import then destroy via Terraform)**: the "Adopt existing resources" toggle in `ExportModal` (shown only when the canvas has `existing` nodes, off by default) calls `exportTerraform` with `adoptExisting=true`. Then `ref` in `createCloudContext` routes existing resources through `resource` references, each vendor exporter includes these nodes in its new-resource loops to emit `resource` blocks (existing security groups/route tables/NAT gateways/load balancers/EIPs no longer rebuild their rules, routes, SNAT, listeners or bindings), and `existingImportBlocks` emits `import.tf` (`import { to = <resource address>, id = <cloudId> }`, requires Terraform >= 1.5). Workflow: `terraform init` → `terraform plan` (if required fields are missing, remove the matching `resource` block and use `terraform plan -generate-config-out=generated.tf`) → `terraform apply` to import into state → `terraform destroy` to delete. apply may adjust real resources to match the config, so review the plan first. Security groups imported from inventory carry `data.vpcId`, and `createCloudContext.findVpc` falls back to that ID to resolve their VPC when there is no edge.
- The toolbar selects the cloud vendor: `aliyun` / `tencent` / `aws` / `huawei`, stored in `store/vendor.js` and persisted to localStorage.
- The toolbar's "Provider version" input corresponds to the current vendor and is written as the main provider's `version` constraint
  in `provider.tf` (e.g. `~> 5.0` / `>= 1.200.0`); each vendor's version is stored independently in `providerVersions` of `store/vendor.js`,
  falling back to `DEFAULT_PROVIDER_VERSIONS` in `vendors.js` when blank. Helper providers like `tls` / `local` keep fixed versions.
  The arrow on the right of the input opens a custom dropdown `components/ProviderVersionSelect.vue` (not a native `datalist`:
  native suggestions filter by the typed text, and a constraint like `~> 1.60` would match almost no version). The dropdown always lists all published versions
  and supports search; picking one generates a `~> major.minor` constraint (e.g. `1.98.2` → `~> 1.98`), and you can also type any constraint manually.
  Candidates come from `store/providerVersions.js` (build-time env var `VITE_PROVIDER_VERSIONS_URL`,
  which supports a `{vendor}` placeholder; when unset/failing, only manual input is available): the server's `GET /api/providerVersions[/:vendor]`
  pulls from the Terraform Registry and caches by `cache_ttl`; with `mock: true` it returns built-in sample versions;
  `server.registry_url` can point to a private registry.
- Cloud resource nodes' display names and badges vary by vendor (`nodeLabelKey` / `nodeBadge` in `vendors.js`):
  i18n `nodes.vpc` / `nodes.subnet` / `nodes.instance` etc. are objects grouped by vendor.
- When switching vendor (`Toolbar` emits `change-vendor`, `App.vue`'s `onVendorChange`), besides label/badge changes,
  `retargetCloudNodeData(type, data, vendor)` in `vendors.js` migrates the vendor-related config of existing cloud nodes on the canvas:
  if the current value is still valid among the new vendor's candidates (e.g. region/zone/image/type/charge type/disk type) it is kept, otherwise it is replaced with the new vendor's default
  (`VPC.region`, `Subnet.zone`, `Instance.imageId`/`instanceType`/`chargeType`/`systemDisk`/`dataDisks`; when `gpu` is enabled, image/type migrate against the GPU catalog).
- Terraform export dispatches per vendor (`export/terraform/index.js`); OVN export is vendor-independent.
- A VPC's "region" is chosen from a dropdown in `regions.js` for the current vendor; the default provider region for Terraform export comes from the first VPC's `region`.
- An Instance's "charge type" is chosen from a dropdown in `chargeTypes.js` for the current vendor (subscription/pay-as-you-go/spot);
  on export it maps to vendor fields (e.g. Alibaba Cloud `instance_charge_type` + `spot_strategy`, Tencent Cloud `instance_charge_type`, Huawei Cloud `charging_mode`, AWS `instance_market_options`).
- A standalone `Eip` node represents a public IP; an `Eip → Instance` connection associates it with that instance, exported as the vendor's association resource
  (`alicloud_eip_association` / `tencentcloud_eip_association` / `huaweicloud_compute_eip_associate` / `aws_eip_association`).
- An `Eip`'s "count" `data.count` has the same semantics as `Instance`: when >1 the EIP resource is exported with `count` and the name becomes a prefix
  (`name-index`, `eipNameExpr`); references use `eipRef` with an index. `eipInstanceCandidates` in `common.js` expands directly connected instances
  (multiple instances expanded in order) into `instanceName-index (private IP)` candidates; `eipBindings(eip, candidates)` normalizes each EIP's binding:
  the new format `Eip.data.bindings = { index: {id,index} | null }`: missing keys fall back to the candidate in the same position (connected means bound),
  and `null` means explicitly unbound (an object map survives JSON serialization); it is compatible with the legacy `{instanceNodeId:index}` and the earlier array format;
  in `NodeEditorDialog`'s "EIP binding instances" section you pick per EIP row by row. When EIP count >1, bindings to a NAT gateway's
  egress are all expanded (Alibaba Cloud one association per EIP, Tencent Cloud `assigned_eip_set`, Huawei Cloud SNAT `floating_ip_id` list;
  AWS `aws_nat_gateway` only takes the 0th).
- An `Instance`'s "count" `data.count` means multiple instances of the same type: when >1 the instance resource is exported with `count`,
  the node name becomes a "name prefix" (shown on canvas as `name-*`, and the editor label becomes "name prefix"), and instance names are exported as
  `name-index` (`instanceNameExpr`, index starting at 1); resource references carry an index
  (`instanceCount` / `isCountedInstance` / `instanceRef` in `common.js`);
  private IPs are allocated in subnet CIDR order by `instancePrivateIp` (`cidrhost(cidr, offset + count.index)`,
  omitted when it cannot be computed, leaving it to the cloud platform). References such as load-balancer backends, per-instance gateway SNAT and per-instance EIP bindings
  expand by count, and "available after creation" attributes output all via the `[*]` splat.
- A `Gateway` node represents a NAT gateway, used for "multiple ECS sharing one EIP egress": `Eip → Gateway` binds the public egress,
  and the source can be `VPC → Gateway` (whole VPC), `Subnet → Gateway` (per subnet) or `Instance → Gateway` (per instance),
  which together with a `RouteTable` route `0.0.0.0/0 → NatGateway` lets multiple ECS SNAT out to the internet through one EIP. On export:
  - EIP bound to a gateway: Alibaba Cloud `alicloud_eip_association` (`instance_type = "Nat"`),
    Tencent Cloud `tencentcloud_nat_gateway.assigned_eip_set`, Huawei Cloud SNAT rule `floating_ip_id`, AWS `aws_nat_gateway.allocation_id`;
  - SNAT sources are natively supported or downgraded per vendor capability (`GATEWAY_SOURCE_SUPPORT` in `common.js`):
    subnet → Alibaba Cloud `alicloud_snat_entry`(source_vswitch_id), Tencent Cloud `tencentcloud_nat_gateway_snat`(SUBNET),
    Huawei Cloud `huaweicloud_nat_snat_rule`; VPC → Alibaba Cloud uses `source_cidr` (native), Tencent/Huawei downgrade to each subnet in the VPC;
    instance → Tencent Cloud uses `NETWORKINTERFACE` (native), Alibaba/Huawei downgrade to the instance's subnet, AWS is unsupported (NAT is subnet-level; warning only).
  - `gatewayEips` in `common.js` prefers `Eip → Gateway` connections, falling back to EIPs not bound to an instance when not connected;
    `gatewaySnatSources` returns the VPC/subnet/instance attached to the gateway, and `vpcSubnets` returns the subnets under a VPC;
    `validateGatewaySources` generates downgrade warnings (shown as warnings in the export dialog).
- A `LoadBalancer` node represents a load balancer: it accepts `Instance/Subnet/VPC → LoadBalancer`, and `internal` controls intranet/public.
  Each rule in `data.rules` = a listener (`protocol` + `port`) + a list of backend instance ids; the editor uses the `TransferBox` to choose backends,
  with candidates from `lbBackendCandidates` in `common.js` (directly connected ECS + all ECS within an attached subnet/VPC).
  Each listener rule also carries `healthCheck` (`lbHealthCheck` in `common.js` normalizes it and falls back to defaults; legacy designs are compatible):
  `enabled`, `protocol` (tcp/http/https), `method` (HTTP(S) request method, GET/HEAD/POST),
  `path` (HTTP(S) check path), `body` (HTTP(S) request body), `port` (blank uses the backend port),
  `interval`/`timeout` (seconds), `healthyThreshold`/`unhealthyThreshold`. `method` is shown in the editor only when the check protocol is http/https;
  export maps by vendor capability (Alibaba Cloud SLB `health_check_method` only head/get, Tencent Cloud CLB `health_check_http_method` only GET/HEAD,
  Huawei Cloud ELB `http_method` supports GET/HEAD/POST, AWS target group has no method field); `body` has no corresponding field in any vendor's Terraform resource,
  and on export `validateLoadBalancers` generates an ignore warning (a `method` beyond vendor support is also warned).
  Export is generated per vendor: Alibaba Cloud `alicloud_slb_load_balancer` + `alicloud_slb_server_group` + `alicloud_slb_listener` (`health_check_*`) +
  `alicloud_slb_server_group_server_attachment`; Tencent Cloud `tencentcloud_clb_instance` + `tencentcloud_clb_listener` (`health_check_*`) +
  `tencentcloud_clb_attachment`; Huawei Cloud `huaweicloud_elb_loadbalancer` + `huaweicloud_elb_listener` +
  `huaweicloud_elb_pool` + `huaweicloud_elb_member` + `huaweicloud_elb_monitor`; AWS `aws_lb` (application for HTTP/HTTPS, otherwise network) +
  `aws_lb_target_group` (`health_check` block, always enabled in AWS) + `aws_lb_listener` + `aws_lb_target_group_attachment`.
  `lbSubnets`/`lbVpc` determine the deployment subnet and VPC; `validateLoadBalancers` generates warnings for a missing network or missing backends.
- A `LoadBalancer`'s `data.lbConfig` supports **per-vendor load balancer type and advanced options** (Alibaba Cloud/Tencent Cloud only; other vendors keep a single type):
  - `type`: Alibaba Cloud `clb`/`alb`/`nlb`/`gwlb`, Tencent Cloud `clb`/`gwlb`/`alb` (`clb` is the default, compatible with legacy designs).
  - Advanced options: CLB spec/billing/bandwidth (Alibaba Cloud), ALB edition/address-allocated mode/sticky session, NLB cross-zone/preserve client IP/Proxy Protocol,
    GWLB failover mode (Alibaba Cloud)/GENEVE protocol (Tencent Cloud), plus common IP version and scheduler; listener protocols and health-check protocols adapt to the type.
  - Alibaba Cloud export dispatches per type (`aliyun.js`): `clb` → `alicloud_slb_*`; `alb` → `alicloud_alb_load_balancer` (`zone_mappings`≥2, `load_balancer_billing_config`) +
    `alicloud_alb_server_group` (inline `servers` + `health_check_config`) + `alicloud_alb_listener` (`default_actions`);
    `nlb` → `alicloud_nlb_load_balancer` (`load_balancer_type="Network"`, `zone_mappings`) + `alicloud_nlb_server_group` (`health_check`) +
    `alicloud_nlb_listener` + `alicloud_nlb_server_group_server_attachment`; `gwlb` → `alicloud_gwlb_load_balancer` (`zone_mappings`≥1) +
    `alicloud_gwlb_server_group` (`protocol="GENEVE"`, inline `servers`) + `alicloud_gwlb_listener`.
    Zone mappings are derived from an attached subnet's `vswitch_id` + `Subnet.data.zone` (`aliyunLbZoneMappings`).
  - Tencent Cloud export dispatches per type (`tencent.js`): `clb` → `tencentcloud_clb_*`; `gwlb` → `tencentcloud_gwlb_instance` +
    `tencentcloud_gwlb_target_group` (`protocol=TENCENT_GENEVE/AWS_GENEVE`, probe port 6081) + `tencentcloud_gwlb_target_group_register_instances` +
    `tencentcloud_gwlb_instance_associate_target_group`; `alb` is skipped on export with a warning (`lbAlbUnsupported`) because the Tencent Cloud Terraform Provider has no ALB resource yet.
  - Validation: `validateLoadBalancers` checks the number of zones by vendor type (Alibaba Cloud ALB/NLB≥2, GWLB≥1), whether listener protocols apply to the type,
    the provider version required by Alibaba Cloud GWLB (≥1.234), and that Tencent Cloud ALB is not exportable; the editor's type selector is shown only for Alibaba Cloud/Tencent Cloud.
- An Instance can check "Deploy GPU instance": the type/image dropdowns switch to the GPU catalog (`instanceTypeCatalog` / `instanceImageOptions` in `catalog.js`),
  and the editor shows the GPU model/count/memory (from the type entry) and driver install (`gpuDriver`/`gpuDriverVersion`);
  choosing to install the NVIDIA driver writes the instance `user_data` on export (`user_data_raw` for Tencent Cloud). When unchecked, GPU types/images are excluded.
- An Instance's "Image" and "Instance type" are "dropdown + free input" controls (a `combo` field: `select` lists all candidates plus a "Custom..." item,
  which shows a text box when selected; if the current value is not in the candidate list it automatically switches to custom). The catalogs come from `store/catalog.js`:
  based on the local built-in lists in `images.js` / `instanceTypes.js`, merged with online catalogs by `value` (online wins on duplicates).
  Online sources are injected via build-time env vars: `VITE_CATALOG_URL` (remote JSON) takes priority, then `VITE_CATALOG_API_URL`
  (vendor API proxy, supporting `{vendor}` / `{kind}` / `{region}` placeholders); see `.env.example`; on fetch failure it falls back to local automatically.
  The proxy service is in `server/` (Go + Gin): `GET /api/:kind/:vendor[/:region]` signs with the vendor AK/SK and calls
  `DescribeImages` / `DescribeInstanceTypes` (Tencent Cloud also returns per-zone stock `zones`; Alibaba Cloud/AWS/Huawei Cloud drop types that are out of stock in the current region);
  `kind` can also be `gpuImages` / `gpuInstanceTypes`, filtering GPU types and related images from the full catalog
  (entries carry `gpu` / `gpuSpec` / `gpuCount` / `gpuMemoryGiB`); vendors without configured keys return 501;
  config such as keys lives in `server/config.yaml` (YAML, overridable by env vars), with `server/config.example.yaml` as an example,
  and `mock: true` for credential-free integration testing.
- A type entry may carry `zones` (the full list of zone IDs where the type is in stock; absent means no restriction); `catalog.js` keeps it during normalization
  and exports `instanceTypeZones(vendor, type, region)`; `instanceTypeCatalog(vendor, gpu, region)` removes
  types unavailable/out of stock in the current VPC region (they do not enter the editor dropdown). When the URL contains `{region}` it fetches and caches by the canvas VPC region.
  The local `instanceTypes.js` annotates `ap-guangzhou-5/6/7` only for the Tencent Cloud SA3 series as an example; real stock comes from online catalogs.
- A Tencent Cloud CVM must be in the same zone as its subnet, so the "stock" constraint applies to `Subnet.zone` (the deployment zone),
  and the check is uniformly provided by `validateInstanceZones(nodes, edges, vendor, zonesOf)` in `common.js` (returned items include `subnetId`, `sameRegion`):
  - When connecting `Subnet → Instance`, `App.vue`'s `onConnect` validates immediately and shows a lightweight toast,
    with a "switch subnet to a zone" quick action;
  - When editing a `Subnet`, the "zone stock" section lists instances whose type is out of stock in that subnet and offers a one-click switch-zone button;
  - When editing an `Instance`, if its type is not in stock in the owning subnet's zone, a similar hint is shown;
  - On export it is summarized as a warning (without affecting the Terraform content).
- An Instance's "system disk/data disk" are configured in the editor: the system disk type is chosen from a dropdown in `disks.js` per vendor, in GiB;
  data disks are an add/remove list. On export it maps to vendor fields (Alibaba Cloud `system_disk_category` + `data_disks`,
  Tencent Cloud/Huawei Cloud `system_disk_type` + `data_disks`, AWS `root_block_device` + `ebs_block_device`).
- An `Interconnect` node represents VPC peering: `VPC → Interconnect` can connect multiple VPCs; on export it generates pairwise fully-meshed peerings
  (`alicloud_vpc_peer_connection` / `tencentcloud_vpc_peering_connection` / `aws_vpc_peering_connection` /
  `huaweicloud_vpc_peering_connection`) and auto-adds a route entry to the peering in each attached VPC's existing `RouteTable`.
- Cloud resource nodes can check "available after creation" attributes (resource ID; Eip/Instance also have public IP), stored in `data.outputs`:
  the options come from `data/outputs.js` (mapping read-only attribute names per vendor), checked in the "Export outputs" section of `NodeEditorDialog`.
  On export, `buildOutputs` in `export/terraform/outputs.js` generates the `output` blocks and appends `output.tf` in multi-file exports;
  with nothing checked, that file is not generated.
- A `KeyPair` node represents a login key pair: the connection rule is `KeyPair → Instance` (meaning bind; `common.js` and the editor also accept
  the legacy `Instance → KeyPair` direction); `mode='create'` creates it via Terraform
  (`*_key_pair` resource; Tencent Cloud/AWS/Huawei Cloud include `tls_private_key` and a `.pem` private key file, Alibaba Cloud uses `key_file`),
  `mode='existing'` references an existing cloud key pair (Alibaba Cloud/AWS/Huawei Cloud reference by name; Tencent Cloud, since instances use `key_ids`, generates
  `data "tencentcloud_key_pairs"` to look up the ID by name). When an instance is connected to a KeyPair node, the editor forces the login method to "key pair"
  (hides the password field) and shows the KeyPair node's name read-only in the inline "login key pair" field (the key name is the node name);
  export prefers the node; when not connected it falls back to the inline `keyPair` (compatible with legacy designs), and password login is unaffected.
- Node property editing is done in the `NodeEditorDialog`: opened by double-clicking a node or clicking "Edit" in the right panel;
  `Inspector` only shows a read-only summary and edit/delete buttons.
- The built-in demo topologies are defined in `data/demo.js`: `DEMOS` provides multiple demos by key (`basic`, `loadbalancer`),
  `DEMO_LIST` is the toolbar dropdown order, and `createDemoDesign(key)` returns a deep copy of the demo (defaults to `basic`);
  on first visit (no locally saved design) `basic` loads automatically, and the toolbar "Load demo" dropdown switches demos (confirming first if the canvas is not empty);
  edge labels are resolved in the current language on load. Demo names go through i18n's `toolbar.demo_<key>`.

### OVN Export (split by execution node)

- `exportOvn(nodes, edges)` returns `{ targets, all }`:
  - `targets` = commands split by execution location: `central` (control node, ovn-nbctl/ovn-sbctl, plus netns deployed on the control node) +
    each compute `Host` (ovs-vsctl encapsulation commands + netns/veth deployed on that node), each with its own `content` and `filename`;
    additionally a `gateway-ha` script (physical link health probing, see below) for each "gateway chassis host".
  - `all` = the complete merged script `{ content, filename }` (excluding the `gateway-ha` daemon script).
- The control node section covers: `ls-add`; for external switches it additionally generates `lsp-add <ls> <ls>-localnet` + `lsp-set-type localnet`
  + `lsp-set-options network_name=<name>` + `lsp-set-addresses unknown`; `lr-add`; `lrp-add`/`lsp-add`
  (external port uses `externalIp/externalMac`, internal port uses the subnet gateway; port MACs are globally unique, planned centrally by `routerPortPlan()`);
  `lr-nat-add` (snat/dnat_and_snat); `lrp-set-gateway-chassis` (multiple gateways + priorities); `ovn-nbctl set-connection ptcp:6641`
  / `ovn-sbctl set-connection ptcp:6642`. It no longer outputs `ovn-sbctl chassis-add` (ovn-controller registers automatically).
- The compute node section covers: ovn-remote/system-id/encap config; for external NICs it creates the external bridge (`add-br` / attach the physical NIC to the bridge / migrate IP / `link set up`)
  and `external_ids:ovn-bridge-mappings`. The mapping is generated from **each external NIC's own `networkName`** (`<nic.networkName>:<nic.bridge>`, multiple joined by commas),
  bound to an external switch's `networkName` by name equality; br-int, Geneve and netns/veth keep the original behavior. Multiple external networks are supported (different NICs fill different `networkName`s).
- External export HA (FR-6): each gateway chassis host additionally generates `ovn-gateway-ha-<host>.sh`,
  polling the external NIC link state, running `lrp-del-gateway-chassis` on down and `lrp-set-gateway-chassis` to restore on up
  (chassis process loss is switched automatically by OVN; a physical link down needs this script, because OVN does not perceive it).
- `validateOvn(nodes, edges)` returns a list of `{ key, params }`; `showOvn` in `App.vue` translates them with `t()` and shows them in the export dialog's warning area:
  external port without a gateway chassis, only 1 gateway chassis (single point), an external switch's `network_name` having no same-named external NIC on its deployment nodes (no bridge-mappings),
  NAT external IP outside the external subnet, external switch without `unknown`, duplicate router port MAC.
- `ExportModal` receives `groups` (a grouped list); with multiple groups it shows a dropdown to view/download the commands for a given node.

## Key Conventions

1. **Adding a node type**: just add a `NODE_TYPES` entry in `nodeDefinitions.js` + the necessary
   `CONNECTION_RULES` + i18n messages (both zh-CN / en-US).
2. **State management**: `App.vue` calls `createDesigner()` (internally useVueFlow),
   and child components inject via `useDesigner()`; read node/edge data as `nodes.value` / `edges.value`,
   and **do not** use `v-model:nodes`, which would cause nodes to be lost after a click due to two-way binding.
3. **All UI text must go through i18n** (`t('key')`), and new text must be added to both locale files.
4. **Export logic**: everything under `export/` is pure functions, internally using `translate('export.xxx')` to generate multilingual comments;
   to add a cloud vendor, add the corresponding exporter under `export/terraform/` and dispatch it in `index.js`.
5. **Theme (light/dark)**: colors uniformly use the CSS variables in `src/styles/main.css`
   (light in `:root`, dark in `:root[data-theme='dark']`; category colors also have `--ovn/--cloud/--danger` and their
   `-soft/-line` variants, and structural colors include `--edge-line/--overlay/--node-shadow`). The theme is managed by `store/theme.js`
   and written to `<html data-theme>` + localStorage; the `index.html` first-paint script presets it to avoid flashing;
   the sidebar's `Palette.vue` provides a toggle at the bottom. The Vue Flow canvas grid/minimap colors change with the theme via `App.vue` computed properties,
   and edge colors are driven by CSS variables (with `!important` overriding inline styles); do not hardcode dark values in templates.
