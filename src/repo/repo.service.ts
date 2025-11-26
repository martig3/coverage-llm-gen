import { Injectable, Logger } from '@nestjs/common';
import { Repo } from './repo.interface';
import { CreateRepoDto } from './dto/create-repo';
import { DrizzleService } from 'src/drizzle/drizzle.service';
import { files, repos } from 'src/db/schema';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { RemoveRepoDto } from './dto/remove-repo';
import { CoverageService } from 'src/coverage/coverage.service';
import { UUID } from 'node:crypto';

@Injectable()
export class RepoService {
  private readonly logger = new Logger(RepoService.name);
  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly coverageService: CoverageService,
  ) {}
  getRepoNameByUrl(url: string) {
    const repoName = url.split('/').pop()?.replace('.git', '') ?? '';

    if (!repoName) {
      return err('Invalid repository URL');
    }
    return ok(repoName);
  }
  async findRepoByUrl(url: string) {
    return await this.drizzleService.db.query.repos.findFirst({
      where: eq(repos.url, url),
    });
  }
  async findRepoById(id: UUID) {
    return await this.drizzleService.db.query.repos.findFirst({
      where: eq(repos.id, id),
    });
  }
  async findAll(): Promise<Repo[]> {
    return await this.drizzleService.db.query.repos.findMany();
  }
  async insertRepo(newRepo: Repo) {
    const records = await this.drizzleService.db
      .insert(repos)
      .values(newRepo)
      .returning();
    return records?.[0];
  }
  async create(createRepoDto: CreateRepoDto): Promise<Result<Repo, string>> {
    const existingRepo = await this.findRepoByUrl(createRepoDto.url);
    if (existingRepo) {
      return err('Repo already exists');
    }

    const execAsync = promisify(exec);

    // this kind of processing from here on would be queued in a prod
    // environment, but here lets just do it procedurally
    try {
      await execAsync(`cd ./repos && git clone ${createRepoDto.url}`);
    } catch (error) {
      this.logger.error(`Failed to clone repository: ${error}`);
      return err(`Failed to clone repository: ${error}`);
    }

    const repoName = this.getRepoNameByUrl(createRepoDto.url);

    if (repoName.isErr()) {
      return err(repoName.error);
    }

    const uuid = crypto.randomUUID();

    const coverageResult = await this.coverageService.processRepoCoverage(
      repoName.value,
      uuid,
    );
    if (coverageResult.isErr()) {
      return err(`Failed to process coverage: \n${coverageResult.error}`);
    }
    const insertRecord = await this.insertRepo({
      url: createRepoDto.url,
      id: uuid,
    });

    if (!insertRecord) {
      return err('Failed to insert repo');
    }

    return ok(insertRecord);
  }

  async remove(removeRepoDto: RemoveRepoDto): Promise<Result<null, string>> {
    // here I would also delete the repo from the file system, but I am
    // far too wary to introduce recursive dir deletion logic in a sample program
    // so feel free to just do it manually, this is mostly a utility function for testing
    const results = await this.drizzleService.db
      .delete(repos)
      .where(eq(repos.url, removeRepoDto.url))
      .returning();

    const result = results[0];
    await this.drizzleService.db
      .delete(files)
      .where(eq(files.repoId, result.id));
    return ok(null);
  }
}
