// AlphaMan 코어 파사드: 웹 서버와 데스크톱 앱이 동일하게 사용하는 진입점
import path from 'node:path';
import fs from 'node:fs';
import { Store, vercelBlobRemote } from './store.js';
import { AuthService, ADMIN_ACCOUNT } from './auth.js';
import { CreditService, PLANS, ADDON_PLANS } from './credits.js';
import { AIService } from './ai.js';
import { TranslateService } from './translate.js';
import { ShortsEngine } from './shorts/engine.js';
import { LongformEngine } from './longform.js';
import { PublishService, PLATFORMS } from './publish.js';
import { TopicService } from './topic.js';
import { ToolsService } from './tools.js';
import { NotificationService, SupportService } from './support.js';
import { SubtitleProjects } from './subtitles/projects.js';
import { DiscoveryService } from './discovery.js';
import { PixieService } from './pixie.js';
import { AdminService } from './admin.js';
import { VoiceService } from './voice.js';
import { RemixEngine, REMIX_LIMITS, REMIX_DEFAULTS } from './remix.js';
import { LibraryService, LIBRARY_KINDS } from './library.js';
import { SeoService } from './seo.js';
import { ThumbnailService, THUMB_STYLES, THUMB_PALETTES } from './thumbnail.js';
import { toolAvailability } from './media.js';
import { LOCALES } from './i18n.js';
import { CONTENT } from './content.js';

export const VERSION = '1.0.0';

export class AlphaMan {
  constructor({ dataDir, memory = false, platform = 'web' } = {}) {
    this.platform = platform; // 'web' | 'desktop'
    this.dataDir = dataDir || path.join(process.cwd(), 'data');
    this.uploadsDir = path.join(this.dataDir, 'uploads');
    this.outputDir = path.join(this.dataDir, 'output');
    if (!memory) for (const d of [this.dataDir, this.uploadsDir, this.outputDir]) fs.mkdirSync(d, { recursive: true });
    const remote = !memory && process.env.ALPHAMAN_STORE_MODE !== 'local' ? vercelBlobRemote() : null;
    this.store = memory ? Store.memory() : new Store(path.join(this.dataDir, 'alphaman.json'), { remote });
    this.ready = this.store.ready.then(() => { this.auth.seedAdmin(); });

    this.credits = new CreditService(this.store);
    this.auth = new AuthService(this.store, this.credits);
    this.notifications = new NotificationService(this.store);
    this.ai = new AIService();
    this.translate = new TranslateService(this.ai);
    this.support = new SupportService({ store: this.store, notifications: this.notifications });
    this.voice = new VoiceService({ store: this.store, outputDir: this.outputDir });
    this.library = new LibraryService({ store: this.store, notifications: this.notifications });
    this.seo = new SeoService({ ai: this.ai });
    this.thumbnail = new ThumbnailService({ store: this.store, outputDir: this.outputDir, library: this.library });
    this.shorts = new ShortsEngine({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, notifications: this.notifications, uploadsDir: this.uploadsDir, outputDir: this.outputDir, voice: this.voice, library: this.library, seo: this.seo, thumbnail: this.thumbnail });
    this.longform = new LongformEngine({ store: this.store, credits: this.credits, ai: this.ai, notifications: this.notifications, library: this.library, seo: this.seo, thumbnail: this.thumbnail });
    this.publish = new PublishService({ store: this.store, notifications: this.notifications });
    this.topic = new TopicService({ store: this.store, ai: this.ai });
    this.tools = new ToolsService({ ai: this.ai });
    this.subtitles = new SubtitleProjects({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, notifications: this.notifications });
    this.discovery = new DiscoveryService({ store: this.store });
    this.pixie = new PixieService({ store: this.store, ai: this.ai, support: this.support });
    this.remix = new RemixEngine({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, voice: this.voice, notifications: this.notifications, outputDir: this.outputDir, library: this.library, seo: this.seo, thumbnail: this.thumbnail });
    this.admin = new AdminService({ store: this.store, credits: this.credits, auth: this.auth, support: this.support, notifications: this.notifications, publish: this.publish });

    this.auth.seedAdmin();
    this.publish.start();
    // 무료 TTS 엔진(네트워크) 탐색은 백그라운드로 (테스트에서는 생략)
    if (platform !== 'test' && process.env.ALPHAMAN_TTS_DETECT !== 'off') this.voice.detectFreeEngines().catch(() => {});
  }

  async info() {
    if (this.platform !== 'test' && process.env.ALPHAMAN_TTS_DETECT !== 'off') await this.voice.detectFreeEngines().catch(() => {});
    return {
      name: 'AlphaMan', version: VERSION, platform: this.platform, locales: LOCALES,
      plans: PLANS, addonPlans: ADDON_PLANS, platforms: PLATFORMS,
      tools: toolAvailability(), ai: await this.ai.status(), voiceProviders: this.voice.providers(), freeVoices: this.voice.freeVoices(), remixLimits: REMIX_LIMITS, libraryKinds: LIBRARY_KINDS, thumbStyles: THUMB_STYLES, thumbPalettes: THUMB_PALETTES,
      // 대본 정확도: 브라우저 Whisper(파일) · 붙여넣은 대본 · 서버 whisper · yt-dlp 유튜브 자막만 사용하고, 추정 대본은 만들지 않는다
      transcript: { simulatedAllowed: process.env.ALPHAMAN_ALLOW_SIMULATED_STT === '1', serverWhisper: Boolean(toolAvailability().whisper), youtubeCaptions: Boolean(toolAvailability().ytdlp) },
      adminEmail: ADMIN_ACCOUNT.email,
      uploadMaxBytes: process.env.ALPHAMAN_UPLOAD_MAX_BYTES ? Number(process.env.ALPHAMAN_UPLOAD_MAX_BYTES) : (process.env.VERCEL ? 4.5 * 1024 * 1024 : 2 * 1024 * 1024 * 1024),
      serverless: Boolean(process.env.VERCEL),
      settings: this.admin.settings(),
      content: CONTENT,
    };
  }

  registerUpload(userId, { filename, mimeType, size, path: filePath, remoteUrl = null }) {
    return this.store.insert('uploads', { userId, filename, mimeType, size, path: filePath, remoteUrl });
  }

  // 시스템 진단 (관리자): 원격 저장소·파일 보관·무료 TTS 엔진·외부 도구 상태
  async diagnostics() {
    const out = { platform: this.platform, serverless: Boolean(process.env.VERCEL), remoteStore: this.store.remote ? this.store.remote.kind : null, tools: toolAvailability(), voiceProviders: this.voice.providers(), dataDir: this.dataDir, checks: {} };
    if (this.store.remote?.putFile) { try { const url = await this.store.remote.putFile('diag/ping.txt', Buffer.from(`ping ${Date.now()}`), 'text/plain'); out.checks.remoteFile = { ok: true, url }; } catch (err) { out.checks.remoteFile = { ok: false, error: err.message }; } }
    try { const { edgeLastError } = await import('./edgetts.js'); const { googleLastError } = await import('./freetts.js'); out.checks.freeTts = { ...(await this.voice.detectFreeEngines()), edgeError: edgeLastError, googleError: googleLastError }; } catch (err) { out.checks.freeTts = { error: err.message }; }
    return out;
  }

  close() {
    this.publish.stop();
    this.store.flush();
  }
}

export { ADMIN_ACCOUNT, PLANS, ADDON_PLANS, PLATFORMS, LOCALES, CONTENT };
export { ADMIN_USER_ID, verifySessionToken } from './auth.js';
export { ApiError } from './errors.js';
export { validateVideoMeta, parseYoutubeUrl, parseVideoUrl, ensureLocalFile, downloadYoutube } from './media.js';
export { TEMPLATES, GENRES, RATIOS } from './shorts/templates.js';
export { FONTS, SUBTITLE_STYLE_PRESETS } from './subtitles/fonts.js';
export { exportSubtitles, parseSRT, toSRT, toVTT, toASS } from './subtitles/format.js';
export { semanticSplit } from './subtitles/stt.js';
export { nextOccurrences } from './publish.js';
export { TOOLS } from './tools.js';
export { REMIX_LIMITS, REMIX_DEFAULTS } from './remix.js';
export { VOICE_STYLES, FREE_VOICES, DEFAULT_FREE_VOICE } from './voice.js';
export { SeoService, extractKeywords } from './seo.js';
export { ThumbnailService, THUMB_STYLES, THUMB_PALETTES, composeSvg } from './thumbnail.js';
export { LIBRARY_KINDS } from './library.js';
export { parseTranscriptText } from './subtitles/stt.js';
