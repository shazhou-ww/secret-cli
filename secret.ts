#!/usr/bin/env bun
// @oc-forge/secret - Infisical secret management CLI with local caching
// Usage: secret <command> [args]

// ─── Colors ────────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function ok(msg: string) {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}
function info(msg: string) {
  console.log(`${c.cyan}ℹ${c.reset} ${msg}`);
}
function warn(msg: string) {
  console.log(`${c.yellow}⚠${c.reset} ${msg}`);
}
function fail(msg: string) {
  console.error(`${c.red}✗${c.reset} ${msg}`);
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

const HOME = Bun.env.HOME || "~";
const CONFIG_DIR = `${HOME}/.config/openclaw-fleet`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;
const CACHE_PATH = `${CONFIG_DIR}/cache.json`;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Config {
  clientId: string;
  clientSecret: string;
  projectId: string;
  env: string;
  ttlMs: number;
}

interface CacheEntry {
  value: string;
  updatedAt: number;
}

interface Cache {
  secrets: Record<string, CacheEntry>;
  lastSync: number;
  ttlMs: number;
}

// ─── Config ────────────────────────────────────────────────────────────────────

async function loadConfig(): Promise<Config> {
  let fileConfig: Partial<Config> = {};

  const configFile = Bun.file(CONFIG_PATH);
  if (await configFile.exists()) {
    try {
      fileConfig = await configFile.json();
    } catch {
      warn("config.json is malformed, using env vars only");
    }
  }

  const clientId =
    Bun.env.INFISICAL_CLIENT_ID || fileConfig.clientId || "";
  const clientSecret =
    Bun.env.INFISICAL_CLIENT_SECRET || fileConfig.clientSecret || "";
  const projectId =
    Bun.env.INFISICAL_PROJECT_ID ||
    fileConfig.projectId ||
    "";
  const env = Bun.env.INFISICAL_ENV || fileConfig.env || "dev";
  const ttlMs = fileConfig.ttlMs || 86400000; // 24h

  if (!clientId || !clientSecret) {
    fail(
      "Missing Infisical credentials. Set INFISICAL_CLIENT_ID/INFISICAL_CLIENT_SECRET or add them to config.json"
    );
    process.exit(1);
  }

  if (!projectId) {
    fail(
      "Missing Infisical project ID. Set INFISICAL_PROJECT_ID or add projectId to config.json"
    );
    process.exit(1);
  }

  return { clientId, clientSecret, projectId, env, ttlMs };
}

// ─── Cache ─────────────────────────────────────────────────────────────────────

async function loadCache(): Promise<Cache> {
  const cacheFile = Bun.file(CACHE_PATH);
  if (await cacheFile.exists()) {
    try {
      const data = await cacheFile.json();
      if (data && typeof data.secrets === "object") {
        return data as Cache;
      }
    } catch {
      warn("Cache file corrupted, starting fresh");
    }
  }
  return { secrets: {}, lastSync: 0, ttlMs: 86400000 };
}

async function saveCache(cache: Cache): Promise<void> {
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
  // Set file permissions to 600
  const proc = Bun.spawn(["chmod", "600", CACHE_PATH]);
  await proc.exited;
}

function isCacheValid(entry: CacheEntry, ttlMs: number): boolean {
  return Date.now() - entry.updatedAt < ttlMs;
}

// ─── Infisical API ─────────────────────────────────────────────────────────────

const API_BASE = "https://app.infisical.com/api";

async function authenticate(config: Config): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/auth/universal-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      fail("Authentication failed — check your clientId/clientSecret");
    } else {
      fail(`Auth request failed (${res.status}): ${body}`);
    }
    process.exit(1);
  }

  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

async function fetchAllSecrets(
  token: string,
  config: Config
): Promise<Array<{ secretKey: string; secretValue: string }>> {
  const url = `${API_BASE}/v3/secrets/raw?environment=${encodeURIComponent(config.env)}&workspaceId=${encodeURIComponent(config.projectId)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    fail(`Failed to fetch secrets (${res.status}): ${body}`);
    process.exit(1);
  }

  const data = (await res.json()) as {
    secrets: Array<{ secretKey: string; secretValue: string }>;
  };
  return data.secrets;
}

async function fetchOneSecret(
  token: string,
  config: Config,
  key: string
): Promise<string> {
  const url = `${API_BASE}/v3/secrets/raw/${encodeURIComponent(key)}?environment=${encodeURIComponent(config.env)}&workspaceId=${encodeURIComponent(config.projectId)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) {
      fail(`Secret "${key}" not found`);
    } else {
      const body = await res.text();
      fail(`Failed to fetch secret (${res.status}): ${body}`);
    }
    process.exit(1);
  }

  const data = (await res.json()) as {
    secret: { secretKey: string; secretValue: string };
  };
  return data.secret.secretValue;
}

async function upsertSecret(
  token: string,
  config: Config,
  key: string,
  value: string
): Promise<void> {
  // Try PATCH first (update existing)
  const patchUrl = `${API_BASE}/v3/secrets/raw/${encodeURIComponent(key)}`;
  const body = JSON.stringify({
    workspaceId: config.projectId,
    environment: config.env,
    secretValue: value,
    type: "shared",
  });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers,
    body,
  });

  if (patchRes.ok) return;

  // If PATCH fails (404 = doesn't exist), try POST to create
  if (patchRes.status === 400 || patchRes.status === 404) {
    const postRes = await fetch(`${API_BASE}/v3/secrets/raw/${encodeURIComponent(key)}`, {
      method: "POST",
      headers,
      body,
    });

    if (!postRes.ok) {
      const errBody = await postRes.text();
      fail(`Failed to create secret (${postRes.status}): ${errBody}`);
      process.exit(1);
    }
    return;
  }

  const errBody = await patchRes.text();
  fail(`Failed to update secret (${patchRes.status}): ${errBody}`);
  process.exit(1);
}

// ─── Commands ──────────────────────────────────────────────────────────────────

async function cmdGet(key: string, fresh: boolean) {
  const config = await loadConfig();
  const cache = await loadCache();

  // Check cache first (unless --fresh)
  if (!fresh && cache.secrets[key] && isCacheValid(cache.secrets[key], config.ttlMs)) {
    const val = cache.secrets[key].value;
    console.log(val);
    info(`${c.dim}(from cache)${c.reset}`);
    return;
  }

  // Fetch from Infisical
  const token = await authenticate(config);
  const value = await fetchOneSecret(token, config, key);

  // Update cache
  cache.secrets[key] = { value, updatedAt: Date.now() };
  cache.ttlMs = config.ttlMs;
  await saveCache(cache);

  console.log(value);
  info(`${c.dim}(from Infisical)${c.reset}`);
}

async function cmdSet(key: string, value: string) {
  const config = await loadConfig();
  const token = await authenticate(config);

  await upsertSecret(token, config, key, value);

  // Update cache
  const cache = await loadCache();
  cache.secrets[key] = { value, updatedAt: Date.now() };
  cache.ttlMs = config.ttlMs;
  await saveCache(cache);

  ok(`Set ${c.bold}${key}${c.reset} ✓`);
}

async function cmdList(showValues: boolean) {
  const config = await loadConfig();
  const token = await authenticate(config);
  const secrets = await fetchAllSecrets(token, config);

  if (secrets.length === 0) {
    warn("No secrets found");
    return;
  }

  // Sort by key
  secrets.sort((a, b) => a.secretKey.localeCompare(b.secretKey));

  console.log(
    `\n${c.bold}${c.cyan}Secrets${c.reset} ${c.dim}(${secrets.length} total, env: ${config.env})${c.reset}\n`
  );

  const maxKeyLen = Math.max(...secrets.map((s) => s.secretKey.length));

  for (const s of secrets) {
    const key = s.secretKey.padEnd(maxKeyLen);
    if (showValues) {
      console.log(`  ${c.green}${key}${c.reset}  ${c.dim}=${c.reset}  ${s.secretValue}`);
    } else {
      console.log(`  ${c.green}${key}${c.reset}`);
    }
  }
  console.log();
}

async function cmdSync() {
  const config = await loadConfig();
  const token = await authenticate(config);
  const secrets = await fetchAllSecrets(token, config);

  const cache: Cache = {
    secrets: {},
    lastSync: Date.now(),
    ttlMs: config.ttlMs,
  };

  for (const s of secrets) {
    cache.secrets[s.secretKey] = {
      value: s.secretValue,
      updatedAt: Date.now(),
    };
  }

  await saveCache(cache);
  ok(`Synced ${c.bold}${secrets.length}${c.reset} secrets to cache`);
}

async function cmdExec(args: string[]) {
  if (args.length === 0) {
    fail("Usage: secret exec -- <command> [args...]");
    process.exit(1);
  }

  const config = await loadConfig();
  const cache = await loadCache();

  // Check if cache is fresh enough, otherwise sync
  const hasValidCache =
    Object.keys(cache.secrets).length > 0 &&
    Date.now() - cache.lastSync < config.ttlMs;

  let secrets: Record<string, string>;

  if (hasValidCache) {
    secrets = Object.fromEntries(
      Object.entries(cache.secrets).map(([k, v]) => [k, v.value])
    );
    info(`${c.dim}Using cached secrets${c.reset}`);
  } else {
    // Fetch fresh
    const token = await authenticate(config);
    const fetched = await fetchAllSecrets(token, config);

    secrets = Object.fromEntries(
      fetched.map((s) => [s.secretKey, s.secretValue])
    );

    // Update cache
    const newCache: Cache = {
      secrets: {},
      lastSync: Date.now(),
      ttlMs: config.ttlMs,
    };
    for (const s of fetched) {
      newCache.secrets[s.secretKey] = {
        value: s.secretValue,
        updatedAt: Date.now(),
      };
    }
    await saveCache(newCache);
    info(`${c.dim}Synced ${fetched.length} secrets${c.reset}`);
  }

  // Merge secrets into env and exec
  const env = { ...Bun.env, ...secrets };

  const proc = Bun.spawn(args, {
    env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
${c.bold}${c.cyan}@oc-forge/secret${c.reset} — Infisical secret manager with local caching

${c.bold}Usage:${c.reset}
  secret get <KEY> [--fresh]     Get a secret value (cache-first)
  secret set <KEY> <VALUE>       Set/update a secret
  secret list [--show]           List all secret keys
  secret sync                    Sync all secrets to local cache
  secret exec -- <cmd> [args]    Run command with secrets as env vars

${c.bold}Config:${c.reset}
  ${c.dim}~/.config/openclaw-fleet/config.json${c.reset}
  ${c.dim}or INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET / INFISICAL_PROJECT_ID env vars${c.reset}
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  try {
    switch (command) {
      case "get": {
        const key = args[1];
        if (!key) {
          fail("Usage: secret get <KEY> [--fresh]");
          process.exit(1);
        }
        const fresh = args.includes("--fresh");
        await cmdGet(key, fresh);
        break;
      }

      case "set": {
        const key = args[1];
        const value = args[2];
        if (!key || value === undefined) {
          fail("Usage: secret set <KEY> <VALUE>");
          process.exit(1);
        }
        await cmdSet(key, value);
        break;
      }

      case "list": {
        const showValues = args.includes("--show");
        await cmdList(showValues);
        break;
      }

      case "sync": {
        await cmdSync();
        break;
      }

      case "exec": {
        // Find "--" separator
        const dashIdx = args.indexOf("--");
        const cmdArgs = dashIdx >= 0 ? args.slice(dashIdx + 1) : args.slice(1);
        await cmdExec(cmdArgs);
        break;
      }

      case "help":
      case "--help":
      case "-h": {
        printUsage();
        break;
      }

      default:
        fail(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err: unknown) {
    if (err instanceof TypeError && String(err).includes("fetch")) {
      fail("Network error — check your internet connection");
      process.exit(1);
    }
    if (err instanceof Error) {
      fail(err.message);
    } else {
      fail(String(err));
    }
    process.exit(1);
  }
}

main();
