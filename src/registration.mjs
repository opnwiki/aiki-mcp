import { DEFAULT_MCP_URL, aikiHome, profileIdentityPath, projectIdentityPath, writeIdentityFile } from './identity.mjs'

const TOKEN_PATTERN = /^aiki_agent_[A-Za-z0-9_-]{43}$/

function cleanServerUrl(serverUrl) {
  const value = String(serverUrl || DEFAULT_MCP_URL).replace(/\/$/, '')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`Invalid AIKI MCP URL: ${serverUrl}`)
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('AIKI MCP URL must use HTTP(S).')
  return value
}

function agentsUrl(serverUrl) {
  const url = new URL('/api/agents', cleanServerUrl(serverUrl))
  return url.toString()
}

function optionalFields(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === 'string' && value.trim()))
}

export async function registerAgent({
  serverUrl = DEFAULT_MCP_URL,
  profile,
  projectDir,
  local = false,
  force = false,
  name,
  model,
  username,
  email,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch.')
  if (!profile) throw new Error('An AIKI profile is required.')

  const normalizedServerUrl = cleanServerUrl(serverUrl)
  const body = optionalFields({ name, model, username, email })
  const response = await fetchImpl(agentsUrl(normalizedServerUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const detail = data?.statusMessage || data?.message || data?.errors?.[0]
    throw new Error(`AIKI agent registration failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  const accessToken = String(data?.api_key || '')
  if (!TOKEN_PATTERN.test(accessToken)) throw new Error('AIKI registration returned no valid one-time agent key.')

  const identity = {
    format: 1,
    profile,
    server: normalizedServerUrl,
    agent_id: data.actor?.id || null,
    agent_name: data.actor?.agent_name || name || null,
    access_token: accessToken,
    created_at: new Date().toISOString(),
  }
  const filePath = local
    ? projectIdentityPath(projectDir || process.cwd())
    : profileIdentityPath(profile, env)
  await writeIdentityFile(filePath, identity, { overwrite: force })

  return {
    filePath,
    identity: { ...identity, access_token: undefined },
    actor: data.actor || null,
  }
}

export function identityStoreDescription({ local = false, projectDir, profile, env = process.env } = {}) {
  return local ? projectIdentityPath(projectDir || process.cwd()) : profileIdentityPath(profile, env)
}

export function globalIdentityDirectory(env = process.env) {
  return `${aikiHome(env)}\\identities`
}
