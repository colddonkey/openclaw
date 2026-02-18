import path from "node:path";
import { importHfTransformers } from "./hf-transformers.js";

export const DEFAULT_ONNX_MODEL = "onnx-community/embeddinggemma-300m-ONNX";
export const DEFAULT_ONNX_DTYPE = "q4" as const;

/**
 * Minimal shape of the feature-extraction pipeline output.
 * The actual @huggingface/transformers type is a huge union; we only need the Tensor-like shape.
 */
interface EmbeddingOutput {
  data: Float32Array;
  dims: number[];
}

interface FeatureExtractor {
  (
    input: string | string[],
    options: { pooling: string; normalize: boolean },
  ): Promise<EmbeddingOutput>;
  dispose?: () => Promise<void>;
}

export type OnnxEmbeddingProvider = {
  id: string;
  model: string;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

function sanitizeAndNormalize(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const mag = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (mag < 1e-10) return sanitized;
  return sanitized.map((v) => v / mag);
}

/**
 * Resolves the model cache directory for ONNX models.
 * Uses ~/.openclaw/models by default so models aren't scattered in the HF default cache.
 */
function resolveModelCacheDir(explicit?: string): string {
  if (explicit) return explicit;
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(home, ".openclaw", "models");
}

export async function createOnnxEmbeddingProvider(options?: {
  modelId?: string;
  dtype?: typeof DEFAULT_ONNX_DTYPE;
  modelCacheDir?: string;
}): Promise<OnnxEmbeddingProvider> {
  const { env, pipeline } = await importHfTransformers();

  const modelId = options?.modelId || DEFAULT_ONNX_MODEL;
  const dtype = options?.dtype || DEFAULT_ONNX_DTYPE;
  const cacheDir = resolveModelCacheDir(options?.modelCacheDir);

  env.cacheDir = cacheDir;

  let extractor: FeatureExtractor | null = null;

  const ensureExtractor = async (): Promise<FeatureExtractor> => {
    if (!extractor) {
      extractor = (await pipeline("feature-extraction", modelId, {
        dtype,
      })) as unknown as FeatureExtractor;
    }
    return extractor;
  };

  return {
    id: "local",
    model: modelId,

    embedQuery: async (text: string): Promise<number[]> => {
      const ext = await ensureExtractor();
      const output = await ext(text, { pooling: "mean", normalize: true });
      if (!output?.data) throw new Error("ONNX embedding returned no data");
      return sanitizeAndNormalize(Array.from(output.data));
    },

    embedBatch: async (texts: string[]): Promise<number[][]> => {
      if (texts.length === 0) return [];
      const ext = await ensureExtractor();
      const output = await ext(texts, { pooling: "mean", normalize: true });
      const { dims, data } = output;
      if (!data || !dims || dims.length < 2) {
        throw new Error("ONNX batch embedding returned unexpected shape");
      }
      const [batchSize, embDim] = dims;
      const results: number[][] = [];
      for (let i = 0; i < batchSize; i++) {
        const slice = Array.from(data.slice(i * embDim, (i + 1) * embDim));
        results.push(sanitizeAndNormalize(slice));
      }
      return results;
    },
  };
}

/**
 * Check if @huggingface/transformers is available without throwing on import failure.
 */
export async function isOnnxAvailable(): Promise<boolean> {
  try {
    await importHfTransformers();
    return true;
  } catch {
    return false;
  }
}
