import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { API_BASE_URL } from '~/lib/base-url';

// Event types based on the backend controller
export type SSEEventType =
  | 'task-progress'
  | 'task-started'
  | 'task-completed'
  | 'task-error'
  | 'heartbeat';

export interface SSEEvent {
  type: SSEEventType;
  data: any;
}

export enum TaskEventType {
  SETUP_REPO = 'setup-repo',
  GENERATE_SUGGESTIONS = 'generate-suggestions',
  CREATE_PR = 'create-pr',
  COMPLETE = 'complete',
  ERROR = 'error',
}

export interface TaskProgressEvent {
  taskId: string;
  repoId: string;
  filePath: string;
  repoName: string;
  eventType: TaskEventType;
  message: string;
  timestamp: Date;
  metadata?: {
    prUrl?: string;
    error?: string;
    [key: string]: any;
  };
}

export interface TaskStartedEvent {
  taskId: string;
  repoId: string;
  filePath: string;
  repoName: string;
  timestamp: Date;
}

export interface TaskCompletedEvent extends TaskProgressEvent {
  eventType: TaskEventType.COMPLETE;
}

export interface TaskErrorEvent extends TaskProgressEvent {
  eventType: TaskEventType.ERROR;
  metadata: {
    error: string;
    [key: string]: any;
  };
}

export interface HeartbeatEvent {
  timestamp: Date;
}

type EventListener = (event: SSEEvent) => void;

interface SSEContextType {
  isConnected: boolean;
  addEventListener: (type: SSEEventType, listener: EventListener) => () => void;
  removeEventListener: (type: SSEEventType, listener: EventListener) => void;
  lastEvent: SSEEvent | null;
  connectionError: Error | null;
}

const SSEContext = createContext<SSEContextType | undefined>(undefined);

interface SSEProviderProps {
  children: ReactNode;
  sseUrl?: string;
}

export const SSEProvider: React.FC<SSEProviderProps> = ({
  children,
  sseUrl = `${API_BASE_URL}/events/sse`,
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [connectionError, setConnectionError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<SSEEventType, Set<EventListener>>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>(undefined);
  const reconnectAttemptsRef = useRef(0);

  const notifyListeners = useCallback((event: SSEEvent) => {
    const listeners = listenersRef.current.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${event.type}:`, error);
        }
      });
    }
  }, []);

  const addEventListener = useCallback(
    (type: SSEEventType, listener: EventListener): (() => void) => {
      if (!listenersRef.current.has(type)) {
        listenersRef.current.set(type, new Set());
      }
      listenersRef.current.get(type)!.add(listener);

      // Return unsubscribe function
      return () => {
        removeEventListener(type, listener);
      };
    },
    [],
  );

  const removeEventListener = useCallback(
    (type: SSEEventType, listener: EventListener) => {
      const listeners = listenersRef.current.get(type);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersRef.current.delete(type);
        }
      }
    },
    [],
  );

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('SSE connection established');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        setIsConnected(false);
        setConnectionError(new Error('SSE connection failed'));

        // Implement exponential backoff for reconnection
        const backoffDelay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current),
          30000,
        );
        reconnectAttemptsRef.current++;

        console.log(`Attempting to reconnect in ${backoffDelay}ms...`);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, backoffDelay);
      };

      // Listen for specific event types
      const eventTypes: SSEEventType[] = [
        'task-progress',
        'task-started',
        'task-completed',
        'task-error',
        'heartbeat',
      ];

      eventTypes.forEach((eventType) => {
        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            const sseEvent: SSEEvent = {
              type: eventType,
              data,
            };

            setLastEvent(sseEvent);
            notifyListeners(sseEvent);
          } catch (error) {
            console.error(`Error parsing SSE event ${eventType}:`, error);
          }
        });
      });
    } catch (error) {
      console.error('Error creating EventSource:', error);
      setConnectionError(error as Error);
    }
  }, [sseUrl, notifyListeners]);

  useEffect(() => {
    connect();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
    };
  }, [connect]);

  const contextValue: SSEContextType = {
    isConnected,
    addEventListener,
    removeEventListener,
    lastEvent,
    connectionError,
  };

  return (
    <SSEContext.Provider value={contextValue}>{children}</SSEContext.Provider>
  );
};

// Custom hook to use the SSE context
export const useSSE = (): SSEContextType => {
  const context = useContext(SSEContext);
  if (!context) {
    throw new Error('useSSE must be used within an SSEProvider');
  }
  return context;
};

// Convenience hook to listen to a specific event type
export const useSSEEvent = (
  eventType: SSEEventType,
  handler: (data: any) => void,
  dependencies: React.DependencyList = [],
) => {
  const { addEventListener } = useSSE();

  useEffect(() => {
    const listener = (event: SSEEvent) => {
      if (event.type === eventType) {
        handler(event.data);
      }
    };

    const unsubscribe = addEventListener(eventType, listener);
    return unsubscribe;
  }, [eventType, addEventListener, ...dependencies]);
};

// disclaimer:
// these type guards are horrific, I would just use a zod schema to validate in the real world
export const isTaskProgressEvent = (data: any): data is TaskProgressEvent => {
  return (
    data &&
    typeof data.taskId === 'string' &&
    typeof data.repoId === 'string' &&
    typeof data.filePath === 'string' &&
    typeof data.repoName === 'string' &&
    data.eventType !== undefined &&
    typeof data.message === 'string'
  );
};

export const isTaskStartedEvent = (data: any): data is TaskStartedEvent => {
  return (
    data &&
    typeof data.taskId === 'string' &&
    typeof data.repoId === 'string' &&
    typeof data.filePath === 'string' &&
    typeof data.repoName === 'string'
  );
};

export const isTaskCompletedEvent = (data: any): data is TaskCompletedEvent => {
  return isTaskProgressEvent(data) && data.eventType === TaskEventType.COMPLETE;
};

export const isTaskErrorEvent = (data: any): data is TaskErrorEvent => {
  return (
    isTaskProgressEvent(data) &&
    data.eventType === TaskEventType.ERROR &&
    data.metadata?.error !== undefined
  );
};

export const isHeartbeatEvent = (data: any): data is HeartbeatEvent => {
  return data && data.timestamp;
};
