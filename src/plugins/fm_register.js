'use strict'

import fs from 'fs'
import path from 'path'
import logger from '../utils/logger'
import EventEmitter from 'events'
import Events from '../events'

const log = logger.child({module: 'fm_register'})

class Fm_Register extends EventEmitter {
  constructor(primus, options) {
    super()

    log.debug('initializing primus fm register plugin...')

    // validate options
    primus = primus || {}
    options = options || {}
    if (!options.redis) throw new Error('please provide an ioredis connection through options')
    if (!options.fm && !options.fm.id) throw new Error('please provide fm with a valid id through options')

    // parse options and set defaults
    this.redis = options.redis
    this.namespace = (options.namespace || 'mkm:fm_register') + ':'
    this.interval = options.interval || 5 * 60 * 1000
    this.latency = options.latency || 2000

    // define redis annihilate custom command
    let lua = fs.readFileSync(path.join(__dirname, 'fm_register_annihilate.lua'), 'utf8')
    this.redis.defineCommand('annihilate', {
      lua: lua.replace('{leverage::namespace}', this.namespace),
      numberOfKeys: 1
    })

    // prepare redis keys
    this.rkeyFmKeepAlive = this.namespace + options.fm.id + ':alive'
    this.rkeyFmCount = this.namespace + options.fm.id + ':count'
    this.rkeyFm = this.namespace + 'fm:' + options.fm.id
    this.rkeyFms = this.namespace + 'fms'
  }

  setup_server(fm, cb) {
    const register = this
    const redis = this.redis

    if (!fm && !fm.id) {
      let err = new Error('please provide fm with a valid id')
      if (cb) return cb(err)
      return register.emit('error', err)
    }

    log.debug('setting up fm server %s', fm.id)

    log.debug('cleaning up registration references related to fm server %s', fm.id)
    redis.annihilate(fm.id, (err, result) => {
      if (err) {
        log.error(err)
        if (cb) return cb(err)
        return register.emit('error', err)
      }

      log.debug('setting up registration references related to fm server %s', fm.id)
      redis.multi()
        .psetex(register.rkeyFmKeepAlive, register.interval, Date.now())
        .sadd(register.rkeyFms, fm.id)
        .hmset(register.rkeyFm, 'id', fm.id, 'ip', fm.ip, 'port', fm.port)
        .exec((err) => {
          if (err) {
            if (cb) return cb(err)
            return register.emit('error', err)
          }

          register.emit(Events.FM_REGISTERED, fm.id)
          register.keepAlive()
        })
    })

    // mark that fm has been setup
    register.fm = fm

    return this
  }

  release_server(fm, cb) {
    const register = this
    const redis = this.redis

    fm = fm || register.fm
    if (!fm) {
      if (cb) cb()
      return this
    }

    log.debug('releasing fm server %s', fm.id)

    redis.annihilate(fm.id, (err, result) => {
      if (err) {
        if (cb) return cb(err)
        return register.emit('error', err)
      }

      register.emit(Events.FM_UNREGISTERED, fm.id)

      clearInterval(register.timer)
      if (cb) cb(err, fm.id)
    })

    return this
  }

  // return registered front machines
  fms(inclusive, cb) {
    const register = this
    const redis = this.redis

    if ('boolean' !== typeof inclusive) {
      cb = inclusive
      inclusive = false
    }

    redis.smembers(register.rkeyFms, (err, fms) => {
      if (inclusive) return cb(err, fms)

      cb(err, (fms || []).filter((fm) => {
        return fm !== register.fm.id
      }))
    })

    return this
  }

  setup_conn(spark, cb) {
    log.debug('setting up new connection')
    const register = this
    const redis = this.redis

    redis.incr(register.rkeyFmCount, (err) => {
      log.debug('connection %s setup', spark.id)
    })

    return this
  }

  release_conn(spark, cb) {
    log.debug('releasing disconnecting connection')
    const register = this
    const redis = this.redis

    redis.decr(register.rkeyFmCount, (err) => {
      log.debug('connection %s released', spark.id)
    })

    return this
  }

  // refresh keep alive flag
  keepAlive() {
    log.debug('setting up fm server keep alive')
    const register = this
    const redis = this.redis

    clearInterval(this.timer)

    this.timer = setInterval(() => {
      log.debug('refresh fm server %s keep alive', register.fm.id)
      redis.psetex(register.rkeyFmKeepAlive, register.interval, Date.now())

      // if I ever go down, my brother will help clear up my mess
      register.fms(false, (err, other_fms) => {
        if (err) return register.emit('error', err)

        other_fms.forEach((fm) => {
          redis.exists(register.namespace + fm + ':alive', (err, isExist) => {
            if (err) return register.emit('error', err)
            // if keep alive key exists, then probably this fm is still alive
            if (isExist) return

            // if not, then I'll help clean it up
            log.debug('fm server %s gone, performing clean up from %s', fm, register.fm.id)
            redis.annihilate(fm, (err) => {
              if (err) return register.emit('error', err)
            })
          })
        })
      })
    }, this.interval - this.latency)
  }
}

export default Fm_Register
