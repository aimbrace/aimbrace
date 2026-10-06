# http-agent

The agent of [`agent-cli`](../agent-cli) served over HTTP, by **Hono or Fastify with the same plugins**.
Only one line of `src/server.mjs` differs between hosts, and the contract suite in `packages/http`
proves the behaviour is identical.

```sh
pnpm install && pnpm run build            # from the repository root
node examples/http-agent/start.mjs --host hono --port 3000
# or: --host fastify

curl -s localhost:3000/health
curl -s localhost:3000/tools
curl -s -X POST localhost:3000/ask -d '{"question":"calc: 2 + 3 * 4"}'
curl -N -X POST localhost:3000/ask/stream -d '{"question":"calc: 2 + 3 * 4"}'   # steps as Server-Sent Events
```

What to look at:

- `src/routes.mjs` imports neither Hono nor Fastify. It contributes routes to a registry.
- Every request runs in a scope. `/ask` passes the request id and signal to the agent, so the agent's
  `task:<request id>` scope is linked: if the client disconnects, the run is cancelled and both scopes are released.
- `/ask/stream` registers an `agent:step` hook through the request scope; it disappears when the response ends.
