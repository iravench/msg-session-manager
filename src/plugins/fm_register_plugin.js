'use strict'

import logger from '../utils/logger'
import Fm_Register from './fm_register'
import Events from '../events'

const log = logger.child({module: 'fm_register_plugin'})

export default {
  server: (primus, options) => {
    const fm_register = new Fm_Register(primus, options);

    // Register custom events as `reserved` so other plugins know
    // that they shouldn't be bluntly emitting these
    //
    // also proxy these events to the Primus instance
    // so that you can listen on the Primus server instead of the plugin.
    [Events.FM_REGISTERED, Events.FM_UNREGISTERED, 'error'].forEach((event) => {
      primus.reserved.events[event] = 1
      fm_register.on(event, primus.emits(event))
    })

    primus.on('connection', (spark, next) => {
      // perform necessary setup for a new connection
      fm_register.setup_conn(spark, next)
    }).on('disconnection', (spark, next) => {
      // perform necessary resource release for a disconnecting connection
      fm_register.release_conn(spark, next)
    }).on('close', (options, next) => {
      // perform necessary resource release for a closing fm server
      fm_register.release_server(undefined, next)
    }).server.on('listening', () => {
      if (fm_register.fm) return
      // perform necessary setup for a new fm server
      fm_register.setup_server(options.fm)
    })

    // expose fm_register
    primus.fm_register = fm_register
  }
}
