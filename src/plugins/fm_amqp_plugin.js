'use strict'

import logger from '../utils/logger'
import Fm_Amqp from './fm_amqp'

const log = logger.child({module: 'fm_amqp_plugin'})

export default {
  server: (primus, options) => {
    const fm_amqp = new Fm_Amqp(primus, options)

    primus.on('connection', (spark, next) => {
      // perform necessary setup for a new connection
      fm_amqp.setup_conn(spark, next)
    }).on('disconnection', (spark, next) => {
      // perform necessary resource release for a disconnecting connection
      fm_amqp.release_conn(spark, next)
    })
  }
}
