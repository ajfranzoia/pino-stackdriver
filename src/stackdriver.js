const stream = require('stream')

const fastJsonParse = require('fast-json-parse')
const split2 = require('split2')
const through2 = require('through2')
const { Logging } = require('@google-cloud/logging')

const PINO_LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }

// const STACKDRIVER_SEVERITIES = { default: 0, debug: 100, info: 200, notice: 300, warning: 400, error: 500, critical: 600, alert: 700, emergency: 800 }

function _jsonParser (str) {
  const result = fastJsonParse(str)
  if (result.err) return
  return result.value
}

function _levelToSeverity (level) {
  if (level === PINO_LEVELS.trace || level === PINO_LEVELS.debug) { return 'debug' }
  if (level === PINO_LEVELS.info) { return 'info' }
  if (level === PINO_LEVELS.warn) { return 'warning' }
  if (level === PINO_LEVELS.error) { return 'error' }
  if (level >= PINO_LEVELS.fatal) { return 'critical' }
  return 'default'
}

const defaultKeys = {
  httpRequest: 'httpRequest',
  trace: undefined,
  spanId: undefined
}

function _getKey (log, data, k, keys) {
  // use custom key, otherwise use default keys
  const key = (keys && keys[k]) ? keys[k] : defaultKeys[k]
  // if no key is specified, return nothing
  if (!key) return undefined
  // if a value is defined, remove it from the log message to avoid double-loggin
  const v = log[key]
  if (v) {
    delete data[key]
    return v
  }
  return undefined
}

function _noop () {}

module.exports.parseJsonStream = function () {
  return split2(_jsonParser)
}

module.exports.toLogEntry = function (log, options = {}) {
  const { labels, resource, keys, serviceContext } = options
  const { prefix } = log

  const severity = _levelToSeverity(log.level)
  let message = log.msg || log.message || severity
  message = (prefix) ? `[${prefix}] ${message}` : message

  const data = { ...log, message }
  if (data.msg) { delete data.msg }
  if (data.labels) { delete data.labels }

  if (log.level >= PINO_LEVELS.error) {
    data['@type'] = 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent'

    const stack = log.stack || log.err?.stack
    data.message = `${message}\n${stack}`
  }

  if (serviceContext) {
    data.serviceContext = serviceContext
  }

  const entry = {
    meta: {
      resource,
      severity,
      trace: _getKey(log, data, 'trace', keys),
      spanId: _getKey(log, data, 'spanId', keys),
      httpRequest: _getKey(log, data, 'httpRequest', keys)
    },
    data
  }
  if (labels || log.labels) {
    const optLabels = labels || {}
    const logLabels = log.labels || {}
    entry.meta.labels = { ...optLabels, ...logLabels }
  }

  return entry
}

module.exports.toLogEntryStream = function (options = {}) {
  if (options.serviceContext && !options.serviceContext.service) {
    throw new Error('If \'serviceContext\' is specified then ' +
      '\'serviceContext.service\' is required.')
  }

  const self = this
  return through2.obj(function transport (chunk, enc, cb) {
    const entry = self.toLogEntry(chunk, options)
    cb(null, entry)
  })
}

module.exports.toStackdriverStream = function (options = {}) {
  const { logName, projectId, credentials, fallback, resource } = options
  const opt = {
    logName: logName || 'pino_log',
    projectId,
    scopes: ['https://www.googleapis.com/auth/logging.write'],
    fallback
  }

  if (typeof credentials === 'object' && credentials !== null) {
    opt.credentials = credentials
  } else {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || credentials) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || credentials
    }
  }

  const logging = new Logging(opt)
  const log = logging.log(opt.logName)

  if (!resource) {
    logging.setDetectedResource()
  }

  const writableStream = new stream.Writable({
    objectMode: true,
    write (chunk, encoding, callback) {
      const entry = log.entry(chunk.meta, chunk.data)
      log[chunk.meta.severity](entry, _noop)
      callback()
    }
  })
  return writableStream
}
