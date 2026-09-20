// AI 어댑터: Anthropic SDK(claude-opus-5)가 설치되어 있고 ANTHROPIC_API_KEY(또는 ant auth 프로필)가 있으면 실제 모델을 사용하고,
// 아니면 규칙 기반(heuristic) 엔진으로 동작하여 두 버전 모두 오프라인에서도 모든 기능이 작동한다.

const MODEL = 'claude-opus-5';

let sdkPromise = null;
async function loadClient() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    if (process.env.ALPHAMAN_AI === 'off') return null;
    try {
      const mod = await import('@anthropic-ai/sdk');
      const Anthropic = mod.default;
      const client = new Anthropic();
      return { Anthropic, client };
    } catch {
      return null;
    }
  })();
  return sdkPromise;
}

function extractText(response) {
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error('JSON 응답을 찾지 못했습니다.');
  return JSON.parse(m[0]);
}

export class AIService {
  constructor({ heuristics } = {}) {
    this.heuristics = heuristics;
    this.lastMode = 'heuristic';
  }

  async status() {
    const sdk = await loadClient();
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    return { model: MODEL, sdkInstalled: Boolean(sdk), credentials: hasKey ? 'env' : 'profile-or-none', mode: sdk ? 'claude' : 'heuristic' };
  }

  // 공통 호출. 실패(네트워크/인증/거부)하면 fallback 함수를 사용한다.
  async complete({ system, prompt, json = false, maxTokens = 16000, fallback }) {
    const sdk = await loadClient();
    if (sdk) {
      try {
        const { client } = sdk;
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: maxTokens,
          system,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages: [{ role: 'user', content: prompt }],
        });
        const response = await stream.finalMessage();
        if (response.stop_reason === 'refusal') throw new Error(`모델이 요청을 거부했습니다: ${response.stop_details?.explanation || ''}`);
        const text = extractText(response);
        this.lastMode = 'claude';
        return json ? parseJson(text) : text;
      } catch (err) {
        const { Anthropic } = sdk;
        if (Anthropic && err instanceof Anthropic.AuthenticationError) {
          sdkPromise = Promise.resolve(null); // 자격 증명이 없으면 이후 호출은 즉시 휴리스틱으로
        }
        console.warn('[ai] Claude 호출 실패, 규칙 기반 엔진으로 대체:', err.message);
      }
    }
    this.lastMode = 'heuristic';
    return fallback();
  }
}
