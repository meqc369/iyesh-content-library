import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const root = dirname(fileURLToPath(import.meta.url))
const env = { ...process.env, NODE_ENV: 'production', PORT: '18787', AUTH_SECRET: 'a'.repeat(64), CORS_ORIGIN: 'https://m.example.com', ENABLE_DEV_LOGIN: 'false' }

const invalid = spawn(process.execPath, [join(root, 'index.mjs')], { cwd: root, env: { ...env, AUTH_SECRET: 'short' }, stdio: 'ignore' })
const [invalidExit] = await once(invalid, 'exit')
assert(invalidExit !== 0, 'production must reject weak secrets')

const server = spawn(process.execPath, [join(root, 'index.mjs')], { cwd: root, env, stdio: 'ignore' })
try {
  let health
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { health = await fetch('http://127.0.0.1:18787/health'); if (health.ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(health?.ok, 'production server did not start')
  const devLogin = await fetch('http://127.0.0.1:18787/api/v1/auth/dev-login', { method: 'POST' })
  assert(devLogin.status === 404, 'dev-login must be disabled in production')
  const unauthComment = await fetch('http://127.0.0.1:18787/api/v1/posts/post_1/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'blocked' }) })
  assert(unauthComment.status === 401, 'production writes must require authentication')
  const preflight = await fetch('http://127.0.0.1:18787/api/v1/posts/search', { method: 'OPTIONS', headers: { origin: 'https://m.example.com' } })
  assert(preflight.headers.get('access-control-allow-origin') === 'https://m.example.com', 'production CORS origin mismatch')
  console.log('Production security smoke checks passed')
} finally {
  if (server.exitCode === null && !server.killed) {
    server.kill('SIGTERM')
    await once(server, 'exit').catch(() => {})
  }
}
