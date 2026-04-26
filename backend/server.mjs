import { createServer } from 'node:http'

const port = Number.parseInt(process.env.PORT ?? '8080', 10)
const oscillatingMessages = ['Anchor backend: ping', 'Anchor backend: pong']
const oscillationIntervalMs = 5_000

const writeJson = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

const getBackendText = () => {
  const messageIndex = Math.floor(Date.now() / oscillationIntervalMs) % oscillatingMessages.length
  return oscillatingMessages[messageIndex]
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    writeJson(response, 204, {})
    return
  }

  if (request.method !== 'GET') {
    writeJson(response, 405, { error: 'Method not allowed' })
    return
  }

  if (request.url === '/healthz') {
    writeJson(response, 200, { ok: true })
    return
  }

  writeJson(response, 200, { text: getBackendText() })
})

server.listen(port, () => {
  console.log(`Anchor backend listening on port ${port}`)
})
