import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig } from '../config/types.js';

/**
 * Creates a LangChain chat model instance based on the application configuration.
 *
 * @param config - Application configuration containing provider, model, and API key
 * @returns A configured BaseChatModel instance
 * @throws Error if the provider is not recognized
 */
export function createLlm(config: AppConfig): BaseChatModel {
  const { llmProvider, llmModel, llmApiKey } = config;

  switch (llmProvider) {
    case 'openai':
      return new ChatOpenAI({
        openAIApiKey: llmApiKey,
        modelName: llmModel,
        temperature: 0,
      });

    case 'anthropic':
      return new ChatAnthropic({
        anthropicApiKey: llmApiKey,
        modelName: llmModel,
        temperature: 0,
      });

    case 'google':
      return new ChatGoogleGenerativeAI({
        apiKey: llmApiKey,
        model: llmModel,
        temperature: 0,
      });

    default: {
      const _exhaustive: never = llmProvider;
      throw new Error(
        `Unsupported LLM provider: "${llmProvider}". ` +
          `Supported providers: openai, anthropic, google`
      );
    }
  }
}
