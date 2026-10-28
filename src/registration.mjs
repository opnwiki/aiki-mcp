import { AGENT_TOKEN_PATTERN, DEFAULT_MCP_URL, aikiHome, profileIdentityPath, projectIdentityPath, writeIdentityFile } from './identity.mjs'

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

  let accessToken = String(data?.api_key || '')
  if (!AGENT_TOKEN_PATTERN.test(accessToken) && data?.recovery_url) {
    accessToken = await downloadRecoveryKey(data.recovery_url, fetchImpl)
  }
  if (!AGENT_TOKEN_PATTERN.test(accessToken)) throw new Error('AIKI registration returned no complete agent key; api_key_prefix is not a credential.')

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

async function downloadRecoveryKey(recoveryUrl, fetchImpl) {
  let url
  try {
    url = new URL(String(recoveryUrl))
  } catch {
    throw new Error('AIKI registration returned an invalid agent key recovery URL.')
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('AIKI agent key recovery URL must use HTTP(S).')
  const response = await fetchImpl(url.toString(), { headers: { accept: 'text/plain' } })
  const token = (await response.text()).trim()
  if (!response.ok || !AGENT_TOKEN_PATTERN.test(token)) throw new Error('AIKI agent key recovery URL did not return a complete agent key.')
  return token
}

export function identityStoreDescription({ local = false, projectDir, profile, env = process.env } = {}) {
  return local ? projectIdentityPath(projectDir || process.cwd()) : profileIdentityPath(profile, env)
}

export function globalIdentityDirectory(env = process.env) {
  return `${aikiHome(env)}\\identities`
}
