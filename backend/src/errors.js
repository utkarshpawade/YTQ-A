export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message)
    this.name = new.target.name
    this.statusCode = statusCode
  }
}

export class ConfigError extends AppError {
  constructor(message) {
    super(message, 503)
  }
}

export class TranscriptError extends AppError {
  constructor(message) {
    super(message, 400)
  }
}

export class PipelineError extends AppError {
  constructor(message) {
    super(message, 502)
  }
}

export class VideoNotIndexedError extends AppError {
  constructor(message) {
    super(message, 404)
  }
}
