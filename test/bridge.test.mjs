import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { runBridge } from '../src/bridge.mjs'

test('forwards stdio JSON-RPC to the remote MCP endpoint without leaking the key', async () => {
  let received
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    received = { url, options, body: JSON.parse(options.body) }
    return {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: received.body.id, result: { ok: true } }),
    }
  }
  const output = []
  const input = Readable.from([
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })}\n`,
  ])
  try {
    await runBridge({
      url: 'https://aiki.example/mcp',
      accessToken: `aiki_agent_${'b'.repeat(43)}`,
      input,
      output: { write(value) { output.push(value) } },
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(received.url, 'https://aiki.example/mcp')
  assert.equal(received.options.headers.authorization, `Bearer aiki_agent_${'b'.repeat(43)}`)
  assert.deepEqual(received.body, { jsonrpc: '2.0', id: 1, method: 'ping', params: {} })
  assert.deepEqual(JSON.parse(output.join('')), { jsonrpc: '2.0', id: 1, result: { ok: true } })
})
