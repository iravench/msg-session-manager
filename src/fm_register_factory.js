'use strict'

import logger from './utils/logger'
// TBD if we're going to perform cleanup, this inuse error will be removed
import { FrontMachineIdInUseError } from './utils/errors'

const log = logger.child({module: 'fm_register_factory'})

// TBD this should be a primus plugin
// maybe put to redis with a counter object with a key that has expiry settings
// so that whenever the server instance fails to refresh the key expiry, or crashes
// this node won't get picked up by borker for serving connections
//
// whenever the server instance comes back up tho,
// it will need to wipe out related pre-crash-remaining data,
// since those are outdated, e.g. connection: user_id, spark_id, etc.
//
// and this plugin should also expose a cleanup method for normal server instance exit?
export default function(opts) {
  const { repo } = opts

  function handleRepositoryError(err, err_msg) {
    log.error(err)
    throw new Error(err_msg)
  }

  return {
    register: function(id, ip, port) {
      let err_msg = 'error registering front machine record'

      log.debug('checking front machine registration record')
      return repo.get_fm_record(id).then(
        (result) => {
          if (result && result.id) {
            log.debug('front machine registration record found')
            // TBD perform a wipe out instead
            throw new FrontMachineIdInUseError()
          } else {
            log.debug('setting front machine registration record')
            return repo.set_fm_record(id, ip, port).then(
              () => {
                log.debug('front machine registration record set')
              },
              (err) => {
                handleRepositoryError(err, err_msg)
              })
          }
        },
        (err) => {
          handleRepositoryError(err, err_msg)
        })
    },
    deregister: function(id) {
      log.debug('deleting front machine registration record')
      return repo.delete_fm_record(id).then(
        () => {
          log.debug('front machine registration record deleted')
        },
        (err) => {
          handleRepositoryError(err, 'error deregistering front machine record')
        })
    }
  }
}
