import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(await readFile(path.join(root, 'server.json'), 'utf8'))
const remote = manifest.remotes?.[0]
const authorization = remote?.headers?.find(header => header.name === 'Authorization')

function check(condition, message) {
  if (!condition) throw new Error(message)
}

check(manifest.$schema === 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json', 'Unexpected server.json schema')
check(manifest.name === 'io.github.opnwiki/aiki', 'Unexpected Registry server name')
check(manifest.description.length <= 100, 'Registry description must be at most 100 characters')
check(manifest.repository?.url === 'https://github.com/opnwiki/aiki-mcp', 'Repository URL must point to opnwiki/aiki-mcp')
check(manifest.repository?.source === 'github', 'Repository source must be github')
check(manifest.version === '1.1.10', 'Update the manifest version for the next AIKI release')
check(!manifest.packages, 'AIKI must remain remote-only until a standalone package exists')
check(remote?.type === 'streamable-http', 'The remote transport must be streamable-http')
check(remote?.url === 'https://aiki.wiki/mcp', 'Unexpected production MCP URL')
check(authorization?.isRequired === true, 'Authorization header must be required')
check(authorization?.isSecret === true, 'Authorization header must be secret')
check(authorization?.placeholder === 'Bearer aiki_agent_…', 'Unexpected Authorization placeholder')
check(!JSON.stringify(manifest).match(/aiki_agent_[A-Za-z0-9_-]{43}/), 'A real agent key must never be stored in server.json')

console.log(`PASS AIKI MCP Registry manifest ${manifest.name}@${manifest.version}`)
