import { createServerRunner } from 'react-router-fastify'

export default createServerRunner(new URL('./build/server/index.js', import.meta.url), {
  serveClientAssets: true,
  logRequests: true,
  serverTimingHeader: true,
  prepare: async (app) => {
    app.get('/api/hello', (req, res) => {
      res.send({ message: 'Hello World' })
    })
  },
})
