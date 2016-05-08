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
    primus = primus || {}
    options = options || {}
    if (!options.amqpConn) throw new Error('please provide an amqp connection instance through options')

    // parse options and set defaults
    this.amqpConn = options.amqpConn
    this.namespace = (options.namespace || 'mkm') + '.amqp.'

    // prepare exchange keys
    this.ekeyFanout = this.namespace + 'ibc.broadcast'
    this.ekeyTopic = this.namespace + 'ibc.personal.*'
  }

  setup_conn(spark, next) {
    log.debug('setting up new connection')
    const amqp = this
    const amqpConn = this.amqpConn

    if (!spark.mirage || !spark.user) {
      let err = new Error('connection has not been properly authorized')
      if (next) return next(err)
      return amqp.emit('error', err)
    }

    // amqp broadcast channel setup
    let amqpOk = amqpConn.then((conn) => {
      // create a new channel for the spark instance
      let broadcastOk = conn.createChannel().then((ch) => {
        // hold on to channel so we can later close it when spark exits
        spark.amqpBroadcastCh = ch
        // make sure the fanout exchagne for broadcast exists
        // upon receiving backend broadcast messages, deliver through spark
        // the exchange used to broadcast dont have to be durable
        let ok = ch.assertExchange(amqp.ekeyFanout, 'fanout', { durable: false })
        // make sure the temporary queue exists
        // the reason of temporary queue is that when this amqp connection closed
        // these queues get close as well
        ok = ok.then(() => {
          return ch.assertQueue('', {exclusive: true})
        })
        // bind queue to exchange
        ok = ok.then((qok) => {
          return ch.bindQueue(qok.queue, amqp.ekeyFanout, '').then(() => {
            return spark.amqpBroadcastQ = qok.queue
          })
        })
        // consume backend message and send out to bc via spake
        ok = ok.then((queue) => {
          return ch.consume(queue, (msg) => {
            if (msg && msg.content)
              spark.send(Events.MSG_IBC_BROADCAST, msg.content.toString())
          }, { noAck: true })
        })

        return ok.then(()=> {
          log.debug('spark %s connected with exchange %s', spark.id, amqp.ekeyFanout)
        })
      })

      return Promise.all([broadcastOk])
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

  release_conn(spark, next) {
    log.debug('releasing disconnecting connection')
    const amqp = this

    //
    // release the channel assigned to the spark so that related resources could be freed
    //
    if (spark.amqpBroadcastCh && spark.amqpBroadcastQ) {
      // unbind queue from exchange
      let ok = spark.amqpBroadcastCh.unbindQueue(spark.amqpBroadcastQ, amqp.ekeyFanout, '')
      // delete queue
      ok = ok.then(() => {
        return spark.amqpBroadcastCh.deleteQueue(spark.amqpBroadcastQ)
      })
      // close channel
      ok = ok.then(() => {
        return spark.amqpBroadcastCh.close()
      })

      ok.then(
        () => {
          delete spark.amqpBroadcastQ
          delete spark.amqpBroadcastCh
          log.debug('spark %s disconnected from exchange %s', spark.id, amqp.ekeyFanout)
          if (next) next()
        },
        (err) => {
          if (next) return next(err)
          return amqp.emit('error', err)
        })
    }

    return this
  }
}

export default Fm_Amqp
