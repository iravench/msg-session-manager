'use strict'

import logger from '../utils/logger'
import EventEmitter from 'events'
import Events from '../events'

const log = logger.child({module: 'fm_amqp'})

class Fm_Amqp extends EventEmitter {
  constructor(primus, options) {
    super()

    log.debug('initializing primus fm amqp plugin...')

    // validate options
    options = options || {}
    if (!options.amqp) throw new Error('please provide an amqp connection instance through options')

    // parse options and set defaults
    this.amqpConn = options.amqp
    this.namespace = (options.amqp_namespace || 'mkm') + '.'

    // prepare exchange keys
    this.ekeyBroadcast = this.namespace + 'ibc.broadcast'
    this.ekeyPrivate = this.namespace + 'ibc.private'
    // prepare queue key
    this.qkey = this.namespace + 'ibc.'
    // prepare routing key
    this.rkeyPrivate = this.namespace + 'ibc.private.'
  }

  setup_conn(spark, next) {
    // dont have to verify authorization status here
    // because mirage plugin will terminate connection
    // if it's not properly authorized

    log.debug('setting up amqp for new connection')
    const amqp = this
    const amqpConn = this.amqpConn

    const msgHandler = (msg) => {
      const parsedMessage = parseIncoming(msg)
      if (parsedMessage) spark.send(parsedMessage.category, parsedMessage.content)
    }

    const amqpOk = amqpConn.then((conn) => {
      // create an amqp channel for the spark instance
      return conn.createChannel().then((ch) => {
        // hold on to the channel ref so we can later close it during spark exits
        spark.amqpCh = ch

        // make sure the queue for current login user exists
        const queueName = amqp.qkey + spark.user.user_id + '.' + spark.user.device_id
        const qok = ch.assertQueue(queueName, { durable: true })

        // make sure the fanout exchagne for broadcast exists
        // upon receiving backend broadcast messages, deliver through spark
        let fanoutOk = ch.assertExchange(amqp.ekeyBroadcast, 'fanout', { durable: true })
        // bind queue to exchange
        fanoutOk = Promise.all([qok, fanoutOk]).then(() => {
          return ch.bindQueue(queueName, amqp.ekeyBroadcast, '')
        })
        // consume backend message and send out to bc via spake
        fanoutOk = fanoutOk.then(() => {
          return ch.consume(queueName, msgHandler, { noAck: true })
        })

        // make sure the topic exchagne for personal message exists
        // upon receiving matched backend messages, deliver through spark
        let topicOk = ch.assertExchange(amqp.ekeyPrivate, 'topic', { durable: true })
        // bind queue to exchange
        topicOk = Promise.all([qok, topicOk]).then(() => {
          let privateRoutingKey = amqp.rkeyPrivate + spark.user.user_id
          return ch.bindQueue(queueName, amqp.ekeyPrivate, privateRoutingKey)
        })
        // consume backend message and send out to bc via spake
        topicOk = topicOk.then(() => {
          return ch.consume(queueName, msgHandler, { noAck: true })
        })

        return Promise.all([fanoutOk, topicOk])
      })
    })

    amqpOk.then(
      () => {
        if (next) next(undefined)
      },
      (err) => {
        if (next) return next(err)
        return amqp.emit('error', err)
      })

    //
    // after backend message delivered through spark, also send an ack to a confirm exchange
    // in order for other application to further process message delivery rate
    // this confirm exchange should probably be durable
    //
    // when delivery confirm is required, the backend message body should contain a flag or
    // a report-back-to exchange name, so that each delivery could be distinguished
    //

    return this
  }

  release_conn(spark) {
    // authorized or not, disconnect event will be triggered
    // so here we only decrease counter when it's a authorized conn
    if (!spark.mirage || !spark.user) {
      return this
    }

    log.debug('releasing amqp for disconnecting connection')
    const amqp = this

    // grab spark references
    const sparkId = spark.id
    const ch = spark.amqpCh

    // setup cleanup
    let ok = ch ? ch.close() : Promise.resolve()

    ok.then(
      () => {
        log.debug('spark %s is now disconnected from amqp channel', sparkId)
      },
      (err) => {
        return amqp.emit('error', err)
      })

    return this
  }
}

function parseIncoming(msg) {
  if (msg && msg.content) {
    let content = msg.content.toString()
    let headers = msg.properties.headers
    if (headers && headers.category) {
      if (headers.category === 'ibc.system') {
        return { category: Events.IBC_SYSTEM, content: content }
      }
      if (headers.category === 'ibc.comment') {
        return { category: Events.IBC_COMMENT, content: content }
      }
      if (headers.category === 'ibc.favourite') {
        return { category: Events.IBC_FAVOURITE, content: content }
      }
      if (headers.category === 'ibc.misc') {
        return { category: Events.IBC_MISC, content: content }
      }
    } else {
      // when no type header presents, treat it as of type ibc misc message
      return { category: Events.IBC_MISC, content: content }
    }
  }
  return
}

export default Fm_Amqp
