import { Injectable } from '@nestjs/common';
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

@Injectable()
export class RepoService {
  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly coverageService: CoverageService,
  ) {}
  getRepoNameFromUrl(url: string) {
    const repoName = url.split('/').pop()?.replace('.git', '') ?? '';

    if (!repoName) {
      return err('Invalid repository URL');
    }
    return ok(repoName);
  }
  async create(createRepoDto: CreateRepoDto): Promise<Result<Repo, string>> {
    const existingRepo = await this.drizzleService.db.query.repos.findFirst({
      where: eq(repos.url, createRepoDto.url),
    });
    if (existingRepo) {
      return err('Repo already exists');
    }

    const execAsync = promisify(exec);

    // this kind of processing from here on would be queued in a prod
    // environment, but here lets just do it procedurally
    try {
      await execAsync(`cd ./repos && git clone ${createRepoDto.url}`);
    } catch (error) {
      console.error(error);
      return err(`Failed to clone repository: ${error}`);
    }

    const repoName = this.getRepoNameFromUrl(createRepoDto.url);

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
    const records = await this.drizzleService.db
      .insert(repos)
      .values({ url: createRepoDto.url, id: uuid })
      .returning();

    if (records.length === 0) {
      return err('Failed to insert repo');
    }
    const record = records[0];

    return ok(record);
  }

  async remove(removeRepoDto: RemoveRepoDto): Promise<Result<null, string>> {
    // here I would also delete the repo from the file system, but I am
    // far too wary to introduce recursive folder deletion logic in a sample program
    // so feel free to just do it manually
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

  async findAll(): Promise<Repo[]> {
    return await this.drizzleService.db.query.repos.findMany();
  }
}
