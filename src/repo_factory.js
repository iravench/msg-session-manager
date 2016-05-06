'use strict'

import logger from './utils/logger'
import { RepositoryError } from './utils/errors'

const log = logger.child({module: 'repo_factory'})

function handleStorageError(err, err_msg) {
  log.error(err)
  throw new RepositoryError(err_msg)
}

export default function(opts) {
  const { impl } = opts

  return {
    retrieve_session: function(session_id) {
      let err_msg = 'error retrieving session record'

      log.debug('getting session record')
      return impl.get_session(session_id).then(
        (session) => {
          if (session) log.debug('session record found')
          return session
        },
        (err) => {
          handleStorageError(err, err_msg)
        })
    }
  }
}
