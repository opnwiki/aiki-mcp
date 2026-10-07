#!/usr/bin/env node

import { main } from '../src/cli.mjs'

try {
  await main(process.argv.slice(2))
} catch (error) {
  console.error(`aiki-mcp: ${error?.message || error}`)
  process.exitCode = error?.exitCode || 1
}
