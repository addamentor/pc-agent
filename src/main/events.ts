import { EventEmitter } from 'node:events'

/** Main-process event bus. 'changed' tells open windows to refetch; 'wake-scheduled' re-arms the scheduler. */
export const bus = new EventEmitter()

export const emitChanged = (): boolean => bus.emit('changed')
