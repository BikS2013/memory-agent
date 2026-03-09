import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig } from '../config/types.js';

/**
 * Creates a LangChain chat model instance based on the application configuration.
 *
 * @param config - Application configuration containing LLM settings from llm-config.yaml
 * @returns A configured BaseChatModel instance
 * @throws Error if the provider is not recognized or provider config is missing
 */
export function createLlm(config: AppConfig): BaseChatModel {
  const { provider, model, temperature } = config.llm;

  switch (provider) {
    case 'openai': {
      const openaiConfig = config.llm.openai;
      if (!openaiConfig) {
        throw new Error('OpenAI configuration section is missing in llm-config.yaml.');
      }
      return new ChatOpenAI({
        openAIApiKey: openaiConfig.apiKey,
        modelName: model,
        temperature,
        configuration: {
          organization: openaiConfig.organization,
          baseURL: openaiConfig.baseUrl,
        },
      });
    }

    case 'anthropic': {
      const anthropicConfig = config.llm.anthropic;
      if (!anthropicConfig) {
        throw new Error('Anthropic configuration section is missing in llm-config.yaml.');
      }
      return new ChatAnthropic({
        anthropicApiKey: anthropicConfig.apiKey,
        modelName: model,
        temperature,
        clientOptions: {
          baseURL: anthropicConfig.baseUrl,
        },
      });
    }

    case 'google': {
      const googleConfig = config.llm.google;
      if (!googleConfig) {
        throw new Error('Google configuration section is missing in llm-config.yaml.');
      }
      return new ChatGoogleGenerativeAI({
        apiKey: googleConfig.apiKey,
        model,
        temperature,
      });
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(
        `Unsupported LLM provider: "${_exhaustive}". ` +
          `Supported providers: openai, anthropic, google`
      );
    }
  }
}
