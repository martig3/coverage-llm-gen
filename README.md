# File Coverage PR Generator

This project analyzes github repositories and suggests test coverage improvements via LLM (Gemini) generated PRs. Includes a NestJS api + React web client for tracking the status of generated improvements.

## Setup

- Run `npm install`
- Run `cd client && npm install`
- Fill out `.env.example`
  - GEMINI_API_KEY can be generated via [https://aistudio.google.com/](https://aistudio.google.com/)
  - GITHUB_TOKEN can be generated via [https://github.com/settings/tokens](https://github.com/settings/tokens) (repository scopes R/W required)
- Run `npm run start:dev` && `cd client && npm run start:dev` OR if you have `mprocs` installed run `mprocs`

## Domain Glossary

### Bounded Contexts

1. **Repository Management** - Handles GitHub repository cloning, tracking, and lifecycle
2. **Coverage Analysis** - Processes test coverage metrics and identifies improvement opportunities  
3. **Test Enhancement** - Generates improved test suggestions using AI
4. **Pull Request Management** - Creates and tracks PRs with test improvements

### Core Domain Entities

- **Repository** (`Repo`) - Represents GitHub repository with URL and uuid 
- **Repository File** (`RepoFile`) - Individual repo source files with coverage % and task status

### Domain Services

- **RepoService** - Repository operations 
- **CoverageService** - Analyzes test coverage using `coverage-summary.json` output
- **GenaiService** - Uses Gemini API to generate enhanced test suggestions
- **GithubService** - Manages GitHub API interactions for PR creation 
- **TasksService** - Handles async workflow of test enhancement generation

### Value Objects

- **FileStatus** - Enumeration tracking file processing state 
- **CoverageSummary** - Coverage metrics data structure

### Domain Events

The system uses event-driven architecture for task progress tracking with events like `task.started`, `task.progress`, `task.completed`, and `task.error`.


## Assumptions

This project relies on the following assumptions:

- Environment has `git` installed.
- Target repositories has configured coverage to run when `npm run coverage` & outputs a `coverage/coverage-summary.json` file.
- The user has to clean up files clone/copied into `./repos`, I am far too paranoid to include recursive file/folder deletion in a sample exercise.
