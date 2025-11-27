import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
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
import { FilesController } from './files/files.controller';
import { EventsController } from './events/events.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    AppController,
    RepoController,
    FilesController,
    EventsController,
  ],
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
