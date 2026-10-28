import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadIdentity, writeIdentityFile } from '../src/identity.mjs'
import { registerAgent } from '../src/registration.mjs'

const token = `aiki_agent_${'c'.repeat(43)}`

test('registers an agent and stores the returned one-time key without printing it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiki-mcp-'))
  const env = { AIKI_HOME: path.join(root, 'home') }
  let request
  const result = await registerAgent({
    serverUrl: 'https://aiki.example/mcp',
    profile: 'work',
    env,
    name: 'Test agent',
    model: 'Test model',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return {
        status: 201,
        ok: true,
        text: async () => JSON.stringify({
          actor: { id: 'agent-1', username: 'test-agent', agent_name: 'Test agent' },
          api_key: token,
        }),
      }
    },
  })

  assert.equal(request.url, 'https://aiki.example/api/agents')
  assert.deepEqual(JSON.parse(request.options.body), { name: 'Test agent', model: 'Test model' })
  assert.equal(result.identity.access_token, undefined)
  const stored = JSON.parse(await readFile(result.filePath, 'utf8'))
  assert.equal(stored.access_token, token)

  const identity = await loadIdentity({ profile: 'work', env })
  assert.equal(identity.agentId, 'agent-1')
  assert.equal(identity.serverUrl, 'https://aiki.example/mcp')
})

test('can store an identity inside the project directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiki-mcp-'))
  const project = path.join(root, 'project')
  const result = await registerAgent({
    serverUrl: 'https://aiki.example/mcp',
    profile: 'local',
    projectDir: project,
    local: true,
    fetchImpl: async () => ({
      status: 201,
      ok: true,
      text: async () => JSON.stringify({ actor: { id: 'agent-local' }, api_key: token }),
    }),
  })

  assert.equal(result.filePath, path.join(project, '.aiki', 'identity.json'))
  const identity = await loadIdentity({ projectDir: project })
  assert.equal(identity.agentId, 'agent-local')
  assert.match(await readFile(path.join(project, '.aiki', '.gitignore'), 'utf8'), /identity\.json/)
})

test('downloads a complete key when registration only returns a prefix', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiki-mcp-'))
  const env = { AIKI_HOME: path.join(root, 'home') }
  let calls = 0
  const result = await registerAgent({
    serverUrl: 'https://aiki.example/mcp',
    profile: 'recovery',
    env,
    fetchImpl: async (url) => {
      calls += 1
      if (calls === 1) return { status: 201, ok: true, text: async () => JSON.stringify({ actor: { id: 'agent-recovered' }, api_key: 'aiki_agent_abcdefgh' , recovery_url: 'https://aiki.example/api/agent-key-recovery/token' }) }
      assert.equal(url, 'https://aiki.example/api/agent-key-recovery/token')
      return { status: 200, ok: true, text: async () => `${token}\n` }
    },
  })
  assert.equal(calls, 2)
  assert.equal(JSON.parse(await readFile(result.filePath, 'utf8')).access_token, token)
})

test('refuses to save a prefix and preserves the existing identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiki-mcp-'))
  const filePath = path.join(root, '.aiki', 'identity.json')
  await writeIdentityFile(filePath, { format: 1, access_token: token, server: 'https://aiki.example/mcp' })
  await assert.rejects(
    writeIdentityFile(filePath, { format: 1, access_token: 'aiki_agent_abcdefgh' }, { overwrite: true }),
    /complete access_token/,
  )
  assert.equal(JSON.parse(await readFile(filePath, 'utf8')).access_token, token)
})
