'use strict';

import config from './config'
import logger from './utils/logger'
import { InvalidTokenError } from './utils/errors'

const log = logger.child({module: 'fm_token_factory'})

export default (opts) => {
  const defaults = config.jwt
  const options = Object.assign({}, defaults, opts)
  const { impl, secret } = options
  const signOpts = {
    algorithm: options.algorithm,
    audience: options.audience,
    subject: options.subject,
    issuer: options.issuer
  }

  return {
    verify: (token) => {
      return impl.verify(token, secret, signOpts).then(
        (decoded_token) => {
          log.debug('token verified')
          return decoded_token
        },
        (err) => {
          let err_msg = 'invalid token, ' + err.message
          log.error(err, err_msg)
          throw new InvalidTokenError(err_msg)
        })
    }
  }
}
