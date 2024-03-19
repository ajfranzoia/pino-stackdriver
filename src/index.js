const stackdriver = require('./stackdriver')
const pumpify = require('pumpify')

module.exports.createWriteStream = ({
  credentials,
  logName,
  projectId,
  fallback,
  resource,
  keys,
  serviceContext
}) => {
  const parseJsonStream = stackdriver.parseJsonStream()
  const toLogEntryStream = stackdriver.toLogEntryStream({ resource, serviceContext, keys })
  const toStackdriverStream = stackdriver.toStackdriverStream({ credentials, logName, projectId, fallback })
  return pumpify(parseJsonStream, toLogEntryStream, toStackdriverStream)
}
