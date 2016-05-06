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
    },
    get_fm_record: function(fm_id) {
      let err_msg = 'error getting front machine registration record'

      log.debug('getting front machine registration record by id %s', fm_id)
      return impl.get_fm_registration(fm_id).then(
        (result) => {
          if (!result || !result.id) {
            log.debug('front machine registration record by id %s not found', fm_id)
            return
          } else {
            log.debug('front machine registration record by id %s found', fm_id)
            return { fm_id: result.id }
          }
        },
        (err) => {
          handleStorageError(err, err_msg)
        })
    },
    set_fm_record: function(fm_id, fm_ip, fm_port) {
      let err_msg = 'error setting front machine registration record'

      log.debug('setting front machine registration record by id %s', fm_id)
      return impl.set_fm_registration(fm_id, fm_ip, fm_port).then(
        () => {
          log.debug('front machine registration record by id %s set', fm_id)
          return
        },
        (err) => {
          handleStorageError(err, err_msg)
        })
    },
    delete_fm_record: function(fm_id) {
      let err_msg = 'error deleting front machine registration record'

      log.debug('deleting front machine registration record by id %s', fm_id)
      return impl.delete_fm_registration(fm_id).then(
        () => {
          log.debug('front machine registration record by id %s deleted', fm_id)
          return
        },
        (err) => {
          handleStorageError(err)
        })
    }
  }
}
