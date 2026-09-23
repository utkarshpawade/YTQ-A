export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'YouTube Q&A RAG API',
    description: 'Ask questions about a YouTube video and get answers with clickable timestamps.',
    version: '2.0.0',
  },
  paths: {
    '/api/health': {
      get: { summary: 'Show provider and cache status', responses: { 200: { description: 'Service status' } } },
    },
    '/api/process-video': {
      post: {
        summary: 'Fetch a transcript and build its vector index',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } } } } },
        responses: { 200: { description: 'Indexed video' }, 400: { description: 'Invalid URL or transcript unavailable' } },
      },
    },
    '/api/chat': {
      post: {
        summary: 'Answer a question about an indexed video',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['video_id', 'question'], properties: { video_id: { type: 'string' }, question: { type: 'string', maxLength: 1000 }, history: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { 200: { description: 'Grounded answer and timestamp sources' }, 404: { description: 'Video is not indexed' } },
      },
    },
  },
}
