export function ValidationError(message) {
  this.name = 'ValidationError'
  this.message = message || 'validation error'
  this.stack = (new Error(this.message)).stack
}
ValidationError.prototype = Object.create(Error.prototype)
ValidationError.prototype.constructor = ValidationError

export function RepositoryError(message) {
  this.name = 'RepositoryError'
  this.message = message || 'repository error'
  this.stack = (new Error(this.message)).stack
}
RepositoryError.prototype = Object.create(Error.prototype)
RepositoryError.prototype.constructor = RepositoryError

export function StorageError(message) {
  this.name = 'StorageError'
  this.message = message || 'storage error'
  this.stack = (new Error(this.message)).stack
}
StorageError.prototype = Object.create(Error.prototype)
StorageError.prototype.constructor = StorageError

export function SessionMissingError(message) {
  this.name = 'SessionMissingError'
  this.message = message || 'session not found'
  this.stack = (new Error(this.message)).stack
}
SessionMissingError.prototype = Object.create(Error.prototype)
SessionMissingError.prototype.constructor = SessionMissingError

export function InvalidTokenError(message) {
  this.name = 'InvalidTokenError'
  this.message = message || 'invalid token'
  this.stack = (new Error(this.message)).stack
}
InvalidTokenError.prototype = Object.create(Error.prototype)
InvalidTokenError.prototype.constructor = InvalidTokenError
