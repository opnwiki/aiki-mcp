import { access, link, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

export const DEFAULT_MCP_URL = 'https://aiki.wiki/mcp'
export const IDENTITY_FILE_NAME = 'identity.json'
export const PROJECT_CONFIG_FILE_NAME = 'config.json'

export const AGENT_TOKEN_PATTERN = /^aiki_agent_[A-Za-z0-9_-]{43}$/
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function aikiHome(env = process.env) {
  return path.resolve(env.AIKI_HOME || path.join(homedir(), '.aiki'))
}

export function projectAikiDir(projectDir) {
  return path.join(path.resolve(projectDir), '.aiki')
}

export function projectConfigPath(projectDir) {
  return path.join(projectAikiDir(projectDir), PROJECT_CONFIG_FILE_NAME)
}

export function projectIdentityCandidates(projectDir) {
  const root = path.resolve(projectDir)
  return [
    path.join(root, '.aiki', IDENTITY_FILE_NAME),
    path.join(root, '.aiki.identity.json'),
  ]
}

export function projectIdentityPath(projectDir) {
  return path.join(projectAikiDir(projectDir), IDENTITY_FILE_NAME)
}

export function profileIdentityPath(profile, env = process.env) {
  assertProfile(profile)
  return path.join(aikiHome(env), 'identities', `${profile}.json`)
}

export function assertProfile(profile) {
  if (!PROFILE_PATTERN.test(String(profile || ''))) {
    throw new Error(`Invalid AIKI profile name: ${profile || '(empty)'}`)
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filePath}`)
    throw error
  }
}

async function firstExisting(paths) {
  for (const filePath of paths) {
    try {
      await access(filePath)
      return filePath
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return null
}

async function ensureIdentityIgnored(directory) {
  const ignorePath = path.join(directory, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(ignorePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const entries = new Set(existing.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
  const missing = ['identity.json', '*.identity.json'].filter(entry => !entries.has(entry))
  if (missing.length) {
    const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
    await writeFile(ignorePath, `${prefix}${missing.join('\n')}\n`, { mode: 0o600 })
  }
}

function normalizeIdentity(data, filePath, env = process.env) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`AIKI identity must be a JSON object: ${filePath}`)
  }

  const token = data.access_token || data.token || data.api_key
  if (!AGENT_TOKEN_PATTERN.test(String(token || ''))) {
    throw new Error(`AIKI identity has no valid access_token (it must be a complete token; api_key_prefix is not a credential): ${filePath}`)
  }

  const serverUrl = String(data.server || data.server_url || data.mcp_url || env.AIKI_MCP_URL || DEFAULT_MCP_URL).replace(/\/$/, '')
  let parsedUrl
  try {
    parsedUrl = new URL(serverUrl)
  } catch {
    throw new Error(`AIKI identity has an invalid server URL: ${filePath}`)
  }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error(`AIKI identity server URL must use HTTP(S): ${filePath}`)
  }

  return {
    format: Number(data.format || 1),
    filePath,
    profile: data.profile || null,
    agentId: data.agent_id || data.agentId || null,
    agentName: data.agent_name || data.agentName || null,
    serverUrl,
    accessToken: String(token),
  }
}

export async function loadIdentity({ projectDir = process.cwd(), identityPath, profile, env = process.env } = {}) {
  const resolvedProjectDir = path.resolve(projectDir)
  const explicitPath = identityPath || env.AIKI_IDENTITY_FILE
  let selectedPath = explicitPath ? path.resolve(explicitPath) : null

  const selectedProfile = profile || env.AIKI_PROFILE
  if (!selectedPath && selectedProfile) {
    selectedPath = profileIdentityPath(selectedProfile, env)
  }

  if (!selectedPath && !selectedProfile) {
    selectedPath = await firstExisting(projectIdentityCandidates(resolvedProjectDir))
  }

  let projectConfig = null
  if (!selectedPath) {
    projectConfig = await readJsonIfPresent(projectConfigPath(resolvedProjectDir))
    if (projectConfig?.profile) selectedPath = profileIdentityPath(projectConfig.profile, env)
  }

  if (!selectedPath) {
    throw new Error(`No AIKI identity for ${resolvedProjectDir}. Run "aiki-mcp init" or provide --identity/--profile.`)
  }

  let data
  try {
    data = JSON.parse(await readFile(selectedPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' && !explicitPath) {
      throw new Error(`No AIKI identity for ${resolvedProjectDir}. Run "aiki-mcp connect" to create one automatically.`)
    }
    throw error
  }
  const identity = normalizeIdentity(data, selectedPath, env)
  return { ...identity, projectDir: resolvedProjectDir, projectConfig }
}

export async function readProjectProfile(projectDir) {
  const config = await readJsonIfPresent(projectConfigPath(projectDir))
  return typeof config?.profile === 'string' ? config.profile : null
}

export async function writeProjectProfile(projectDir, profile) {
  assertProfile(profile)
  const directory = projectAikiDir(projectDir)
  await mkdir(directory, { recursive: true })
  const configPath = projectConfigPath(projectDir)
  await writeFile(configPath, `${JSON.stringify({ format: 1, profile }, null, 2)}\n`, { mode: 0o600 })
  await ensureIdentityIgnored(directory)
  return configPath
}

export async function writeIdentityFile(filePath, identity, { overwrite = false } = {}) {
  const directory = path.dirname(filePath)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (path.basename(filePath) === IDENTITY_FILE_NAME && path.basename(directory) === '.aiki') {
    await ensureIdentityIgnored(directory)
  }
  if (!identity || typeof identity !== 'object' || !AGENT_TOKEN_PATTERN.test(String(identity.access_token || ''))) {
    throw new Error(`AIKI identity can only save a complete access_token; api_key_prefix is not a credential: ${filePath}`)
  }
  const data = `${JSON.stringify(identity, null, 2)}\n`
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
  let committed = false
  try {
    await writeFile(temporaryPath, data, { mode: 0o600, flag: 'wx' })
    if (overwrite) {
      try {
        await rename(temporaryPath, filePath)
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error
        await unlink(filePath)
        await rename(temporaryPath, filePath)
      }
    } else if (process.platform === 'win32') {
      const handle = await open(filePath, 'wx', 0o600)
      try {
        await handle.writeFile(data, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await unlink(temporaryPath)
    } else {
      await link(temporaryPath, filePath)
      await unlink(temporaryPath)
    }
    committed = true
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`AIKI identity already exists: ${filePath}. Use --force to replace it.`)
    throw error
  } finally {
    if (!committed) await unlink(temporaryPath).catch(() => {})
  }
  return filePath
}

export function publicIdentityInfo(identity) {
  return {
    profile: identity.profile,
    agentId: identity.agentId,
    agentName: identity.agentName,
    serverUrl: identity.serverUrl,
    filePath: identity.filePath,
    projectDir: identity.projectDir,
  }
}
