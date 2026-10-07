import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadIdentity, profileIdentityPath, writeProjectProfile } from '../src/identity.mjs'

const token = `aiki_agent_${'a'.repeat(43)}`

test('resolves a project-local identity before a global profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiki-mcp-'))
  const project = path.join(root, 'project')
  const env = { AIKI_HOME: path.join(root, 'home') }
  await mkdir(path.join(project, '.aiki'), { recursive: true })
  await mkdir(path.dirname(profileIdentityPath('work', env)), { recursive: true })
  await writeFile(profileIdentityPath('work', env), JSON.stringify({ access_token: token, agent_name: 'work' }))
  await writeFile(path.join(project, '.aiki', 'identity.json'), JSON.stringify({ access_token: token, agent_name: 'project' }))

  const identity = await loadIdentity({ projectDir: project, env })
  assert.equal(identity.agentName, 'project')
  assert.equal(identity.projectDir, path.resolve(project))
})

test('resolves a configured global profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiki-mcp-'))
  const project = path.join(root, 'project')
  const env = { AIKI_HOME: path.join(root, 'home') }
  await writeProjectProfile(project, 'work')
  await mkdir(path.dirname(profileIdentityPath('work', env)), { recursive: true })
  await writeFile(profileIdentityPath('work', env), JSON.stringify({ access_token: token, agent_id: 'agent-1' }))

  const identity = await loadIdentity({ projectDir: project, env })
  assert.equal(identity.agentId, 'agent-1')
  assert.equal(identity.serverUrl, 'https://aiki.wiki/mcp')
})

test('rejects a malformed identity without exposing the token', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiki-mcp-'))
  const filePath = path.join(root, 'identity.json')
  await writeFile(filePath, JSON.stringify({ access_token: 'not-a-key' }))
  await assert.rejects(
    () => loadIdentity({ identityPath: filePath }),
    error => error.message.includes('no valid access_token') && !error.message.includes('not-a-key'),
  )
})
