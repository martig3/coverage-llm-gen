import { Injectable, Logger } from '@nestjs/common';
import { err, fromThrowable, ok, Result } from 'neverthrow';
import path from 'path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { constants } from 'node:fs/promises';
import { CoverageSummary } from './coverage.interface';
import { RepoFile } from 'src/db/schema';
import { UUID } from 'node:crypto';
import { FilesService } from 'src/files/files.service';

@Injectable()
export class CoverageService {
  private readonly logger = new Logger(CoverageService.name);
  constructor(private readonly filesService: FilesService) {}
  async processRepoCoverage(
    repoName: string,
    repoId: UUID,
  ): Promise<Result<void, string>> {
    const repoPath = path.join('./repos', repoName);

    const isPnpm = (await fs.readdir(repoPath)).some(
      (f) => f === 'pnpm-lock.yaml',
    );
    const packageMangager = isPnpm ? 'pnpm' : 'npm';
    const execAsync = promisify(exec);
    try {
      await execAsync(
        `cd ${repoPath} && ${packageMangager} install && ${packageMangager} run coverage`,
      );
    } catch (error) {
      this.logger.error(`Failed to run coverage on repository: ${error}`);
      return err(`Failed to run coverage on repository: ${error}`);
    }

    // this assumes the coverage-summary option is configured in the target repo
    const coveragePath = path.join(
      repoPath,
      'coverage',
      'coverage-summary.json',
    );

    try {
      await fs.access(coveragePath, constants.R_OK);
    } catch (e) {
      this.logger.error(`Failed to access coverage file: ${e}`);
      return err(`Failed to access coverage file: ${e}`);
    }
    const coverageString = await fs.readFile(coveragePath, {
      encoding: 'utf-8',
    });

    // trying this out here for fun
    const safeParse = fromThrowable(JSON.parse);
    // wish I could provide an expected ok type here...
    const parseResult = safeParse(coverageString);

    if (parseResult.isErr()) {
      return err(
        `Failed to parse coverage JSON: ${parseResult.error as string}`,
      );
    }

    const coverageJSON = parseResult.value as CoverageSummary;

    const coverageFiles = Object.keys(coverageJSON)
      .filter((k) => k !== 'total')
      .map(
        (k) =>
          ({
            path: k.split(repoName)[1],
            coverage: Number.parseInt(coverageJSON[k].lines.pct.toString()),
            status: 'default',
            prUrl: null,
            repoId,
          }) satisfies RepoFile,
      );

    const insertResult = await this.filesService.insertManyFiles(coverageFiles);
    if (insertResult.isErr()) {
      return err(`Failed to insert coverage files: ${insertResult.error}`);
    }

    return ok();
  }
}
