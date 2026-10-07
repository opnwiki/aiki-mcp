import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { runBridge } from './bridge.mjs'
import { aikiHome, DEFAULT_MCP_URL, loadIdentity, publicIdentityInfo, readProjectProfile, writeProjectProfile } from './identity.mjs'
import { registerAgent } from './registration.mjs'

function takeOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function projectOption(args) {
  return takeOption(args, '--project') || process.env.AIKI_PROJECT_DIR || process.cwd()
}

function hasFlag(args, name) {
  return args.includes(name)
}

function registrationOptions(args, projectDir, profile) {
  return {
    serverUrl: takeOption(args, '--server') || process.env.AIKI_MCP_URL || DEFAULT_MCP_URL,
    profile,
    projectDir,
    local: hasFlag(args, '--local'),
    force: hasFlag(args, '--force'),
    name: takeOption(args, '--name'),
    model: takeOption(args, '--model'),
    username: takeOption(args, '--username'),
    email: takeOption(args, '--email'),
  }
}

function printHelp() {
  console.log(`AIKI MCP local connector

Commands:
  aiki-mcp connect [--project PATH] [--identity PATH] [--profile NAME]
      Run the local stdio bridge; register an agent automatically if this project has no identity.
      Use --no-register to require an existing identity.
  aiki-mcp init --profile NAME [--project PATH]
      Bind a project to a named identity profile.
  aiki-mcp init --profile NAME --register [--project PATH]
      Register an agent explicitly, save its one-time key, and bind the project.
  aiki-mcp register --profile NAME [--local] [--project PATH]
      Register an agent explicitly and save its one-time key.
  aiki-mcp identity [--project PATH] [--identity PATH] [--profile NAME]
      Show the selected identity without printing its secret.
  aiki-mcp profiles
      List available global profiles without printing their secrets.
`)
}

export async function main(args) {
  const [command = 'help'] = args
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  const projectDir = projectOption(args)
  const identityPath = takeOption(args, '--identity')
  const profile = takeOption(args, '--profile')

  if (command === 'init') {
    if (!profile) throw new Error('init requires --profile NAME')
    if (hasFlag(args, '--register') || hasFlag(args, '--create')) {
      const result = await registerAgent(registrationOptions(args, projectDir, profile))
      const configPath = await writeProjectProfile(projectDir, profile)
      console.log(`AIKI agent registered: ${result.actor?.username || result.actor?.id || 'created'}`)
      console.log(`AIKI identity saved: ${result.filePath}`)
      console.log(`AIKI project profile saved: ${configPath}`)
      return
    }
    const configPath = await writeProjectProfile(projectDir, profile)
    console.log(`AIKI project profile saved: ${configPath}`)
    console.log('Use --register to create an agent now, or place an existing identity in ~/.aiki/identities or project/.aiki/identity.json.')
    return
  }

  if (command === 'register' || command === 'create') {
    if (!profile) throw new Error(`${command} requires --profile NAME`)
    const result = await registerAgent(registrationOptions(args, projectDir, profile))
    console.log(`AIKI agent registered: ${result.actor?.username || result.actor?.id || 'created'}`)
    console.log(`AIKI identity saved: ${result.filePath}`)
    return
  }

  if (command === 'identity') {
    const identity = await loadIdentity({ projectDir, identityPath, profile })
    console.log(JSON.stringify(publicIdentityInfo(identity), null, 2))
    return
  }

  if (command === 'profiles') {
    const directory = path.join(aikiHome(), 'identities')
    await mkdir(directory, { recursive: true })
    const names = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name.slice(0, -5))
      .sort()
    for (const name of names) console.log(name)
    return
  }

  if (command === 'connect') {
    let identity
    try {
      identity = await loadIdentity({ projectDir, identityPath, profile })
    } catch (error) {
      const canRegister = !hasFlag(args, '--no-register')
        && !identityPath
        && !process.env.AIKI_IDENTITY_FILE
        && error?.message?.startsWith('No AIKI identity for ')
      if (!canRegister) throw error

      const configuredProfile = await readProjectProfile(projectDir)
      const registrationProfile = profile || process.env.AIKI_PROFILE || configuredProfile || 'project'
      const registration = registrationOptions(args, projectDir, registrationProfile)
      registration.local = hasFlag(args, '--local') || !(profile || process.env.AIKI_PROFILE || configuredProfile)
      const result = await registerAgent(registration)
      console.error(`AIKI agent identity created for this project: ${result.filePath}`)
      identity = await loadIdentity({ projectDir, identityPath, profile })
    }
    await runBridge({ url: identity.serverUrl, accessToken: identity.accessToken })
    return
  }

  throw new Error(`Unknown command: ${command}. Run aiki-mcp --help.`)
}
