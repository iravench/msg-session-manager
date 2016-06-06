'use strict'

import http from 'http'
import express from 'express'
import blocked from 'blocked'
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
import setupAuthorizedSpark from './setupAuthorizedSpark'

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
const log = logger.child({ module: 'index' })

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
  fm: config.fm,
  redis: redis,
  amqp: amqpConn,
  amqp_namespace: config.primus.amqp_namespace,
  register_namespace: config.primus.register_namespace,
  register_interval: config.primus.register_interval,
  register_latency: config.primus.register_latency
})

// init primus plugins
primus.use('mirage', Mirage)
primus.use('emitter', Emitter)
primus.use('fm_register', fm_register_plugin)
primus.use('fm_amqp', fm_amqp_plugin)

// an event emitter for emitting auth_success events on the primus server instance
const emmitSparkAuthorizedEvent = primus.emits(Events.AUTHORIZED)

//
// setup mirage as an authentication and session provider
//
// upon connection, a token based authentication is performed
// a token should be compute base and shall not be stored on server
// a token should have expiry setting, as well as client information embeded
//
// spark.mirage constains above said token upon entering primus.id.validation
// once authenticated, spark.user will be assigned with an user object computed
primus.id.timeout = config.primus.mirage_timeout
primus.id.generator((spark, cb) => {
  let err_msg = 'client without token attempting to connect'
  log.warn(err_msg)
  // signal client that the authentication has failed
  // because no token is provided
  spark.send(Events.UNAUTHORIZED, 'missing token')
  cb(new Error(err_msg))
})
primus.id.validator((spark, cb) => {
  let ok = fm_token.verify(spark.mirage).then((decoded_token) => {
    return fm_session.auth(spark, decoded_token)
  })

  ok = ok.then(
    () => {
      // signal client that the authentication is successful
      spark.send(Events.AUTHORIZED)
      // signal primus that a new spark is authorized
      emmitSparkAuthorizedEvent(spark)
      // end of validation
      cb()
    },
    (err) => {
      // signal client that the authentication has failed
      // because associated session fails to be activated
      // or because provided token could not be verified
      spark.send(Events.UNAUTHORIZED, err.message)
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
primus.on(Events.AUTHORIZED, (spark) => {
  log.debug({ AuthorizedUser: spark.user }, 'client authenticated')

  setupAuthorizedSpark(spark)
})

// TBD primus global error handler
primus.on('error', (err) => {
  log.error(err)
})

primus.on(Events.FM_REGISTERED, (fm_id) => {
  log.info('front machine %s registered', fm_id)
})

primus.on(Events.FM_UNREGISTERED, (fm_id) => {
  log.info('front machine %s unregistered', fm_id)
})

// TBD any uncaughtException handler
process.on('uncaughtException', (err) => {
  log.error(err)
})

// TBD exit out when amqp connection fails
amqpConn.catch((err) => {
  log.error(err, 'amqp connection failed')
  process.exit(1)
})

// start listening
server.listen(config.port)
log.info('start listening on port %s', config.port)

// issue warnings if eventloop got delayed by more than 200ms
blocked((ms) => {
  log.warn('eventloop delayed by %d ms', ms)
}, { threshold: 200 });

// trap interrupt signals to perform cleanup before exit
['SIGINT','SIGUSR2'].forEach((signal) => {
  process.on(signal, () => {
    amqpConn.then((conn) => {
      conn.close()
      primus.fm_register.release_server(undefined, (err) => {
        if (err) {
          log.error(err, 'fm register failed to clean up')
          process.exit(1)
        }
        log.info('clean up finished, exit process')
        process.exit()
      })
    })
  })
})
