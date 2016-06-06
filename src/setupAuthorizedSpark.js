'use strict'

import logger from './utils/logger'

const log = logger.child({ module: 'setupAuthorizedSpark' })

export default (spark) => {
  spark.send('hello', { data: "how are you?" })

  spark.on('howdy', (data) => {
    log.info(data, 'client event received')
  })
}
