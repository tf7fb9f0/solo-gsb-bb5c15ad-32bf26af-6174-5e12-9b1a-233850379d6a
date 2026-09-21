# offline-dep-resolver

离线软件包依赖解析 API。基于 **Node.js + Express + node-semver**：输入一个离线 registry（包名 → 版本 → dependencies）和根依赖约束，通过**带回溯的版本求解**生成覆盖全部传递依赖的安装计划；无解时返回从根依赖到首个无候选包的冲突链。

## 快速启动（单条命令）

```bash
docker compose up --build
```

依赖安装（`npm ci --omit=dev`）与初始化均已纳入镜像构建与容器启动流程，无需任何额外步骤。

- **访问地址**：`http://localhost:3000`
- **健康检查**：`http://localhost:3000/health`

本地开发（不用 Docker）：

```bash
npm ci
npm start        # 监听 3000 端口
npm test         # 运行测试
```

## 配置

均通过环境变量配置（见 `docker-compose.yml`），均有默认值，可全部省略：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | API 监听端口（容器内） |
| `MAX_BODY` | `10mb` | `POST /resolve` 请求体大小上限 |
| `RESOLVER_MAX_STEPS` | `200000` | 回溯搜索步数上限（防止病态输入挂死） |

宿主机端口映射在 `docker-compose.yml` 的 `ports` 中调整（默认 `3000:3000`）。

## API

### `POST /resolve`

请求体：

```json
{
  "registry": {
    "<包名>": {
      "<版本>": { "dependencies": { "<包名>": "<semver 范围>" } }
    }
  },
  "root": { "<包名>": "<semver 范围>" }
}
```

**解析规则（完全确定性）**：

1. 每次从待解析包中选取**包名字典序最小**者；
2. 候选版本按 **semver 由高到低**依次尝试，必须同时满足该包上的全部约束；
3. 走不通则**回溯**到最近的选择点换更低版本；
4. 相同输入（包括 JSON 键顺序不同）必然产生相同结果与相同的数组顺序。

**成功（HTTP 200）**——`plan` 按包名字典序排列，`installOrder` 为拓扑安装顺序（依赖先于使用者，同层按字典序）：

```bash
curl -s -X POST http://localhost:3000/resolve \
  -H 'content-type: application/json' \
  -d @examples/resolve-success.json
```

```json
{
  "resolved": true,
  "plan": [
    { "name": "http", "version": "1.3.0", "dependencies": { "util": "^1.0.0" } },
    { "name": "util", "version": "1.1.0", "dependencies": {} },
    { "name": "web",  "version": "2.0.0", "dependencies": { "http": "^1.2.0", "util": "^1.0.0" } }
  ],
  "installOrder": ["util", "http", "web"]
}
```

**无解（HTTP 422）**——返回冲突链：从根约束到**首个无候选版本**的包，沿途列出每个包的选定版本、引入它的约束及来源；`required` 给出冲突包上的全部约束，`available` 给出 registry 中可用版本：

```bash
curl -s -X POST http://localhost:3000/resolve \
  -H 'content-type: application/json' \
  -d @examples/resolve-conflict.json
```

```json
{
  "resolved": false,
  "reason": "no-candidate",
  "conflict": {
    "package": "http",
    "required": [{ "range": "^2.0.0", "source": "web@2.0.0" }],
    "available": ["1.3.0"],
    "chain": [
      { "name": "web",  "version": "2.0.0", "constraint": "^2.0.0", "source": "root" },
      { "name": "http", "version": null,    "constraint": "^2.0.0", "source": "web@2.0.0" }
    ]
  }
}
```

冲突链最后一项 `version: null` 表示该包无任何满足约束的候选版本；`source` 为 `root`（根约束）或 `<包名>@<版本>`（由哪个已选定版本引入）。

**输入非法（HTTP 400）**：返回 `details` 数组逐条说明问题（版本号非法、范围非法、结构缺失等）。JSON 语法错误返回 `{"error":"invalid-json"}`。

### `GET /health`

```json
{ "status": "ok", "service": "offline-dep-resolver", "version": "1.0.0", "uptime": 12.3 }
```

## 项目结构

```
├── server.js            # Express 应用与路由（/resolve、/health）
├── src/
│   ├── resolver.js      # 回溯求解器：字典序选包、版本降序、冲突链生成
│   └── validate.js      # 请求体校验（semver 版本/范围）
├── test/                # node:test 单元与接口测试（npm test）
├── examples/            # 示例请求体（成功 / 冲突）
├── Dockerfile           # 多阶段构建，npm ci 安装依赖，非 root 运行
├── docker-compose.yml   # 单服务编排，含健康检查
└── package-lock.json    # 锁定依赖，保证可复现构建
```
