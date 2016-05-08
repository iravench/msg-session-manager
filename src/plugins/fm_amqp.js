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
    this.ekeyTopic = this.namespace + 'ibc.personal'
    // prepare personal routing key
    this.rkeyPersonal = this.namespace + 'ibc.personal.'
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
      // create the broadcast channel for the spark instance
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

      // create the personal channel for the spark instance
      let personalOk = conn.createChannel().then((ch) => {
        // hold on to channel so we can later close it when spark exits
        spark.amqpPersonalCh = ch
        // make sure the topic exchagne for personal message exists
        // upon receiving matched backend messages, deliver through spark
        // the exchange used to personal message dont have to be durable
        let ok = ch.assertExchange(amqp.ekeyTopic, 'topic', { durable: false })
        // make sure the temporary queue exists
        // the reason of temporary queue is that when this amqp connection closed
        // these queues get close as well
        ok = ok.then(() => {
          return ch.assertQueue('', {exclusive: true})
        })
        // bind queue to exchange
        ok = ok.then((qok) => {
          let personalRoutingKey = amqp.rkeyPersonal + spark.user.user_id
          return ch.bindQueue(qok.queue, amqp.ekeyTopic, personalRoutingKey).then(() => {
            return spark.amqpPersonalQ = qok.queue
          })
        })
        // consume backend message and send out to bc via spake
        ok = ok.then((queue) => {
          return ch.consume(queue, (msg) => {
            if (msg && msg.content)
              spark.send(Events.MSG_IBC_PERSONAL, msg.content.toString())
          }, { noAck: true })
        })

        return ok.then(()=> {
          log.debug('spark %s connected with exchange %s', spark.id, amqp.ekeyTopic)
        })
      })

      return Promise.all([broadcastOk, personalOk])
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

    let allOk = []

    if (spark.amqpBroadcastCh && spark.amqpBroadcastQ)
      allOk.push(closeChannel(spark.amqpBroadcastCh, amqp.ekeyFanout, spark.amqpBroadcastQ))

    if (spark.amqpPersonalCh && spark.amqpPersonalQ)
      allOk.push(closeChannel(spark.amqpPersonalCh, amqp.ekeyTopic, spark.amqpPersonalQ))

    Promise.all(allOk).then(
        () => {
          log.debug('spark %s disconnected from exchange %s and %s', spark.id, amqp.ekeyFanout, amqp.ekeyTopic)
          delete spark.amqpBroadcastQ
          delete spark.amqpBroadcastCh
          delete spark.amqpPersonalQ
          delete spark.amqpPersonalCh
          if (next) next()
        },
        (err) => {
          if (next) return next(err)
          return amqp.emit('error', err)
        })

    return this
  }
}

// release the channel assigned to the spark
// so that related resources could be freed
function closeChannel(channel, exchange, queue) {
  // unbind queue from exchange
  let ok = channel.unbindQueue(queue, exchange, '')
  // delete queue
  ok = ok.then(() => {
    return channel.deleteQueue(queue)
  })
  // close channel
  return ok.then(() => {
    return channel.close()
  })
}

export default Fm_Amqp
