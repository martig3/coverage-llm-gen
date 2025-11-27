import { Controller, Sse, MessageEvent, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent, merge, map, interval } from 'rxjs';

@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private eventEmitter: EventEmitter2) {}

  @Sse('sse')
  streamAllEvents(): Observable<MessageEvent> {
    this.logger.log('Client connected to SSE stream');

    // Create observables for each event type
    const taskProgress$ = fromEvent(this.eventEmitter, 'task.progress').pipe(
      map(
        (data) =>
          ({
            type: 'task-progress',
            data: JSON.stringify(data),
          }) as MessageEvent,
      ),
    );

    const taskStarted$ = fromEvent(this.eventEmitter, 'task.started').pipe(
      map(
        (data) =>
          ({
            type: 'task-started',
            data: JSON.stringify(data),
          }) as MessageEvent,
      ),
    );

    const taskCompleted$ = fromEvent(this.eventEmitter, 'task.completed').pipe(
      map(
        (data) =>
          ({
            type: 'task-completed',
            data: JSON.stringify(data),
          }) as MessageEvent,
      ),
    );

    const taskError$ = fromEvent(this.eventEmitter, 'task.error').pipe(
      map(
        (data) =>
          ({
            type: 'task-error',
            data: JSON.stringify(data),
          }) as MessageEvent,
      ),
    );

    // Heartbeat to keep connection alive
    const heartbeat$ = interval(30000).pipe(
      map(
        () =>
          ({
            type: 'heartbeat',
            data: JSON.stringify({ timestamp: new Date() }),
          }) as MessageEvent,
      ),
    );

    // Merge all event streams
    return merge(
      taskProgress$,
      taskStarted$,
      taskCompleted$,
      taskError$,
      heartbeat$,
    );
  }
}
