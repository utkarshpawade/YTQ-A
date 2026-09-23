import { app } from './app.js'
import { settings } from './config.js'
import { warmEmbeddings } from './rag-pipeline.js'

const server = app.listen(settings.port, '0.0.0.0', () => {
  console.log(`YouTube Q&A API listening on http://0.0.0.0:${settings.port}`)
  warmEmbeddings()
})

const shutdown = (signal) => {
  console.log(`${signal} received; closing HTTP server.`)
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
