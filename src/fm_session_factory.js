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
        // TBD validate the format of decoded token payload

        if (decoded_token.fm.id !== config.fm.id) {
          let err_msg = 'auth error, client attemps to connect to an un-appointed front machine'
          log.warn(err_msg)
          return reject(new Error(err_msg))
        }

        //
        // TBD if the session is revoked or expired, the authentication fails
        // since we're not touching session data during the verification,
        // we can apply cache and cache invalidation later
        //
        repo.retrieve_session(decoded_token.session.id).then(
          (session) => {
            if (session) {
              log.debug('valid session found')
              // TBD compute user object which represents current live session
              spark.user = decoded_token.user
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
