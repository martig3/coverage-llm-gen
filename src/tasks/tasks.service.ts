import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { err, ok, Result } from 'neverthrow';
import { RepoFile } from 'src/db/schema';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { RepoService } from 'src/repo/repo.service';
import { GenaiService } from 'src/genai/genai.service';
import { FilesService } from 'src/files/files.service';
import { TaskProgressEvent, TaskEventType } from 'src/events/events.interface';
import { GithubService } from 'src/github/github.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(
    private readonly githubService: GithubService,
    private readonly repoService: RepoService,
    private readonly fileService: FilesService,
    private readonly genAiService: GenaiService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // main handler for handling async generations, normally this would
  // be in a job queue but I decided not to get redis involved
  // so this will work fine for demo purposes
  @Cron('* * * * * *')
  async handleGenerateImprovementsCron(): Promise<void> {
    const file = await this.fileService.findNextQueued();
    if (!file) {
      return;
    }
    this.logger.log(`starting improvements generation: ${file.path}`);
    await this.fileService.updateFile({ ...file, status: 'processing' });
    const result = await this.handleGenerateImprovements(file);
    if (result.isErr()) {
      this.logger.error(`Error generating improvements: ${result.error}`);
      await this.fileService.updateFile({ ...file, status: 'error' });
      return;
    }
  }
  async handleGenerateImprovements(
    file: RepoFile,
  ): Promise<Result<void, string>> {
    this.logger.log('Starting handleGenerateImprovements');
    const taskId = file.repoId;

    const repo = await this.repoService.findRepoById(file.repoId);
    if (!repo) {
      return err('Repo not found');
    }
    const repoNameResult = this.repoService.getRepoNameByUrl(repo.url);
    if (repoNameResult.isErr()) {
      return err('Repo name not found');
    }
    const repoName = repoNameResult.value;

    // Emit task started event
    this.eventEmitter.emit('task.started', {
      taskId,
      repoId: file.repoId,
      filePath: file.path,
      repoName,
      timestamp: new Date(),
    });
    const filePath = file.path;
    const testFilePath = filePath.replace('.ts', '.test.ts');
    const existingPath = path.join('./repos', repoName);
    const uuid = crypto.randomUUID();
    const newPath = path.join('./repos', `${repoName}-${uuid}`);

    this.emitProgress(
      taskId,
      file,
      repoName,
      TaskEventType.SETUP_REPO,
      `Setting up isolated repository copy for ${repoName}`,
    );

    this.logger.log(`copying from: ${existingPath} to: ${newPath}`);
    await fs.cp(existingPath, newPath, { recursive: true });

    const execAsync = promisify(exec);
    await execAsync(`cd ${newPath} && git checkout -b enhance/tests-${uuid}`);

    this.emitProgress(
      taskId,
      file,
      repoName,
      TaskEventType.GENERATE_SUGGESTIONS,
      `Generating AI suggestions for ${filePath}`,
    );

    const testFileContents = await fs.readFile(
      path.join(newPath, testFilePath),
      'utf8',
    );
    const fileContents = await fs.readFile(
      path.join(newPath, filePath),
      'utf8',
    );
    const response = await this.genAiService.generateSuggestions(
      testFileContents,
      fileContents,
    );

    if (!response) {
      this.emitError(
        taskId,
        file,
        repoName,
        'No response returned from AI service',
      );
      return err('no response returned');
    }
    const newTestFilePath = path.join(newPath, testFilePath);
    this.logger.log(`writing to: ${newTestFilePath}`);
    await fs.writeFile(newTestFilePath, response, 'utf8');

    this.emitProgress(
      taskId,
      file,
      repoName,
      TaskEventType.CREATE_PR,
      `Creating pull request for ${filePath}`,
    );

    const pushResult = await this.githubService.pushChanges(
      newPath,
      `enhance/tests-${uuid}`,
      testFilePath,
      `Enhanced test coverage for ${filePath}`,
    );

    if (pushResult.isErr()) {
      this.emitError(
        taskId,
        file,
        repoName,
        `Failed to push changes: ${pushResult.error}`,
      );
      return err(`Failed to push changes: ${pushResult.error}`);
    }

    const submitResult = await this.githubService.submitPR(
      newPath,
      filePath,
      uuid,
    );
    if (submitResult.isErr()) {
      this.emitError(
        taskId,
        file,
        repoName,
        `PR submission failed: ${submitResult.error}`,
      );
      return err(`PR submission failed: ${submitResult.error}`);
    }

    const updateResult = await this.fileService.updateFile({
      ...file,
      status: 'processed',
      prUrl: submitResult.value,
    });
    if (updateResult.isErr()) {
      this.emitError(
        taskId,
        file,
        repoName,
        `File not updated after processing: ${updateResult.error}`,
      );
      return err(`File not updated after processing: ${updateResult.error}`);
    }
    this.logger.log(`file updated with processed status`);

    // Emit complete event
    this.emitProgress(
      taskId,
      file,
      repoName,
      TaskEventType.COMPLETE,
      `Successfully created PR for ${filePath}`,
    );

    return ok();
  }

  private emitProgress(
    taskId: string,
    file: RepoFile,
    repoName: string,
    eventType: TaskEventType,
    message: string,
  ): void {
    const event: TaskProgressEvent = {
      taskId,
      repoId: file.repoId,
      filePath: file.path,
      repoName,
      eventType,
      message,
      timestamp: new Date(),
    };
    this.eventEmitter.emit('task.progress', event);

    // Also emit completed event when task is complete
    if (eventType === TaskEventType.COMPLETE) {
      this.eventEmitter.emit('task.completed', event);
    }
  }

  private emitError(
    taskId: string,
    file: RepoFile,
    repoName: string,
    error: string,
  ): void {
    const event: TaskProgressEvent = {
      taskId,
      repoId: file.repoId,
      filePath: file.path,
      repoName,
      eventType: TaskEventType.ERROR,
      message: error,
      timestamp: new Date(),
      metadata: { error },
    };
    this.eventEmitter.emit('task.error', event);
  }
}
