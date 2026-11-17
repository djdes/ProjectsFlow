export class PushEndpointNotSupportedError extends Error {
  constructor() {
    super('Push endpoint does not belong to a known push service');
    this.name = 'PushEndpointNotSupportedError';
  }
}
