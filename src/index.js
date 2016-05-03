'use strict'

import http from 'http'
import express from 'express'
import Primus from 'primus'
import Mirage from 'mirage'
import Emitter from 'primus-emitter'
import jwt from 'jsonwebtoken'
import bodyParser from 'body-parser'
import config from './config'
import logger from './utils/logger'
import controllers from './controllers'
import Events from './events'

import fm_session_factory from './fm_session_factory'
import fm_register_factory from './fm_register_factory'
import fm_token_factory from './fm_token_factory'
import fm_session_auth_factory from './fm_session_auth_factory'
import repo_factory from './repo_factory'
import repo_impl from './implementations/repo_impl'
import fm_token_impl from './implementations/fm_token_impl'

const repo = repo_factory({ impl: repo_impl })
const fm_session = fm_session_factory({ repo: repo })
const fm_session_auth = fm_session_auth_factory({ fm_session: fm_session })
const fm_register = fm_register_factory({ repo: repo })
const fm_token = fm_token_factory({ impl: fm_token_impl })
const log = logger.child({module: 'index'})

// init api
const app = express()
const apiRouter = express.Router()
controllers.init(apiRouter)
app.use('/v1', bodyParser.json(), bodyParser.urlencoded({ extended:true }), apiRouter)

// init http server
// TBD switch to https or you can skip that with load balancer https instead
const server = http.Server(app)

// init primus with engine.io
const primus = new Primus(server, { transformer: 'engine.io', parser: 'JSON' })
primus.use('mirage', Mirage) // mirage has to be the first plugin installed
primus.use('emitter', Emitter)
const primus_authorized = primus.emits(Events.Auth_Success)

// setup mirage
primus.id.timeout = 3000
primus.id.generator((spark, cb) => {
  let err_msg = 'client without token attempting to connect'
  log.warn(err_msg)
  // signal client authentication failed
  spark.send(Events.Auth_Failure, 'missing token')
  cb(new Error(err_msg))
})
primus.id.validator((spark, cb) => {
  fm_token.verify(spark.mirage).then(
    (decoded_token) => {
      fm_session_auth.activate(spark, decoded_token).then(
        () => {
          // signal client authentication successful
          spark.send(Events.Auth_Success)
          // signal primus client authentication successful
          primus_authorized(spark)
          // end validation
          cb()
        },
        (err) => {
          // signal client authentication failed
          spark.send(Events.Auth_Failure, err.message)
          // end validation
          cb(err)
        })
    },
    (err) => {
      // signal client authentication failed
      spark.send(Events.Auth_Failure, err.message)
      // end validation
      cb(err)
    })
})

// serving primus client file, this file gets updated whenever primus configuration changes
// TBD this is only for development, might want to server this client file from broker
// primus.save(__dirname + '/primus.js')

// TBD should the session be a one-time only?
primus.on(Events.Auth_Success, (spark) => {
  log.info('client authenticated')

  spark.on('end', () => {
    log.info('client disconnected')
    fm_session_auth.deactivate(spark.id)
  })

  // stuff you want to do with a secured socket
  spark.send('hello', { data: "how are you?" })
  spark.on('howdy', (data) => {
    log.info(data)
  })
})

// when on connection, should perform a token based authentication
// a token is compute base, shall not be stored on server.
// a token also has expiry setting, and other client information embeded
// so that after verifying the sigature, server can make use of these embeded information
//
// after a web socket connection is established and authenticated,
// socket_id, fm_ip will then be used to activate the session
//
//TBD mysql is too heavy for registering a session imo, and too many places could break
//TBD activated session's socket_id can be used to push server side messages, or maybe fm_manager_id? specific socket_id should probably be held in that manager's memory
//TBD activated session's fm_id can be used to identify server load and determine further session allocation. (for broker policy) to gain better performance, we might want to do this on redis, just maintain a record on whenever a socket gets authenticated and disconnected.
//TBD what if an fm crashes and subsequently loses all socket connections?
// some kind of monitor system should be watching this event.
// when it happens, trigger a redis/mysql session close-up?
//TBD what happens when client tries to establish socket connection with a failed fm?
//should broker accept the fail token in order to assign a new fm?

server.listen(config.port)
log.info('start listening on port %s', config.port)

//register to available fm pool
fm_register.register(config.fm.id, config.fm.ip, config.fm.port).then(
  () => {
    log.info('front machine registered')
  },
  (err) => {
    // if not registered, there should not be any socket connections coming in, so just error out
    log.fatal(err, 'error registering front machine')
    process.exit(1)
  });

//trap interrupt signals and perform cleanup
['SIGINT','SIGUSR2'].forEach((signal) => {
  process.on(signal, () => {
    cleanup()
  })
})

function cleanup() {
  return Promise.all([
    fm_register.deregister(config.fm.id),
    fm_session.close_all(config.fm.id)
  ]).then(
    () => {
      log.info('clean up finished, exit process')
      process.exit()
    },
    (err) => {
      //TBD when errors, might want triger some offline cleanup job
      log.error('error cleaning up')
      process.exit(1)
    })
}
