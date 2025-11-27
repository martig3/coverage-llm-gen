import { Injectable, Logger } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { err, ok, Result } from 'neverthrow';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  octokit: Octokit;
  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('GITHUB_TOKEN');
    if (!token) {
      this.logger.warn(
        'GITHUB_TOKEN not configured. GitHub API calls may fail due to authentication requirements.',
      );
    }
    this.octokit = new Octokit({
      auth: token,
    });
  }

  // this in a different env would probably not be necessary and could be
  // accomplished via just running `git push`, however I felt that since
  // we already have a github token we can remove a lot of potential complexity
  // with git/ssh setup and just push to remote this way instead
  async pushChanges(
    repoPath: string,
    branchName: string,
    filePath: string,
    commitMessage: string,
  ): Promise<Result<void, string>> {
    try {
      const execAsync = promisify(exec);
      const remoteInfo = (
        await execAsync(`cd ${repoPath} && git remote get-url origin`)
      ).stdout.trim();

      const remote = this.parseGitHubRepoInfo(remoteInfo);
      if (!remote) {
        return err(`No remote found for provided string: ${remoteInfo}`);
      }

      // Get the current commit SHA of the main branch
      let mainSha: string;
      try {
        const { data: mainRef } = await this.octokit.git.getRef({
          owner: remote.owner,
          repo: remote.repo,
          ref: 'heads/main',
        });
        mainSha = mainRef.object.sha;
      } catch (error) {
        this.logger.error(`Failed to get main branch reference: ${error}`);
        return err(`Failed to get main branch reference: ${error}`);
      }

      let baseTreeSha: string;
      try {
        const { data: mainCommit } = await this.octokit.git.getCommit({
          owner: remote.owner,
          repo: remote.repo,
          commit_sha: mainSha,
        });
        baseTreeSha = mainCommit.tree.sha;
      } catch (error) {
        this.logger.error(`Failed to get commit tree: ${error}`);
        return err(`Failed to get commit tree: ${error}`);
      }

      // Read the modified file
      const fileContent = await fs.readFile(
        path.join(repoPath, filePath),
        'utf8',
      );

      let newTreeSha: string;
      try {
        const { data: newTree } = await this.octokit.git.createTree({
          owner: remote.owner,
          repo: remote.repo,
          base_tree: baseTreeSha,
          tree: [
            {
              path: filePath.startsWith('/') ? filePath.slice(1) : filePath,
              mode: '100644',
              type: 'blob',
              content: fileContent,
            },
          ],
        });
        newTreeSha = newTree.sha;
      } catch (error) {
        this.logger.error(`Failed to create tree: ${error}`);
        return err(`Failed to create tree: ${error}`);
      }

      let newCommitSha: string;
      try {
        const { data: newCommit } = await this.octokit.git.createCommit({
          owner: remote.owner,
          repo: remote.repo,
          message: commitMessage,
          tree: newTreeSha,
          parents: [mainSha],
        });
        newCommitSha = newCommit.sha;
      } catch (error) {
        this.logger.error(`Failed to create commit: ${error}`);
        return err(`Failed to create commit: ${error}`);
      }

      try {
        await this.octokit.git.createRef({
          owner: remote.owner,
          repo: remote.repo,
          ref: `refs/heads/${branchName}`,
          sha: newCommitSha,
        });
        this.logger.log(`Branch ${branchName} created and pushed`);
      } catch (error: unknown) {
        const errorStatus = (error as { status?: number })?.status;
        if (errorStatus === 422) {
          try {
            await this.octokit.git.updateRef({
              owner: remote.owner,
              repo: remote.repo,
              ref: `heads/${branchName}`,
              sha: newCommitSha,
              force: true,
            });
            this.logger.log(`Branch ${branchName} updated and pushed`);
          } catch (updateError) {
            this.logger.error(
              `Failed to update branch reference: ${updateError}`,
            );
            return err(`Failed to update branch reference: ${updateError}`);
          }
        } else {
          this.logger.error(
            `Failed to create branch reference: ${errorStatus}`,
          );
          return err(`Failed to create branch reference: ${errorStatus}`);
        }
      }

      return ok(undefined);
    } catch (error) {
      return err(`Failed to push changes via GitHub API: ${error}`);
    }
  }

  async submitPR(
    repoPath: string,
    filePath: string,
    uuid: string,
  ): Promise<Result<string, string>> {
    try {
      const execAsync = promisify(exec);
      const remoteInfo = (
        await execAsync(`cd ${repoPath} && git remote get-url origin`)
      ).stdout.trim();
      const remote = this.parseGitHubRepoInfo(remoteInfo);
      if (!remote) {
        return err(`No remote found for provided string: ${remoteInfo}`);
      }

      const pull = {
        owner: remote.owner,
        repo: remote.repo,
        title: `Enhanced test coverage for ${filePath}`,
        body: `This pull request enhances the test coverage for ${filePath}.\n\n## Changes\n- Improved test coverage using AI-generated suggestions\n- Updated test file: ${filePath.replace('.ts', '.test.ts')}\n\n## Generated by\nAI-powered test enhancement service`,
        head: `enhance/tests-${uuid}`,
        base: 'main',
      };
      this.logger.log(`creating PR: ${JSON.stringify(pull)}`);

      try {
        const { data: pullRequest } = await this.octokit.pulls.create(pull);
        this.logger.log(`Pull request created: ${pullRequest.html_url}`);
        return ok(pullRequest.html_url);
      } catch (error) {
        this.logger.error(`Failed to create pull request: ${error}`);
        return err(`Failed to create pull request: ${error}`);
      }
    } catch (error) {
      this.logger.error(`Failed to get remote info: ${error}`);
      return err(`Failed to get remote info: ${error}`);
    }
  }
  private parseGitHubRepoInfo(remoteUrl: string) {
    // Trim any whitespace or newlines
    const cleanUrl = remoteUrl.trim();

    // Handle both HTTPS and SSH URLs
    const patterns = [
      /github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/,
      /^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/,
      /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/,
    ];

    for (const pattern of patterns) {
      const match = cleanUrl.match(pattern);
      if (match) {
        return {
          owner: match[1].trim(),
          repo: match[2].trim(),
        };
      }
    }

    return null;
  }
}
