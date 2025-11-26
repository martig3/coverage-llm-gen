import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GenaiService {
  ai: GoogleGenAI;
  octokit: Octokit;

  constructor() {
    this.ai = new GoogleGenAI({});
  }

  async generateSuggestions(
    testFileContents: string,
    fileContents: string,
  ): Promise<string | undefined> {
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Take the contents of this test file and modify them to increase coverage, ONLY return the code, do not add any comments or extra text, do not reply with any other confirmation just ONLY return typescript code: \n ${testFileContents} \n here is the source file the test file is testing: ${fileContents}`,
      config: {
        candidateCount: 1,
      },
    });
    console.log(response.executableCode);
    return response.executableCode;
  }
}
