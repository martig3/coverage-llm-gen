import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RepoService } from './repo/repo.service';
import { DrizzleService } from './drizzle/drizzle.service';
import { RepoController } from './repo/repo.controller';
import { CoverageService } from './coverage/coverage.service';
import { FilesService } from './files/files.service';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks/tasks.service';
import { GenaiService } from './genai/genai.service';
import { GithubService } from './github/github.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, RepoController],
  providers: [
    AppService,
    RepoService,
    DrizzleService,
    CoverageService,
    FilesService,
    TasksService,
    GenaiService,
    GithubService,
  ],
})
export class AppModule {}
