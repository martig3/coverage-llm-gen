import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { files, RepoFile, repos } from 'src/db/schema';
import { DrizzleService } from 'src/drizzle/drizzle.service';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { RepoService } from 'src/repo/repo.service';
import { GenaiService } from 'src/genai/genai.service';
import { GithubService } from 'src/github/github.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly repoService: RepoService,
    private readonly genAiService: GenaiService,
    private readonly githubService: GithubService,
  ) {}

  @Cron('5 * * * * *')
  async handleGenerateImprovementsCron(): Promise<void> {
    const file = await this.drizzleService.db.query.files.findFirst({
      where: eq(files.status, 'queued'),
    });

    if (!file) {
      this.logger.log('no files queued for improvements');
      return;
    }
    await this.drizzleService.db
      .update(files)
      .set({ status: 'processing' })
      .where(eq(files.path, file.path));
    const result = await this.handleGenerateImprovements(file);
    if (result.isErr()) {
      this.logger.error('Error generating improvements', result.error);
      await this.drizzleService.db
        .update(files)
        .set({ status: 'error' })
        .where(eq(files.path, file.path));
      return;
    }
    await this.drizzleService.db
      .update(files)
      .set({ status: 'processed' })
      .where(eq(files.path, file.path));
  }
  async handleGenerateImprovements(
    file: RepoFile,
  ): Promise<Result<void, string>> {
    this.logger.log('Starting handleGenerateImprovements');
    const repo = await this.drizzleService.db.query.repos.findFirst({
      where: eq(repos.id, file.repoId),
    });
    if (!repo) {
      return err('Repo not found');
    }
    const repoNameResult = this.repoService.getRepoNameFromUrl(repo.url);
    if (repoNameResult.isErr()) {
      return err('Repo name not found');
    }
    const repoName = repoNameResult.value;
    const filePath = file.path;
    const existingPath = path.join('./repos', repoName);
    const uuid = crypto.randomUUID();
    const newPath = path.join('./repos', `${repoName}-${uuid}`);
    await fs.cp(existingPath, newPath, { recursive: true });

    const execAsync = promisify(exec);
    await execAsync(`cd ${newPath} && git checkout -b enhance/tests-${uuid} `);
    const testFileContents = await fs.readFile(
      path.join(newPath, filePath.replace('.ts', '.test.ts')),
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
    await fs.writeFile(
      path.join(newPath, filePath.replace('.ts', '.test.ts')),
      response,
      'utf8',
    );
    await execAsync(
      `cd ${newPath} && git add . && git commit -m "Enhanced test coverage for ${filePath}" && git push origin enhance/tests-${uuid}`,
    );

    const submitResult = await this.githubService.submitPR(
      newPath,
      filePath,
      uuid,
    );
    if (submitResult.isErr()) {
      return err(`PR submission failed: ${submitResult.error}`);
    }

    return ok();
  }
}
