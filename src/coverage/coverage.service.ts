import { Injectable } from '@nestjs/common';
import { err, fromThrowable, ok, Result } from 'neverthrow';
import path from 'path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { constants } from 'node:fs/promises';
import { CoverageSummary } from './coverage.interface';
import { DrizzleService } from 'src/drizzle/drizzle.service';
import { files } from 'src/db/schema';
import { UUID } from 'node:crypto';

@Injectable()
export class CoverageService {
  constructor(private readonly drizzleService: DrizzleService) {}
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
      console.error(error);
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
      console.error(e);
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
      .map((k) => ({
        path: k.split(repoName)[1],
        coverage: Number.parseInt(coverageJSON[k].lines.pct.toString()),
      }));

    try {
      await this.drizzleService.db.transaction(async (tx) => {
        // this would be batched to avoid spamming the DB ideally,
        // but I'm going to keep it simple here
        const fileInserts = await Promise.all(
          coverageFiles.map(async (file) => {
            const result = await tx.insert(files).values({ ...file, repoId });
            if (result.rowsAffected == 0) {
              return err(`Failed to insert file path ${file.path}`);
            }
            return ok(result);
          }),
        );
        if (fileInserts.some((result) => result.isErr())) {
          tx.rollback();
          return err('Failed to insert some file paths');
        }
      });
    } catch (error) {
      return err(`Transaction failed: ${error}`);
    }
    return ok();
  }
}
