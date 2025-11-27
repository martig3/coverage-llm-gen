import { useState } from 'react';
import { Link, useRevalidator } from 'react-router';
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  Loader2,
  Loader2Icon,
} from 'lucide-react';
import { Card, CardDescription, CardTitle } from '~/components/ui/card';
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  ItemMedia,
  ItemSeparator,
} from '~/components/ui/item';
import type { Route } from './+types/files';
import { API_BASE_URL } from '~/lib/base-url';
import { Button } from '~/components/ui/button';
import {
  useSSE,
  useSSEEvent,
  TaskEventType,
  type TaskProgressEvent,
  isTaskProgressEvent,
  type TaskStartedEvent,
  type TaskErrorEvent,
} from '~/contexts/SSEContext';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const files = (await (
    await fetch(`${API_BASE_URL}/repo/${params.repoId}/files`)
  ).json()) as {
    path: string;
    coverage: number;
    prUrl?: string;
  }[];
  return { files };
}
export default function Files({ loaderData }: Route.ComponentProps) {
  const { files } = loaderData;
  const revalidator = useRevalidator();
  const [taskProgress, setTaskProgress] = useState<
    Record<string, TaskProgressEvent>
  >({});
  const [activeFiles, setActiveFiles] = useState<Set<string>>(new Set());

  // Listen for task progress events
  useSSEEvent('task-progress', (data) => {
    if (isTaskProgressEvent(data)) {
      console.log('Task progress update:', data);

      setTaskProgress((prev) => ({
        ...prev,
        [data.filePath]: data,
      }));

      // Handle specific event types
      switch (data.eventType) {
        case TaskEventType.SETUP_REPO:
          console.log(`Setting up repo for ${data.repoName}`);
          break;
        case TaskEventType.GENERATE_SUGGESTIONS:
          console.log(`Generating suggestions for ${data.filePath}`);
          break;
        case TaskEventType.CREATE_PR:
          console.log(`Creating PR for ${data.filePath}`);
          break;
        case TaskEventType.COMPLETE:
          console.log(`Task completed for ${data.filePath}`);
          // Remove from active files
          setActiveFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(data.filePath);
            return newSet;
          });
          void revalidator.revalidate();
          break;
      }
    }
  });

  // Listen for task started events
  useSSEEvent('task-started', (data: TaskStartedEvent) => {
    console.log('Task started:', data);
    setActiveFiles((prev) => new Set([...prev, data.filePath]));
  });

  // Listen for task error events
  useSSEEvent('task-error', (data: TaskErrorEvent) => {
    console.error('Task error:', data);
    setActiveFiles((prev) => {
      const newSet = new Set(prev);
      newSet.delete(data.filePath);
      return newSet;
    });

    // Log error details
    if (data.metadata?.error) {
      console.error(`Error details: ${data.metadata.error}`);
    }
  });

  return (
    <Card className="p-8">
      <CardTitle className="flex items-center gap-2">
        <Link to="/">
          <ArrowLeftIcon />
        </Link>{' '}
        Files
      </CardTitle>
      <CardDescription>{`Files with <=80% coverage`}</CardDescription>
      {files.map((f) => (
        <Item
          variant="outline"
          size="sm"
          key={f.path}
          className="min-w-[400px]"
        >
          <ItemContent>
            <ItemTitle>{f.path}</ItemTitle>
          </ItemContent>
          <div className="mx-4"></div>
          <ItemActions>
            <ItemMedia
              className={f.coverage > 60 ? 'text-orange-500' : 'text-red-500'}
            >
              {f.coverage}%
            </ItemMedia>
            {!f.prUrl ? (
              <Button
                variant="outline"
                disabled={
                  activeFiles.has(f.path) && taskProgress[f.path] !== undefined
                }
              >
                {activeFiles.has(f.path) && taskProgress[f.path] ? (
                  <div className="flex gap-2 items-center">
                    Generating <Loader2 className="animate-spin" />
                  </div>
                ) : (
                  'Generate'
                )}
              </Button>
            ) : (
              <a href={f.prUrl} target="_blank">
                <Button variant="link">
                  View PR <ExternalLinkIcon />
                </Button>
              </a>
            )}
          </ItemActions>
          {f.prUrl && (
            <>
              <ItemSeparator />
              <span className="text-sm text-muted-foreground">
                {'✅ Completed'}
              </span>
            </>
          )}
          {activeFiles.has(f.path) && taskProgress[f.path] && (
            <>
              <ItemSeparator />
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="animate-spin size-4" />
                {(() => {
                  const progress = taskProgress[f.path];
                  switch (progress.eventType) {
                    case TaskEventType.SETUP_REPO:
                      return '🔧 Setting up repository...';
                    case TaskEventType.GENERATE_SUGGESTIONS:
                      return '🤖 Generating suggestions...';
                    case TaskEventType.CREATE_PR:
                      return '🔀 Creating pull request...';
                    case TaskEventType.COMPLETE:
                      return '✅ Completed';
                    case TaskEventType.ERROR:
                      return '❌ Error occurred';
                    default:
                      return '⏳ Processing...';
                  }
                })()}
              </span>
            </>
          )}
        </Item>
      ))}
    </Card>
  );
}
