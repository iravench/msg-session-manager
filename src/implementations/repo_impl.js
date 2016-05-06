'use strict'

import mysql from 'mysql'
import config from '../config'
import logger from '../utils/logger'
import { StorageError } from '../utils/errors'

const log = logger.child({module: 'repo_impl'})
//TBD should probably inject a pool instance here so that we can do unit testing...
const pool = mysql.createPool(config.storage.mysql)

const selectSessionQuery = 'select id, user_id, device_id, policy from session where id=?'
const insertNewFmRegistrationQuery = 'insert into fm_registration (id, ip, port) values (?, ?, ?)'
const selectFmRegistrationQuery = 'select id, ip, port from fm_registration where id=?'
const deleteFmRegistrationQuery = 'delete from fm_registration where id=?'

function handleMySQLError(reject, err, err_msg) {
  log.error(err)
  return reject(new StorageError(err_msg))
}

function mysqlPromise(handler) {
  let err_msg = 'error connecting to storage'

  return new Promise((resolve, reject) => {
    log.debug('getting pooled mysql connection')
    pool.getConnection((err, connection) => {
      if (err) return handleMySQLError(reject, err, err_msg)

      log.debug('mysql connection established')
      handler(connection, resolve, reject)
    })
  })
}

export default {
  get_session(session_id) {
    let err_msg = 'error querying storage for session data'

    return mysqlPromise((connection, resolve, reject) => {
      log.debug('querying session data')
      connection.query(selectSessionQuery, [session_id], (err, rows) => {
        if (err) return handleMySQLError(reject, err, err_msg)

        if (rows.length > 0) {
          log.debug('session data of id %s retrieved', session_id)
          resolve(rows[0])
        }
        else {
          log.debug('session data not found')
          resolve(null)
        }

        connection.release()
      })
    })
  },
  get_fm_registration: function(id) {
    let err_msg = 'error querying storage for front machine registration data'

    return mysqlPromise((connection, resolve, reject) => {
      log.debug('querying front machine registration data by id %s', id)
      connection.query(selectFmRegistrationQuery, [id], (err, result) => {
        if (err) return handleMySQLError(reject, err, err_msg)

        if (result.length > 0) {
          log.debug('front machine registration data by id %s retrieved', id)
          resolve(result[0])
        }
        else {
          log.debug('front machine registration data by id %s not found', id)
          resolve(null)
        }

        connection.release()
      })
    })
  },
  set_fm_registration: function(id, ip, port) {
    let err_msg = 'error updating storage for setting front machine registration data'

    return mysqlPromise((connection, resolve, reject) => {
      log.debug('setting front machine registration data of id %s', id)
      connection.query(insertNewFmRegistrationQuery, [id, ip, port], (err, result) => {
        if (err) return handleMySQLError(reject, err, err_msg)

        log.debug('front machine registration data of id %s set', id)
        resolve()

        connection.release()
      })
    })
  },
  delete_fm_registration: function(id) {
    let err_msg = 'error updating storage for deleting front machine registration data'

    return mysqlPromise((connection, resolve, reject) => {
      log.debug('deleting front machine registration data of id %s', id)
      connection.query(deleteFmRegistrationQuery, [id], (err, result) => {
        if (err) return handleMySQLError(reject, err, err_msg)

        log.debug('front machine registration data of id %s deleted', id)
        resolve()

        connection.release()
      })
    })
  }
}
