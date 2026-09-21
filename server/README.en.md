# OVN-Designer Online Catalog Service

English | [中文](./README.md)

A Go + Gin cloud vendor catalog proxy: fetches **images** and **instance types** by region
(including GPU instance types and related images; Tencent Cloud additionally returns the zones
in stock), normalizes them into JSON and returns them to the frontend, where
`src/store/catalog.js` consumes them via `VITE_CATALOG_API_URL`.

## Why a backend is needed

Every cloud vendor's OpenAPI requires AK/SK signing (Tencent TC3, Alibaba RPC, AWS SigV4,
Huawei SDK-HMAC). Calling them directly from the browser is both CORS-restricted and risks
leaking credentials, so this service signs and normalizes the calls on the frontend's behalf.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/healthz` | Health check, returns the enabled vendors |
| GET | `/api/vendors` | Supported vendors and kinds |
| GET | `/api/:kind/:vendor` | Uses the vendor's default region, or specify via `?region=` |
| GET | `/api/:kind/:vendor/:region` | Specify the region |
| GET | `/api/providerVersions` | Published Terraform provider versions per vendor (fetched from the Registry) |
| GET | `/api/providerVersions/:vendor` | Published versions for a single vendor |

- `kind`: `images` / `instanceTypes` (full lists) or `gpuImages` / `gpuInstanceTypes` (GPU-only)
- `vendor`: `tencent` / `aliyun` / `aws` / `huawei`

`gpuImages` / `gpuInstanceTypes` share the cache of the corresponding full list and are filtered
server-side by the `gpu` flag.

Response:

```json
{
  "vendor": "tencent",
  "kind": "instanceTypes",
  "region": "ap-guangzhou",
  "items": [
    { "value": "SA3.MEDIUM4", "label": "SA3.MEDIUM4 (2 vCPU / 4 GiB)",
      "zones": ["ap-guangzhou-5", "ap-guangzhou-6", "ap-guangzhou-7"] },
    { "value": "GN7.2XLARGE32", "label": "GN7.2XLARGE32 (8 vCPU / 32 GiB) [1x NVIDIA T4]",
      "zones": ["ap-guangzhou-3", "ap-guangzhou-6"],
      "gpu": true, "gpuSpec": "NVIDIA T4", "gpuCount": 1 }
  ]
}
```

`zones` lists the zones where the instance type is in stock (full AZ ID); omitted means
unrestricted, and it can be fed directly into the frontend's zone stock validation.
GPU items also carry `gpu` / `gpuSpec` / `gpuCount` / `gpuMemoryGiB` (model, card count, per-GPU
memory in GiB; omitted for non-GPU items).

Provider versions response (`source` is `registry` or `mock`, `versions` sorted from newest to oldest):

```json
{
  "vendor": "aliyun",
  "source": "registry",
  "versions": ["1.220.0", "1.219.0", "1.218.0"]
}
```

- Vendor → Registry provider address: `aliyun`→`aliyun/alicloud`, `tencent`→`tencentcloudstack/tencentcloud`,
  `aws`→`hashicorp/aws`, `huawei`→`huaweicloud/huaweicloud`.
- No cloud credentials required; results are cached per `cache_ttl`; when `mock: true` the built-in
  sample versions are returned without any network access.

## Configuration

Configuration comes from a **YAML file**: copy `config.example.yaml` to `config.yaml` and fill it in
(`config.yaml` is ignored and not committed). By default `config.yaml` in the current directory is
read; use `-config=/path/to/xxx.yaml` or `CONFIG_FILE` to point elsewhere. If the file does not
exist, built-in defaults are used.

```yaml
server:
  port: "8080"
  cache_ttl: 10m          # result cache duration; 0 disables caching
  request_timeout: 20s    # timeout for calling vendor APIs
  cors_allowed_origins: ["*"]
  registry_url: "https://registry.terraform.io"  # Terraform Registry, can point to a private mirror
  mock: false             # when true, all vendors return sample data for credential-free integration

vendors:
  tencent: { enabled: true, access_key: "", secret_key: "" }              # SecretId / SecretKey
  aliyun:  { enabled: true, access_key: "", secret_key: "" }              # AccessKeyId / AccessKeySecret
  aws:     { enabled: true, access_key: "", secret_key: "" }              # AccessKeyId / SecretAccessKey
  huawei:  { enabled: true, access_key: "", secret_key: "", project_id: "" } # AK / SK / Project ID
```

Environment variables can **override** the corresponding YAML entries (convenient for injecting
secrets in containers/CI):

| Environment variable | Config entry |
| --- | --- |
| `CONFIG_FILE` / `-config` | Config file path |
| `PORT` / `CACHE_TTL` / `REQUEST_TIMEOUT` | `server.*` |
| `CORS_ALLOWED_ORIGINS` / `REGISTRY_URL` / `MOCK` | `server.*` |
| `TENCENT_ENABLED` / `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | `vendors.tencent` |
| `ALIYUN_ENABLED` / `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | `vendors.aliyun` |
| `AWS_ENABLED` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `vendors.aws` |
| `HUAWEI_ENABLED` / `HUAWEI_ACCESS_KEY` / `HUAWEI_SECRET_KEY` / `HUAWEI_PROJECT_ID` | `vendors.huawei` |

Vendors without credentials (or with an explicit `enabled: false`) are not registered; their
endpoints return `501` and the frontend automatically falls back to the local catalog.
Using a **read-only** sub-account is recommended.

## Running

```bash
cd server
go run .                         # uses config.yaml
go run . -config config.local.yaml
go run . -config config.example.yaml   # with mock: true, no credentials needed
go build -o server . && ./server
```

## Frontend integration

Configure in the project root's `.env` (`{kind}` is replaced with `images` / `instanceTypes`;
GPU subsets are available as `gpuImages` / `gpuInstanceTypes`):

```
VITE_CATALOG_API_URL=http://localhost:8080/api/{kind}/{vendor}
VITE_PROVIDER_VERSIONS_URL=http://localhost:8080/api/providerVersions/{vendor}
```

If no region is specified, the vendor's default region is used; to fetch by VPC region the
frontend needs to include `{region}` in the template (to be wired up later).
`VITE_PROVIDER_VERSIONS_URL` provides the candidates for the "Provider version" dropdown in the
toolbar (the `{vendor}` placeholder is optional); the dropdown always lists all versions with
search support, and selecting one generates a `~> major.minor` constraint (any constraint can
still be typed manually).

## Version notes

Each vendor implementation is based on the official Go SDK: `tencentcloud-sdk-go`,
`alibabacloud-go/ecs-20140526`, `aws-sdk-go-v2/service/ec2`, `huaweicloud-sdk-go-v3`.
Huawei Cloud images come from IMS and instance types from ECS.
