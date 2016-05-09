'use strict'

import jwt from 'jsonwebtoken'
import logger from '../utils/logger'

const log = logger.child({module: 'fm_token_impl'})

export default {
  verify: (token, secret, options) => {
    return new Promise((resolve, reject) => {
      return jwt.verify(token, secret, options, (err, decoded_token) => {
        if (err) {
          log.error(err, 'unable to verify jwt token')
          return reject(err)
        }

        log.debug('jwt token verified and decoded')
        return resolve(decoded_token)
      })
    })
  }
}
