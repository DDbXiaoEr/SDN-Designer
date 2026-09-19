# OVN-Designer 在线清单服务

[English](./README.en.md) | 中文

Go + Gin 实现的云厂商清单代理：按地域拉取**镜像**与**实例规格**（腾讯云额外返回有货可用区），
以规范化 JSON 返回给前端，供 `src/store/catalog.js` 通过 `VITE_CATALOG_API_URL` 使用。

## 为什么需要后端

各大云厂商 OpenAPI 都需要 AK/SK 签名（腾讯 TC3、阿里 RPC、AWS SigV4、华为 SDK-HMAC），
浏览器直连既有 CORS 限制又有密钥泄露风险，因此由本服务代为签名调用并归一化。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 健康检查，返回已启用的厂商 |
| GET | `/api/vendors` | 支持的厂商与 kind |
| GET | `/api/:kind/:vendor` | 使用厂商默认地域，或用 `?region=` 指定 |
| GET | `/api/:kind/:vendor/:region` | 指定地域 |
| GET | `/api/providerVersions` | 各厂商 Terraform provider 已发布版本（从 Registry 拉取） |
| GET | `/api/providerVersions/:vendor` | 单个厂商的已发布版本 |

- `kind`：`images` 或 `instanceTypes`
- `vendor`：`tencent` / `aliyun` / `aws` / `huawei`

响应：

```json
{
  "vendor": "tencent",
  "kind": "instanceTypes",
  "region": "ap-guangzhou",
  "items": [
    { "value": "SA3.MEDIUM4", "label": "SA3.MEDIUM4 (2 vCPU / 4 GiB)",
      "zones": ["ap-guangzhou-5", "ap-guangzhou-6", "ap-guangzhou-7"] }
  ]
}
```

`zones` 为该规格有货的可用区（完整 AZ ID），缺省表示不限制，可直接对接前端的可用区库存校验。

provider 版本响应（`source` 为 `registry` 或 `mock`，`versions` 按版本号从新到旧排序）：

```json
{
  "vendor": "aliyun",
  "source": "registry",
  "versions": ["1.220.0", "1.219.0", "1.218.0"]
}
```

- 厂商 → Registry provider 地址：`aliyun`→`aliyun/alicloud`、`tencent`→`tencentcloudstack/tencentcloud`、
  `aws`→`hashicorp/aws`、`huawei`→`huaweicloud/huaweicloud`。
- 无需云厂商凭证，结果按 `cache_ttl` 缓存；`mock: true` 时返回内置示例版本，不访问外网。

## 配置

配置来自 **YAML 文件**：复制 `config.example.yaml` 为 `config.yaml` 填写即可（`config.yaml` 已被忽略，不会入库）。
默认读取当前目录的 `config.yaml`，可用 `-config=/path/to/xxx.yaml` 或 `CONFIG_FILE` 指定其它路径；
文件不存在时使用内置默认值。

```yaml
server:
  port: "8080"
  cache_ttl: 10m          # 结果缓存时长，0 表示不缓存
  request_timeout: 20s    # 调用厂商 API 超时
  cors_allowed_origins: ["*"]
  registry_url: "https://registry.terraform.io"  # Terraform Registry，可指向私有镜像
  mock: false             # true 时所有厂商返回示例数据，便于无凭证联调

vendors:
  tencent: { enabled: true, access_key: "", secret_key: "" }              # SecretId / SecretKey
  aliyun:  { enabled: true, access_key: "", secret_key: "" }              # AccessKeyId / AccessKeySecret
  aws:     { enabled: true, access_key: "", secret_key: "" }              # AccessKeyId / SecretAccessKey
  huawei:  { enabled: true, access_key: "", secret_key: "", project_id: "" } # AK / SK / 项目 ID
```

环境变量可**覆盖** YAML 中的对应项（便于容器/CI 注入密钥）：

| 环境变量 | 对应配置 |
| --- | --- |
| `CONFIG_FILE` / `-config` | 配置文件路径 |
| `PORT` / `CACHE_TTL` / `REQUEST_TIMEOUT` | `server.*` |
| `CORS_ALLOWED_ORIGINS` / `REGISTRY_URL` / `MOCK` | `server.*` |
| `TENCENT_ENABLED` / `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | `vendors.tencent` |
| `ALIYUN_ENABLED` / `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | `vendors.aliyun` |
| `AWS_ENABLED` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `vendors.aws` |
| `HUAWEI_ENABLED` / `HUAWEI_ACCESS_KEY` / `HUAWEI_SECRET_KEY` / `HUAWEI_PROJECT_ID` | `vendors.huawei` |

未配置密钥（或显式 `enabled: false`）的厂商不会注册，接口返回 `501`，前端自动回退本地清单。
建议使用**只读**子账号。

## 运行

```bash
cd server
go run .                         # 使用 config.yaml
go run . -config config.local.yaml
go run . -config config.example.yaml   # mock: true 时无需凭证联调
go build -o server . && ./server
```

## 对接前端

在项目根目录 `.env` 中配置（`{kind}` 会被替换为 `images` / `instanceTypes`）：

```
VITE_CATALOG_API_URL=http://localhost:8080/api/{kind}/{vendor}
VITE_PROVIDER_VERSIONS_URL=http://localhost:8080/api/providerVersions/{vendor}
```

未指定地域时使用厂商默认地域；要按 VPC 地域拉取，前端需在模板中加入 `{region}`（后续接入）。
`VITE_PROVIDER_VERSIONS_URL` 用于工具栏「Provider 版本」下拉的候选（`{vendor}` 占位符可选）；
下拉始终列出全部版本并支持搜索，选中后生成 `~> 主.次` 约束（仍可手动输入任意约束）。

## 版本说明

各厂商实现基于官方 Go SDK：`tencentcloud-sdk-go`、`alibabacloud-go/ecs-20140526`、
`aws-sdk-go-v2/service/ec2`、`huaweicloud-sdk-go-v3`。华为云镜像来自 IMS、规格来自 ECS。
