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
import { ProjectService, PROJECT_KINDS } from './workspace.js';
import { ActivityService, ACTIVITY_KINDS } from './activity.js';
import { MediaService, MEDIA_CATEGORIES, validateUpload, UPLOAD_LIMITS } from './medialib.js';
import { UserTemplateService, TEMPLATE_KINDS } from './templates.js';
import { ShareService } from './share.js';
import { PaymentService } from './payments.js';
import { ErrorLogService, SystemService, BackupService, UsageService } from './system.js';
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
    this.library = new LibraryService({ store: this.store, notifications: this.notifications, outputDir: this.outputDir });
    this.seo = new SeoService({ ai: this.ai });
    this.thumbnail = new ThumbnailService({ store: this.store, outputDir: this.outputDir, library: this.library });
    this.activity = new ActivityService({ store: this.store, notifications: this.notifications });
    this.errors = new ErrorLogService({ store: this.store });
    this.shorts = new ShortsEngine({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, notifications: this.notifications, uploadsDir: this.uploadsDir, outputDir: this.outputDir, voice: this.voice, library: this.library, seo: this.seo, thumbnail: this.thumbnail, activity: this.activity });
    this.longform = new LongformEngine({ store: this.store, credits: this.credits, ai: this.ai, notifications: this.notifications, library: this.library, seo: this.seo, thumbnail: this.thumbnail, activity: this.activity });
    this.publish = new PublishService({ store: this.store, notifications: this.notifications });
    this.topic = new TopicService({ store: this.store, ai: this.ai });
    this.tools = new ToolsService({ ai: this.ai });
    this.subtitles = new SubtitleProjects({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, notifications: this.notifications, activity: this.activity });
    this.discovery = new DiscoveryService({ store: this.store });
    this.pixie = new PixieService({ store: this.store, ai: this.ai, support: this.support });
    this.remix = new RemixEngine({ store: this.store, credits: this.credits, ai: this.ai, translate: this.translate, voice: this.voice, notifications: this.notifications, outputDir: this.outputDir, library: this.library, seo: this.seo, thumbnail: this.thumbnail, activity: this.activity });
    this.admin = new AdminService({ store: this.store, credits: this.credits, auth: this.auth, support: this.support, notifications: this.notifications, publish: this.publish });
    // 추가 플랫폼 기능: 프로젝트 관리 · 파일 관리자 · 템플릿 · 공유 · 결제 · 시스템/백업/사용량
    this.projects = new ProjectService({ store: this.store, shorts: this.shorts, remix: this.remix, longform: this.longform, subtitles: this.subtitles, library: this.library, credits: this.credits });
    this.media = new MediaService({ store: this.store, outputDir: this.outputDir });
    this.templates = new UserTemplateService({ store: this.store });
    this.share = new ShareService({ store: this.store, library: this.library });
    this.payments = new PaymentService({ store: this.store, credits: this.credits, notifications: this.notifications });
    this.system = new SystemService({ store: this.store, dataDir: this.dataDir, activity: this.activity, voice: this.voice, errors: this.errors });
    this.backup = new BackupService({ store: this.store, dataDir: this.dataDir });
    this.usage = new UsageService({ store: this.store, media: this.media, credits: this.credits, activity: this.activity });
    // 작업 다시 실행 러너
    this.activity.registerRunner('shorts', { rerun: (userId, input) => (input.uploadId ? this.shorts.createFromUpload(userId, input) : this.shorts.createFromYoutube(userId, input)), onCancelled: (id) => this.shorts.onCancelled(id) });
    this.activity.registerRunner('remix', { rerun: (userId, input) => this.remix.create(userId, { ...input, rightsConfirmed: true }), onCancelled: (id) => this.remix.onCancelled(id) });
    this.activity.registerRunner('longform', { rerun: (userId, input) => this.longform.create(userId, input), onCancelled: (id) => this.longform.onCancelled(id) });
    this.activity.registerRunner('subtitle', { rerun: (userId, input) => (input.uploadId ? this.subtitles.createFromUpload(userId, input) : this.subtitles.createFromUrl(userId, input)) });

    this.auth.seedAdmin();
    this.publish.start();
    // 무료 TTS 엔진(네트워크) 탐색은 백그라운드로 (테스트에서는 생략)
    // 서버리스(Vercel)는 응답 뒤 함수가 동결되어 백그라운드 탐색이 타임아웃으로 끝나므로, 거기서는 요청 안에서(ensureDetected) 확인한다
    if (platform !== 'test' && !process.env.VERCEL && process.env.ALPHAMAN_TTS_DETECT !== 'off') this.voice.detectFreeEngines().catch(() => {});
  }

  async info() {
    // 무료 TTS 탐색이 끝났으면 반영하되, 페이지 로딩을 막지 않도록 최대 0.3초만 기다린다
    if (this.platform !== 'test' && process.env.ALPHAMAN_TTS_DETECT !== 'off') await this.voice.ensureDetected(process.env.VERCEL ? 4000 : 300);
    return {
      name: 'AlphaMan', version: VERSION, platform: this.platform, locales: LOCALES,
      plans: PLANS, addonPlans: ADDON_PLANS, platforms: PLATFORMS,
      tools: toolAvailability(), ai: await this.ai.status(), voiceProviders: this.voice.providers(), freeVoices: this.voice.freeVoices(), remixLimits: REMIX_LIMITS, libraryKinds: LIBRARY_KINDS, thumbStyles: THUMB_STYLES, thumbPalettes: THUMB_PALETTES,
      projectKinds: Object.fromEntries(Object.entries(PROJECT_KINDS).map(([k, v]) => [k, v.label])), activityKinds: ACTIVITY_KINDS, mediaCategories: MEDIA_CATEGORIES, templateKinds: TEMPLATE_KINDS, payments: this.payments.config(), uploadLimits: UPLOAD_LIMITS,
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
export { PROJECT_KINDS } from './workspace.js';
export { ACTIVITY_KINDS, JobQueue, CancelledError } from './activity.js';
export { MEDIA_CATEGORIES, validateUpload, UPLOAD_LIMITS } from './medialib.js';
export { TEMPLATE_KINDS } from './templates.js';
export { parseVTT } from './subtitles/format.js';
export { parseTranscriptText } from './subtitles/stt.js';
