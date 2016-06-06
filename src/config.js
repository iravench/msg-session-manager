'use strict'

import { execSync } from 'child_process'

function isDebug() {
  const debug = process.env.DEBUG
  if (debug) {
    if (debug == 'false' || debug == '0') return false
    return true
  }
  return false
}

function get_local_vm_ip() {
  if (env === 'development') {
    const cmd = 'docker-machine ip local'
    return execSync(cmd).toString().trim()
  }
  return
}

const env = process.env.NODE_ENV || 'development'
const debug = isDebug()
const local_vm_ip = get_local_vm_ip()
const secret = process.env.JWT_SECRET || '1234567890'
const port = process.env.PORT || 9090
const fm_id = process.env.FM_ID || 'fm-1'
const fm_ip = process.env.FM_IP || '127.0.0.1'
const fm_port = process.env.FM_PORT || 9090
const redis_ip = process.env.REDIS_IP || local_vm_ip
const mysql_ip = process.env.MYSQL_IP || local_vm_ip
const rabbit_ip = process.env.RABBIT_IP || local_vm_ip

//TBD should be further customized based on running environment
export default {
  env: env,
  debug: debug,
  applicationName: "msg-session-manager",
  port: port,
  primus: {
    mirage_timeout: 5000,  // timespan in seconds btw socket connect and authenticate, timeout cause disconnect
    register_namespace: "mkm",
    register_interval: 120000,
    register_latency: 5000,
    amqp_namespace: "mkm"
  },
  jwt: {
    algorithm: "HS256",    // signature and hash algorithm
    secret: secret,        // secret for signature signing and verification. can be replaced with certificate.
    audience: "ibc",       // target the token is issued for
    subject: "fm auth",    // subject the token is issued for
    issuer: "bex msg"      // issuer of the token
  },
  storage: {
    redis: {
      host: redis_ip,
      port: 6379,
      family: 4,
      password: "pink5678",
      db: 0
    },
    mysql: {
      host: mysql_ip,
      port: 3306,
      database: "bex-msg",
      user: "pink",
      password: "5678"
    },
    rabbit: {
      host: rabbit_ip,
      port: 5672
    }
  },
  fm: {
    id: fm_id,
    ip: fm_ip,
    port: fm_port
  }
}
