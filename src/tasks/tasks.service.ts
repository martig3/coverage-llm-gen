import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { err, ok, Result } from 'neverthrow';
import { RepoFile } from 'src/db/schema';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { RepoService } from 'src/repo/repo.service';
import { GenaiService } from 'src/genai/genai.service';
import { GithubService } from 'src/github/github.service';
import { FilesService } from 'src/files/files.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(
    private readonly repoService: RepoService,
    private readonly fileService: FilesService,
    private readonly genAiService: GenaiService,
    private readonly githubService: GithubService,
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
    await this.fileService.updateFile({ ...file, status: 'processed' });
  }
  async handleGenerateImprovements(
    file: RepoFile,
  ): Promise<Result<void, string>> {
    this.logger.log('Starting handleGenerateImprovements');
    const repo = await this.repoService.findRepoById(file.repoId);
    if (!repo) {
      return err('Repo not found');
    }
    const repoNameResult = this.repoService.getRepoNameByUrl(repo.url);
    if (repoNameResult.isErr()) {
      return err('Repo name not found');
    }
    const repoName = repoNameResult.value;
    const filePath = file.path;
    const testFilePath = filePath.replace('.ts', '.test.ts');
    const existingPath = path.join('./repos', repoName);
    const uuid = crypto.randomUUID();
    const newPath = path.join('./repos', `${repoName}-${uuid}`);
    this.logger.log(`copying from: ${existingPath} to: ${newPath}`);
    await fs.cp(existingPath, newPath, { recursive: true });

    const execAsync = promisify(exec);
    await execAsync(`cd ${newPath} && git checkout -b enhance/tests-${uuid}`);
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
      return err('no response returned');
    }
    const newTestFilePath = path.join(newPath, testFilePath);
    this.logger.log(`writing to: ${newTestFilePath}`);
    await fs.writeFile(newTestFilePath, response, 'utf8');

    const pushResult = await this.githubService.pushChanges(
      newPath,
      `enhance/tests-${uuid}`,
      testFilePath,
      `Enhanced test coverage for ${filePath}`,
    );

    if (pushResult.isErr()) {
      return err(`Failed to push changes: ${pushResult.error}`);
    }

    const submitResult = await this.githubService.submitPR(
      newPath,
      filePath,
      uuid,
    );
    if (submitResult.isErr()) {
      return err(`PR submission failed: ${submitResult.error}`);
    }

    const updateResult = await this.fileService.updateFile({
      ...file,
      status: 'processed',
      prUrl: submitResult.value,
    });
    if (updateResult.isErr()) {
      return err(`File not updated after processing: ${updateResult.error}`);
    }

    return ok();
  }
}
