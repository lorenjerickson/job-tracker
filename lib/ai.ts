import "server-only";
import OpenAI from "openai";

let client: OpenAI | null = null;

export class ConfigError extends Error {}

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new ConfigError("OPENAI_API_KEY is not set. Add it to .env.local and restart the app.");
  }
  // OPENAI_BASE_URL is honored automatically by the SDK if set.
  return (client ??= new OpenAI({ timeout: 180_000, maxRetries: 2 }));
}

export const MODEL = () => process.env.OPENAI_MODEL || "gpt-5.5";

// ---- Tiny JSON-schema builders for OpenAI strict structured outputs ----
// Strict mode requires every property to be listed in `required` and no extra props.
type Schema = Record<string, unknown>;
export const str = (description?: string): Schema => ({ type: "string", ...(description && { description }) });
export const num = (description?: string): Schema => ({ type: "number", ...(description && { description }) });
export const int = (description?: string): Schema => ({ type: "integer", ...(description && { description }) });
export const bool = (description?: string): Schema => ({ type: "boolean", ...(description && { description }) });
export const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description && { description }) });
export const enm = (values: string[], description?: string): Schema => ({ type: "string", enum: values, ...(description && { description }) });
export const obj = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description && { description }),
});

/** Call the model and get back JSON that conforms to `schema`. */
export async function jsonCall<T>(opts: { name: string; schema: Schema; system: string; user: string }): Promise<T> {
  const res = await getClient().chat.completions.create({
    model: MODEL(),
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.name, schema: opts.schema, strict: true },
    },
  });
  const msg = res.choices[0]?.message;
  if (msg?.refusal) throw new Error(`The model declined: ${msg.refusal}`);
  if (!msg?.content) throw new Error("The model returned an empty response.");
  try {
    return JSON.parse(msg.content) as T;
  } catch {
    throw new Error("The model returned malformed JSON.");
  }
}

/** Shared rule text included in every generation prompt. */
export const FACT_RULES = `
NON-NEGOTIABLE FACT RULES
- Use ONLY facts stated in the candidate's resume. Do not invent, infer, or embellish.
- Never add employers, titles, dates, degrees, certifications, technologies, tools, languages,
  team sizes, budgets, user counts, metrics, percentages, or outcomes that are not explicitly in the resume.
- Keep every number exactly as written in the resume. Do not round, combine, or estimate numbers.
- You MAY reword, reorder, condense, and choose emphasis, and you MAY use the job description's
  vocabulary ONLY where the resume already describes the same thing (e.g. resume says "built UI
  components in React" -> "developed React component library" is NOT allowed unless a library is mentioned).
- If the job asks for something the resume does not show, do not imply the candidate has it.
- Facts about the employer may come only from the job description.
`.trim();
