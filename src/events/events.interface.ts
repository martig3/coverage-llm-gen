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
  fileId: string;
  filePath: string;
  repoName: string;
  timestamp: Date;
}
