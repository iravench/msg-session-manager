'use strict'

import logger from './utils/logger'
import config from './config'
import { SessionMissingError } from './utils/errors'

const log = logger.child({module: 'fm_session_factory'})

export default function(opts) {
  const { repo } = opts

  return {
    auth: (spark, decoded_token) => {
      return new Promise((resolve, reject) => {
        // TBD validate the format of decoded token

        // TBD further verify client spark against decoded token
        log.debug('verifying spark client against decoded token')
        if (!spark.address.ip.includes(decoded_token.conn.ip)) {
          let err_msg = 'auth error, client ip does not match issued token'
          log.warn(err_msg)
          return reject(new Error(err_msg))
        }
        if (decoded_token.fm.id !== config.fm.id) {
          let err_msg = 'auth error, client attemps to connect un-appointed front machine'
          log.warn(err_msg)
          return reject(new Error(err_msg))
        }

        log.debug('activating session base on decoded token')
        repo.retrieve_session(decoded_token.session.id).then(
          (session) => {
            if (session) {
              // TBD check if session still valid
              log.debug('valid session found')
              // TBD compute user object which represents the session object
              // simply assign the decoded token to it at the moment
              spark.user = decoded_token
              return resolve()
            } else {
              throw new SessionMissingError('auth error, session not found')
            }
          },
          (err) => {
            let err_msg = 'auth error, session repository failed'
            log.error(err, err_msg)
            return reject(new Error(err_msg))
          })
      })
    }
  }
}
