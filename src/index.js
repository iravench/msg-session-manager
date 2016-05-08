'use strict'

import http from 'http'
import express from 'express'
import Redis from 'ioredis'
import amqplib from 'amqplib'
import Primus from 'primus'
import Mirage from 'mirage'
import Emitter from 'primus-emitter'
import jwt from 'jsonwebtoken'
import bodyParser from 'body-parser'
import config from './config'
import logger from './utils/logger'
import controllers from './controllers'
import Events from './events'

import fm_register_plugin from './plugins/fm_register_plugin'
import fm_amqp_plugin from './plugins/fm_amqp_plugin'
import fm_session_factory from './fm_session_factory'
import fm_token_factory from './fm_token_factory'
import repo_factory from './repo_factory'
import repo_impl from './implementations/repo_impl'
import fm_token_impl from './implementations/fm_token_impl'

const repo = repo_factory({ impl: repo_impl })
const fm_session = fm_session_factory({ repo: repo })
const fm_token = fm_token_factory({ impl: fm_token_impl })
const redisOptions = {
  family: config.storage.redis.family,
  password: config.storage.redis.password,
  db: config.storage.redis.db
}
const redis = new Redis(config.storage.redis.port, config.storage.redis.host, redisOptions)
const amqpConn = amqplib.connect('amqp://' + config.storage.rabbit.host + ':' + config.storage.rabbit.port)
const log = logger.child({module: 'index'})

// init api routes
const app = express()
const apiRouter = express.Router()
controllers.init(apiRouter)
app.use('/v1', bodyParser.json(), bodyParser.urlencoded({ extended:true }), apiRouter)

// init http server
// TBD switch to https or this can be skipped provided the load balancer has https setup
const server = http.Server(app)

// init primus with engine.io
const primus = new Primus(server, {
  transformer: 'engine.io',
  parser: 'JSON',
  redis: redis,
  amqpConn: amqpConn,
  fm: config.fm
})

// init primus plugins
primus.use('mirage', Mirage)    // the mirage plugin has to come first as it takes care of authentication
primus.use('emitter', Emitter)
primus.use('fm_register', fm_register_plugin)
primus.use('fm_amqp', fm_amqp_plugin)

// create an event emitter for emitting client auth_success events on this server instance
const primus_authorized = primus.emits(Events.AUTH_SUCCESS)

//
// setup mirage as an authentication and session provider
//
// upon connection, a token based authentication is performed
// a token should be compute base and shall not be stored on server
// a token should have expiry setting, as well as client information embeded
//
// spark.mirage constains above said token upon entering primus.id.validation
// once authenticated, spark.user will be assigned to an user object computed
primus.id.timeout = config.mirage.timeout
primus.id.generator((spark, cb) => {
  let err_msg = 'client without token attempting to connect'
  log.warn(err_msg)
  // signal client that the authentication has failed
  // because no token is provided
  spark.send(Events.AUTH_FAILURE, 'missing token')
  cb(new Error(err_msg))
})
primus.id.validator((spark, cb) => {
  fm_token.verify(spark.mirage).then(
    (decoded_token) => {
      fm_session.auth(spark, decoded_token).then(
        () => {
          // signal client that the authentication is successful
          spark.send(Events.AUTH_SUCCESS)
          // signal primus that a new spark is authorized
          primus_authorized(spark)
          // end of validation
          cb()
        },
        (err) => {
          // signal client that the authentication has failed
          // because associated session fails to be activated
          spark.send(Events.AUTH_FAILURE, err.message)
          // end of validation
          cb(err)
        })
    },
    (err) => {
      // signal client that the authentication has failed
      // because provided token could not be verified
      spark.send(Events.AUTH_FAILURE, err.message)
      // end of validation
      cb(err)
    })
})

// TBD should extract this bits into a npm script task
// generate primus client file, this file gets updated whenever primus configuration changes
// primus.save(__dirname + '/primus.js')

// do not serve primus.js from front machine
primus.remove('primus.js')

// register handlers for a secured connection
primus.on(Events.AUTH_SUCCESS, (spark) => {
  log.info({ AuthorizedUser: spark.user }, 'client authenticated')

  spark.send('hello', { data: "how are you?" })
  spark.on('howdy', (data) => {
    log.info(data)
  })
})

// primus global error handler
primus.on('error', (err) => {
  log.error(err)
})

primus.on(Events.FM_REGISTERED, (fm_id) => {
  log.info('front machine %s registered', fm_id)
})

primus.on(Events.FM_UNREGISTERED, (fm_id) => {
  log.info('front machine %s unregistered', fm_id)
})

// during web socket connection authentication process,
// we'll also check the session associated with incoming token
// if the session is revoked or expired, the authentication fails
// since we're not touching session data after it gets created,
// we can apply cache and cache invalidation to it later
//
// a primus plugin for connection registration
// if we use redis, must have predefine query
// we also need to send serverside messages to a specific user or a group of users or users fit some tags
// we may also need to know if any of these users are currently online?
// we also need to know on which fm these users are located? so we can send messages to this fm
// or we can limit user from logging in multiple times
//
// when fm fails, we will need to clean up these information
//
// the user_id - spark_id mapping will be recorded,
// in order to send serverside messages or control protocols
// these handlers could be placed after authentication success
//
// AMQP could be used to establish channels for broadcast/control/user_id specific messaging,
// since channels across fms will all be receiving these messages,
// a check and drop strategy will be deployed, if the target not exists, message dropped
// which means we need another user_id/spark_id mapping, could be in-memory or redis
//
// primus metroplex and omega-supreme plugins could be used to deliver messages
// or used to reflect server load?
//
// TBD mysql is too heavy for registering a session imo, and too many places could break
// TBD activated session's socket_id can be used to push server side messages, or maybe fm_manager_id? specific socket_id should probably be held in that manager's memory
// TBD activated session's fm_id can be used to identify server load and determine further session allocation. (for broker policy) to gain better performance, we might want to do this on redis, just maintain a record on whenever a socket gets authenticated and disconnected.
// TBD what if an fm crashes and subsequently we lose all socket connections?
// some kind of monitor system should be watching this event.
// when it happens, trigger a redis/mysql session close-up?
// TBD what happens when client tries to establish socket connection with a failed fm?
// should broker accept the fail token in order to assign a new fm?

server.listen(config.port)
log.info('start listening on port %s', config.port);

// trap interrupt signals to perform cleanup before exit
// TBD clean up these mess...
['SIGINT','SIGUSR2'].forEach((signal) => {
  process.on(signal, () => {
    cleanup()
  })
})

amqpConn.then((conn) => {
  process.once('SIGINT', () => { conn.close() })
  process.once('SIGUSR2', () => { conn.close() })
  process.once('exit', () => { conn.close() })
})

// actual cleanup process
function cleanup() {
  return Promise.all([
  ]).then(
    () => {
      primus.fm_register.release_server(undefined, (err) => {
        log.info('clean up finished, exit process')
        process.exit()
      })
    },
    (err) => {
      //TBD when errors, might want triger some offline cleanup job
      log.error('error cleaning up')
      process.exit(1)
    })
}
