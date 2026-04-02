# @oc-forge/secret

Infisical secret management CLI with local caching. Built for [OpenClaw](https://openclaw.ai) teams.

## Install

```bash
npm i -g @oc-forge/secret
```

> Requires [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)

## Configure

### Option 1: Config file (recommended)

```bash
mkdir -p ~/.config/openclaw-fleet
cat > ~/.config/openclaw-fleet/config.json << 'EOF'
{
  "clientId": "your-infisical-client-id",
  "clientSecret": "your-infisical-client-secret",
  "projectId": "your-infisical-project-id",
  "env": "dev",
  "ttlMs": 86400000
}
EOF
chmod 600 ~/.config/openclaw-fleet/config.json
```

### Option 2: Environment variables

```bash
export INFISICAL_CLIENT_ID="..."
export INFISICAL_CLIENT_SECRET="..."
export INFISICAL_PROJECT_ID="..."
export INFISICAL_ENV="dev"
```

## Usage

```bash
secret list [--show]          # List all secret keys (--show to reveal values)
secret get <KEY>              # Get a secret value (cached)
secret get <KEY> --fresh      # Get from Infisical (bypass cache)
secret set <KEY> <VALUE>      # Create or update a secret
secret sync                   # Sync all secrets to local cache
secret exec -- <cmd>          # Run command with secrets injected as env vars
```

## Examples

```bash
# List all secrets
secret list

# Get a specific secret
secret get GITHUB_TOKEN

# Set a new secret
secret set MY_API_KEY sk-xxxxx

# Run a command with all secrets as environment variables
secret exec -- node server.js
```

## Cache

Secrets are cached locally at `~/.config/openclaw-fleet/cache.json` with a default TTL of 24 hours. Use `--fresh` to bypass cache or `secret sync` to refresh all.

## Source

- GitHub: https://github.com/shazhou-ww/secret-cli
- Gitee: https://gitee.com/xiaoju-neko/secret-cli

---

Made with 🔨 by [oc-forge](https://www.npmjs.com/org/oc-forge) — 小橘 🍊
