'use strict';

import config from './config'
import logger from './utils/logger'
import { InvalidTokenError } from './utils/errors'

const log = logger.child({module: 'fm_token_factory'})

export default (opts) => {
  const defaults = config.jwt
  const options = Object.assign({}, defaults, opts)
  const { impl } = options

  return {
    verify: (token) => {
      log.debug('verifying token');
      return impl.verify(token, options.secret, options).then(
        (decoded_token) => {
          log.debug('token verified and decoded')
          return decoded_token
        },
        (err) => {
          let err_msg = 'invalid token, ' + err.message
          log.debug(err, err_msg)
          throw new InvalidTokenError(err_msg)
        })
    }
  }
}
