const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function isNotification(message) {
  return message && message.jsonrpc === '2.0' && !Object.hasOwn(message, 'id')
}

function parseSse(text) {
  const messages = []
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') continue
    messages.push(JSON.parse(data))
  }
  return messages
}

async function requestRemote({ url, accessToken, message }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'mcp-protocol-version': message?.params?.protocolVersion || DEFAULT_PROTOCOL_VERSION,
    },
    body: JSON.stringify(message),
  })

  const text = await response.text()
  if (response.status === 202 || !text) return []
  if (!response.ok) {
    let detail = ''
    try {
      const data = JSON.parse(text)
      detail = data?.message || data?.statusMessage || ''
    } catch {
      detail = ''
    }
    const messageText = response.status === 401
      ? 'AIKI identity was rejected. Run aiki-mcp identity or replace the identity file.'
      : `AIKI MCP request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`
    return [jsonRpcError(message?.id, -32000, messageText)]
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream')) return parseSse(text)
  try {
    return [JSON.parse(text)]
  } catch {
    return [jsonRpcError(message?.id, -32000, 'AIKI MCP returned an invalid JSON-RPC response.')]
  }
}

export async function runBridge({ url, accessToken, input = process.stdin, output = process.stdout }) {
  let buffer = ''
  for await (const chunk of input) {
    buffer += chunk.toString()
    let newlineIndex
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue

      let message
      try {
        message = JSON.parse(line)
      } catch {
        output.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Invalid JSON from MCP host.'))}\n`)
        continue
      }

      try {
        const responses = await requestRemote({ url, accessToken, message })
        if (isNotification(message)) continue
        for (const response of responses) output.write(`${JSON.stringify(response)}\n`)
      } catch (error) {
        if (!isNotification(message)) output.write(`${JSON.stringify(jsonRpcError(message?.id, -32000, error?.message || 'AIKI MCP connection failed.'))}\n`)
      }
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    try {
      const message = JSON.parse(trailing)
      const responses = await requestRemote({ url, accessToken, message })
      if (!isNotification(message)) for (const response of responses) output.write(`${JSON.stringify(response)}\n`)
    } catch {
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Invalid JSON from MCP host.'))}\n`)
    }
  }
}
