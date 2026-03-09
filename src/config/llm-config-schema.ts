import { z } from 'zod';

// --- Sub-schemas for each LLM provider ---

const openaiProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'openai.apiKey is required'),
  organization: z.string().min(1).optional(), // OPTIONAL: exception to no-fallback rule
  baseUrl: z.string().url().optional(),        // OPTIONAL: exception to no-fallback rule
});

const anthropicProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'anthropic.apiKey is required'),
  baseUrl: z.string().url().optional(), // OPTIONAL: exception to no-fallback rule
});

const googleProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'google.apiKey is required'),
});

// --- Top-level LLM config schema with conditional validation ---

const llmProviderEnum = z.enum(['openai', 'anthropic', 'google']);

export const llmConfigSchema = z
  .object({
    llm: z.object({
      provider: llmProviderEnum,
      temperature: z
        .number({ required_error: 'llm.temperature is required' })
        .min(0.0, 'temperature must be >= 0.0')
        .max(2.0, 'temperature must be <= 2.0'),
      model: z.string().min(1, 'llm.model is required'),
      openai: openaiProviderConfigSchema.optional(),
      anthropic: anthropicProviderConfigSchema.optional(),
      google: googleProviderConfigSchema.optional(),
    }),
  })
  .refine(
    (data) => {
      const p = data.llm.provider;
      if (p === 'openai') return data.llm.openai !== undefined;
      if (p === 'anthropic') return data.llm.anthropic !== undefined;
      if (p === 'google') return data.llm.google !== undefined;
      return false;
    },
    {
      message:
        'The configuration section for the active LLM provider is missing. ' +
        'Ensure the YAML contains the section matching the selected provider.',
    }
  );

export type LlmConfigYaml = z.infer<typeof llmConfigSchema>;

/**
 * Parses and validates raw YAML content against the LLM config schema.
 * Throws a descriptive error if validation fails.
 *
 * @param raw - Parsed YAML content (unknown type)
 * @returns Validated LLM configuration
 */
export function parseLlmConfig(raw: unknown): LlmConfigYaml['llm'] {
  const result = llmConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      'Invalid LLM configuration:\n' +
        result.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n')
    );
  }
  return result.data.llm;
}
