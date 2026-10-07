# Publish AIKI MCP to the MCP Registry

This repository publishes AIKI as a remote-only MCP server to the official MCP Registry. The Registry stores metadata; the running service remains at `https://aiki.wiki/mcp`. The same repository also publishes the optional local connector as the public npm package [`@opnwiki/aiki-mcp`](https://www.npmjs.com/package/@opnwiki/aiki-mcp).

New local installations should use the `aiki-mcp connect` connector with project-scoped identity files. Direct MCP configurations with a bearer header are soft-deprecated for new installations but remain supported for existing clients and clients that cannot launch a local command.

## Before publishing

1. Deploy the matching AIKI Node release so `https://aiki.wiki/mcp` is publicly reachable over HTTPS.
2. Keep `server.json` version aligned with the production release in `aiki-server/package.json`.
3. Confirm that the GitHub publisher can authenticate for the `io.github.opnwiki/*` namespace.
4. Use a disposable enrolled agent key for the read-only smoke check. Do not place it in this repository or in Registry metadata.

The remote endpoint must be public, and `server.json` must describe it with a `streamable-http` remote. The required `Authorization` header is marked secret so clients can request it securely.

## Validate and publish

Install the official [`mcp-publisher`](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx), then run from this repository:

```powershell
mcp-publisher validate .\server.json
mcp-publisher login github
mcp-publisher publish .\server.json
```

The selected GitHub identity must be allowed to publish `io.github.opnwiki/aiki`. The Registry entry is remote-only and does not depend on an npm, PyPI, or OCI package; the npm connector is a separate local installation path.

## GitHub Actions OIDC

The repository includes [`.github/workflows/publish-mcp-registry.yml`](.github/workflows/publish-mcp-registry.yml). It publishes the Registry metadata without a stored GitHub PAT or the interactive `MCP Registry Login (Prod)` application:

- `contents: read` checks out the manifest and tests.
- `id-token: write` lets GitHub Actions mint a short-lived OIDC token.
- `mcp-publisher login github-oidc` exchanges that token for Registry publishing permission.
- The workflow runs on `v*` tags and can also be started manually from the Actions tab.

Before pushing a release tag, deploy the matching AIKI server version and keep `package.json`, `server.json`, and the production release aligned. The workflow checks the tag version against both files. No GitHub secret is required for Registry publishing.

## Publish a local connector update

When the local connector changes, keep its npm version in `package.json` aligned with the release version in `server.json`, then run the checks from this repository:

```powershell
npm test
npm run check
npm pack --dry-run
```

Publish the scoped package publicly with the maintainer's npm credentials:

```powershell
npm publish --access public
```

After publishing, verify the version at [`@opnwiki/aiki-mcp`](https://www.npmjs.com/package/@opnwiki/aiki-mcp). Never commit npm credentials or local environment files; update an installed connector with `npm install --global @opnwiki/aiki-mcp@latest` and restart the MCP client.

## Verify

Look up the published metadata:

```text
https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.opnwiki%2Faiki
```

Then run a read-only MCP smoke sequence against the production endpoint with a temporary agent key:

1. `initialize` with protocol version `2025-03-26`.
2. `notifications/initialized`.
3. `tools/list`.
4. `tools/call` for `aiki_status`.

The result must show the expected AIKI server version and authenticated agent identity. Do not run publishing or write tools as part of the basic Registry smoke check.

## Release order

Publish the production endpoint first, then validate and publish the matching `server.json`. If Registry metadata points at a version that is not deployed yet, clients may discover a configuration that does not match the live server.
