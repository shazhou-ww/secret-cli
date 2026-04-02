# @oc-forge/secret

**Infisical secret management CLI with local caching — for OpenClaw teams**

一个用于管理 [Infisical](https://infisical.com) secrets 的命令行工具，带本地缓存，专为 OpenClaw 团队设计。

---

## 安装 / Installation

需要 [Bun](https://bun.sh) runtime（v1.0+）。

```bash
npm i -g @oc-forge/secret
# 或
bun add -g @oc-forge/secret
```

安装后即可使用 `secret` 命令。

---

## 配置 / Configuration

### 方式一：配置文件（推荐）

创建 `~/.config/openclaw-fleet/config.json`：

```json
{
  "clientId": "your-machine-identity-client-id",
  "clientSecret": "your-machine-identity-client-secret",
  "projectId": "your-infisical-project-id",
  "env": "dev"
}
```

### 方式二：环境变量

```bash
export INFISICAL_CLIENT_ID="your-client-id"
export INFISICAL_CLIENT_SECRET="your-client-secret"
export INFISICAL_PROJECT_ID="your-project-id"
export INFISICAL_ENV="dev"  # 可选，默认 dev
```

> ⚠️ 不要将实际凭证提交到代码仓库。

---

## 命令 / Commands

```bash
# 获取 secret（优先读取缓存）
secret get <KEY>
secret get <KEY> --fresh        # 强制从 Infisical 拉取最新值

# 设置 / 更新 secret
secret set <KEY> <VALUE>

# 列出所有 secret keys
secret list
secret list --show              # 同时显示值

# 全量同步到本地缓存
secret sync

# 注入所有 secrets 为环境变量并运行命令
secret exec -- <command> [args...]

# 帮助
secret --help
```

### 示例 / Examples

```bash
# 获取数据库密码
secret get DATABASE_URL

# 设置 API key
secret set OPENAI_API_KEY sk-...

# 注入 secrets 运行应用
secret exec -- node server.js

# 同步所有 secrets 到缓存
secret sync
```

---

## 缓存 / Caching

- 缓存文件：`~/.config/openclaw-fleet/cache.json`（权限 600）
- 默认 TTL：24 小时
- `secret get` 自动使用缓存；`secret exec` 在缓存过期时自动同步
- 可在 config.json 中设置 `ttlMs` 自定义缓存时长

---

## 认证方式 / Authentication

使用 Infisical [Universal Auth (Machine Identity)](https://infisical.com/docs/documentation/platform/identities/universal-auth) 认证。

配置步骤：
1. 在 Infisical 控制台创建 Machine Identity
2. 授予项目访问权限
3. 将 `clientId` 和 `clientSecret` 填入配置文件

---

## License

MIT © 小橘 🍊
