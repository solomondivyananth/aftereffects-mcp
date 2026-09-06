# Build context for MCP directory indexers (Glama et al).
#
# The MCP server is a thin stdio bridge to an Adobe CEP panel running inside
# After Effects on macOS, so a Linux container can never reach a real host.
# It can still start and answer introspection — tools/list is served entirely
# from the server, without touching the bridge — which is what indexers check.
# Actual tool calls will report that After Effects is unreachable.

FROM node:20-alpine

WORKDIR /app
COPY mcp/ ./mcp/
COPY package.json README.md LICENSE ./

ENTRYPOINT ["node", "mcp/ae-mcp.js"]
