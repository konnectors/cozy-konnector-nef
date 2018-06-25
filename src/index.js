'use strict'

// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://d76719f817944d2c922d93a39f72a233:727212fa092f47bc95f8ee7fc3be3b3e@sentry.cozycloud.cc/28'

const { BaseKonnector, cozyClient } = require('cozy-konnector-libs')
const moment = require('moment-timezone')
const { Document } = require('cozy-doctypes')
const { start } = require('./lib')

Document.registerClient(cozyClient)

moment.locale('fr')
moment.tz.setDefault('Europe/Paris')

module.export = new BaseKonnector(async fields => {
  await start(fields)
})
