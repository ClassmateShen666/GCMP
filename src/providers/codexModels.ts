import { ModelConfig } from '../types/sharedTypes';

const reasoningEfforts = new Set<NonNullable<ModelConfig['reasoningEffort']>[number]>([
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
]);

interface CodexRemoteModel {
    slug: string;
    displayName?: string;
    description?: string;
    contextWindow?: number;
    inputModalities: string[];
    reasoningEffort: NonNullable<ModelConfig['reasoningEffort']>;
    reasoningDefault?: ModelConfig['reasoningDefault'];
    serviceTier?: string[];
    priority: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ?
            (value as Record<string, unknown>)
        :   undefined;
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(nonEmptyString).filter((item): item is string => Boolean(item));
}

function parseReasoningEfforts(value: unknown): NonNullable<ModelConfig['reasoningEffort']> {
    if (!Array.isArray(value)) {
        return [];
    }

    const efforts: NonNullable<ModelConfig['reasoningEffort']> = [];
    for (const item of value) {
        const effort = nonEmptyString(asRecord(item)?.effort) as NonNullable<
            ModelConfig['reasoningEffort']
        >[number];
        if (effort && reasoningEfforts.has(effort) && !efforts.includes(effort)) {
            efforts.push(effort);
        }
    }
    return efforts;
}

function parseRemoteModel(value: unknown): CodexRemoteModel | undefined {
    const record = asRecord(value);
    const slug = nonEmptyString(record?.slug);
    if (!record || !slug || record.visibility !== 'list' || record.supported_in_api !== true) {
        return undefined;
    }

    const reasoningEffort = parseReasoningEfforts(record.supported_reasoning_levels);
    const defaultReasoning = nonEmptyString(record.default_reasoning_level) as ModelConfig['reasoningDefault'];
    const serviceTiers = Array.isArray(record.service_tiers) ?
        record.service_tiers
            .map(item => nonEmptyString(asRecord(item)?.slug) ?? nonEmptyString(asRecord(item)?.name))
            .filter((item): item is string => Boolean(item))
        :   [];
    const contextWindow =
        typeof record.context_window === 'number' && Number.isFinite(record.context_window) && record.context_window > 0 ?
            Math.floor(record.context_window)
        :   undefined;

    return {
        slug,
        displayName: nonEmptyString(record.display_name),
        description: nonEmptyString(record.description),
        contextWindow,
        inputModalities: stringArray(record.input_modalities),
        reasoningEffort,
        reasoningDefault:
            defaultReasoning && reasoningEffort.includes(defaultReasoning) ? defaultReasoning : undefined,
        serviceTier: serviceTiers.length > 0 ? serviceTiers : undefined,
        priority:
            typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : Number.MAX_VALUE
    };
}

function createDefaultModel(remote: CodexRemoteModel): ModelConfig {
    return {
        id: remote.slug,
        name: `${remote.displayName ?? remote.slug} (ChatGPT)`,
        tooltip: remote.description ?? `ChatGPT Codex model ${remote.slug}`,
        sdkMode: 'openai-responses',
        maxInputTokens: remote.contextWindow ?? 272000,
        maxOutputTokens: 128000,
        useInstructions: true,
        reasoningEffort: remote.reasoningEffort.length > 0 ? remote.reasoningEffort : undefined,
        reasoningDefault: remote.reasoningDefault,
        serviceTier: remote.serviceTier,
        capabilities: {
            toolCalling: true,
            imageInput: remote.inputModalities.includes('image')
        },
        extraBody: {
            store: false,
            tool_choice: 'auto',
            reasoning: {
                effort: remote.reasoningDefault ?? 'medium',
                summary: 'auto'
            }
        }
    };
}

export function parseCodexModelsResponse(payload: unknown, staticModels: ModelConfig[]): ModelConfig[] {
    const root = asRecord(payload);
    if (!Array.isArray(root?.models)) {
        return [];
    }

    const staticById = new Map(staticModels.map(model => [model.id, model]));
    const seen = new Set<string>();
    return root.models
        .map((value, index) => ({ model: parseRemoteModel(value), index }))
        .filter((item): item is { model: CodexRemoteModel; index: number } => Boolean(item.model))
        .sort((a, b) => a.model.priority - b.model.priority || a.index - b.index)
        .filter(({ model }) => {
            if (seen.has(model.slug)) {
                return false;
            }
            seen.add(model.slug);
            return true;
        })
        .map(({ model: remote }) => {
            const base = staticById.get(remote.slug) ?? createDefaultModel(remote);
            return {
                ...base,
                id: remote.slug,
                name: remote.displayName ? `${remote.displayName} (ChatGPT)` : base.name,
                tooltip: remote.description ?? base.tooltip,
                maxInputTokens: remote.contextWindow ?? base.maxInputTokens,
                capabilities: {
                    ...base.capabilities,
                    imageInput: remote.inputModalities.includes('image')
                },
                reasoningEffort: remote.reasoningEffort.length > 0 ? remote.reasoningEffort : base.reasoningEffort,
                reasoningDefault: remote.reasoningDefault ?? base.reasoningDefault,
                serviceTier: remote.serviceTier
            };
        });
}