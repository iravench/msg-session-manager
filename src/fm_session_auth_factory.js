'use strict'

import logger from './utils/logger'
import { SessionInUseError } from './utils/errors'

const log = logger.child({module: 'fm_session_auth_factory'})

export default (opts) => {
  const { fm_session } = opts

  return {
    activate: (spark, decoded_token) => {
      return new Promise((resolve, reject) => {
        //TBD further verify client spark against decoded token
        log.debug('verifying client spark against presented decoded token')
        if (!spark.address.ip.includes(decoded_token.conn.ip)) {
          let err_msg = 'client ip does not match with token content'
          log.debug(err_msg)
          return reject(new Error(err_msg))
        }

        log.debug('activating session base on decoded token')
        fm_session.activate(decoded_token, spark.id).then(
          (result) => {
            log.debug('session activated, authentication is successful')
            return resolve()
          },
          (err) => {
            if (err instanceof SessionInUseError) {
              let err_msg = 'session has already been activated, authentication failed'
              log.warn(err)
              return reject(new Error(err_msg))
            } else {
              let err_msg = 'unknown error, please retry'
              log.error(err)
              return reject(new Error(err_msg))
            }
          })
      })
    },
    deactivate: (spark_id) => {
      log.debug('deactivating session base on spark id %s', spark_id)
      return fm_session.deactivate(spark_id).then(
        () => {
          log.debug('socket session deactivated')
        },
        (err) => {
          log.warn(err, 'socket session fail to deactivate')
        })
    }
  }
}
